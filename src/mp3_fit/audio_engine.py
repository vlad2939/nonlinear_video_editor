from __future__ import annotations

import json
import math
import subprocess
import tempfile
import wave
from dataclasses import dataclass
from pathlib import Path

import numpy as np

from .paths import FFMPEG, FFPROBE, ensure_vendor_ffmpeg


@dataclass(frozen=True)
class AudioBuffer:
    samples: np.ndarray
    sample_rate: int

    @property
    def duration(self) -> float:
        return float(len(self.samples) / self.sample_rate)


@dataclass(frozen=True)
class Segment:
    start: float
    end: float
    label: str

    @property
    def duration(self) -> float:
        return max(0.0, self.end - self.start)


@dataclass(frozen=True)
class AnalysisResult:
    source_path: Path
    duration: float
    sample_rate: int
    channels: int
    tempo_bpm: float
    beat_seconds: float
    crossfade_seconds: float
    intro_end: float
    outro_start: float
    sections: list[Segment]
    candidates: list[Segment]
    message: str


@dataclass(frozen=True)
class RenderResult:
    output_path: Path
    duration: float
    timeline: list[Segment]
    crossfades: list[tuple[float, float]]
    blocks: list["RenderBlock"]


@dataclass(frozen=True)
class RenderBlock:
    render_start: float
    render_end: float
    source_start: float
    source_end: float
    label: str

    @property
    def duration(self) -> float:
        return max(0.0, self.render_end - self.render_start)


@dataclass(frozen=True)
class _LoopCandidate:
    segment: Segment
    start_frame: int
    end_frame: int
    feature: np.ndarray
    entry: np.ndarray
    exit: np.ndarray
    rms: float


def probe_audio(path: Path) -> dict:
    ensure_vendor_ffmpeg()
    cmd = [
        str(FFPROBE),
        "-v",
        "error",
        "-show_entries",
        "format=duration:stream=codec_type,codec_name,sample_rate,channels",
        "-of",
        "json",
        str(path),
    ]
    data = subprocess.check_output(cmd, text=True, encoding="utf-8")
    return json.loads(data)


def decode_audio(path: Path) -> AudioBuffer:
    ensure_vendor_ffmpeg()
    with tempfile.TemporaryDirectory(prefix="mp3_fit_") as tmp:
        wav_path = Path(tmp) / "decoded.wav"
        cmd = [
            str(FFMPEG),
            "-y",
            "-hide_banner",
            "-loglevel",
            "error",
            "-i",
            str(path),
            "-vn",
            "-ac",
            "2",
            "-ar",
            "48000",
            "-c:a",
            "pcm_s16le",
            str(wav_path),
        ]
        subprocess.check_call(cmd)
        return _read_wav(wav_path)


def analyze_audio(path: Path) -> tuple[AudioBuffer, AnalysisResult]:
    audio = decode_audio(path)
    mono = audio.samples.mean(axis=1)
    frame_seconds = 0.05
    frame_size = max(256, int(audio.sample_rate * frame_seconds))
    energy = _frame_rms(mono, frame_size)
    tempo_bpm, beat_seconds = _estimate_tempo(energy, frame_seconds)

    duration = audio.duration
    intro_end = min(max(8.0, duration * 0.12), max(0.0, duration * 0.25))
    outro_len = min(max(10.0, duration * 0.12), max(6.0, duration * 0.20))
    outro_start = max(intro_end + 8.0, duration - outro_len)
    crossfade_seconds = float(np.clip(beat_seconds * 4.0, 1.2, 4.0))

    sections = _detect_structure(audio, energy, frame_seconds, intro_end, outro_start, beat_seconds)
    candidates = _find_candidates(audio, energy, frame_seconds, intro_end, outro_start, beat_seconds, sections)
    message = (
        f"Analysis: {duration:.1f}s, estimated tempo {tempo_bpm:.0f} BPM, "
        f"{len(sections)} structural sections, {len(candidates)} candidate points for long inserts."
    )
    result = AnalysisResult(
        source_path=path,
        duration=duration,
        sample_rate=audio.sample_rate,
        channels=audio.samples.shape[1],
        tempo_bpm=tempo_bpm,
        beat_seconds=beat_seconds,
        crossfade_seconds=crossfade_seconds,
        intro_end=intro_end,
        outro_start=outro_start,
        sections=sections,
        candidates=candidates,
        message=message,
    )
    return audio, result


def render_extended(
    source_path: Path,
    target_seconds: float,
    output_path: Path,
    analysis: AnalysisResult | None = None,
    variant_seed: int = 0,
    output_bitrate: str = "192k",
) -> RenderResult:
    audio, current_analysis = analyze_audio(source_path)
    if analysis is None:
        analysis = current_analysis

    target_frames = max(1, int(target_seconds * audio.sample_rate))
    crossfade_frames = int(analysis.crossfade_seconds * audio.sample_rate)

    if target_seconds <= audio.duration:
        rendered = audio.samples[:target_frames].copy()
        fade_frames = min(len(rendered), int(3.0 * audio.sample_rate))
        _fade_out_in_place(rendered, fade_frames)
        timeline = [Segment(0.0, target_seconds, "trim")]
        crossfades: list[tuple[float, float]] = []
        blocks = [RenderBlock(0.0, target_seconds, 0.0, target_seconds, "trim")]
    else:
        rendered, timeline, crossfades, blocks = _build_extended_mix(
            audio=audio,
            target_seconds=target_seconds,
            analysis=analysis,
            crossfade_frames=crossfade_frames,
            variant_seed=variant_seed,
        )

    rendered = _limit_audio(rendered)
    with tempfile.TemporaryDirectory(prefix="mp3_fit_export_") as tmp:
        wav_path = Path(tmp) / "render.wav"
        _write_wav(wav_path, rendered, audio.sample_rate)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        _encode_output(wav_path, output_path, output_bitrate)

    return RenderResult(
        output_path=output_path,
        duration=len(rendered) / audio.sample_rate,
        timeline=timeline,
        crossfades=crossfades,
        blocks=_clamp_blocks(blocks, len(rendered) / audio.sample_rate),
    )


def waveform_peaks(samples: np.ndarray, points: int = 1800) -> np.ndarray:
    mono = samples.mean(axis=1)
    if len(mono) == 0:
        return np.zeros(points, dtype=np.float32)
    bucket = max(1, math.ceil(len(mono) / points))
    padded = np.pad(mono, (0, bucket * points - len(mono)), mode="constant")
    shaped = padded.reshape(points, bucket)
    return np.max(np.abs(shaped), axis=1).astype(np.float32)


def _build_extended_mix(
    audio: AudioBuffer,
    target_seconds: float,
    analysis: AnalysisResult,
    crossfade_frames: int,
    variant_seed: int,
) -> tuple[np.ndarray, list[Segment], list[tuple[float, float]], list[RenderBlock]]:
    sr = audio.sample_rate
    target_frames = int(target_seconds * sr)
    outro_seconds = _choose_outro_seconds(audio.duration, target_seconds)
    outro_start_seconds = max(analysis.intro_end + 10.0, audio.duration - outro_seconds)
    prefix_end_seconds = outro_start_seconds
    prefix_end = int(prefix_end_seconds * sr)
    outro_start = int(outro_start_seconds * sr)
    outro = audio.samples[outro_start:]
    rendered = audio.samples[:prefix_end].copy()
    timeline = [Segment(0.0, prefix_end_seconds, "source intact")]
    blocks = [RenderBlock(0.0, prefix_end_seconds, 0.0, prefix_end_seconds, "source intact")]
    crossfades: list[tuple[float, float]] = []

    insert_frames = target_frames - len(rendered) - len(outro) + crossfade_frames * 2
    path = _choose_long_insertions(
        audio=audio,
        analysis=analysis,
        prefix_end_seconds=prefix_end_seconds,
        outro_start_seconds=outro_start_seconds,
        insert_frames=max(0, insert_frames),
        crossfade_frames=crossfade_frames,
        variant_seed=variant_seed,
    )

    for candidate in path:
        start = int(candidate.start * sr)
        end = int(candidate.end * sr)
        chunk = audio.samples[start:end]
        if len(chunk) == 0:
            break
        before = len(rendered)
        rendered = _append_crossfade(rendered, chunk, crossfade_frames)
        after = len(rendered)
        crossfades.append((max(0.0, before / sr - analysis.crossfade_seconds), before / sr))
        timeline.append(candidate)
        blocks.append(
            RenderBlock(
                render_start=max(0.0, before / sr - analysis.crossfade_seconds),
                render_end=after / sr,
                source_start=candidate.start,
                source_end=candidate.end,
                label=candidate.label,
            )
        )

    before_outro = len(rendered)
    rendered = _append_crossfade(rendered, outro, crossfade_frames)
    after_outro = len(rendered)
    crossfades.append((max(0.0, before_outro / sr - analysis.crossfade_seconds), before_outro / sr))
    timeline.append(Segment(outro_start_seconds, analysis.duration, "source ending"))
    blocks.append(
        RenderBlock(
            render_start=max(0.0, before_outro / sr - analysis.crossfade_seconds),
            render_end=after_outro / sr,
            source_start=outro_start_seconds,
            source_end=analysis.duration,
            label="source ending",
        )
    )

    if len(rendered) > target_frames:
        rendered = rendered[:target_frames]
    elif len(rendered) < target_frames:
        pad = np.zeros((target_frames - len(rendered), rendered.shape[1]), dtype=np.float32)
        rendered = np.vstack([rendered, pad])

    _fade_out_in_place(rendered, min(len(rendered), int(2.0 * sr)))
    return rendered, timeline, crossfades, blocks


def _find_candidates(
    audio: AudioBuffer,
    energy: np.ndarray,
    frame_seconds: float,
    intro_end: float,
    outro_start: float,
    beat_seconds: float,
    sections: list[Segment],
) -> list[Segment]:
    analysis = AnalysisResult(
        source_path=Path(),
        duration=audio.duration,
        sample_rate=audio.sample_rate,
        channels=audio.samples.shape[1],
        tempo_bpm=60.0 / max(0.001, beat_seconds),
        beat_seconds=beat_seconds,
        crossfade_seconds=float(np.clip(beat_seconds * 4.0, 1.2, 4.0)),
        intro_end=intro_end,
        outro_start=outro_start,
        sections=sections,
        candidates=[],
        message="",
    )
    loop_candidates = _make_loop_candidates(audio, analysis)
    if not loop_candidates:
        return [Segment(intro_end, outro_start, "body")]

    scored: list[tuple[float, _LoopCandidate]] = []
    for item in loop_candidates:
        a = int(item.segment.start / frame_seconds)
        b = max(a + 1, int(item.segment.end / frame_seconds))
        window = energy[a:b]
        energy_score = float(np.mean(window) - np.std(window) * 0.45)
        boundary_score = -_transition_cost(item, item)
        structure_score = _section_candidate_score(item.segment, sections)
        scored.append((energy_score + boundary_score * 0.35 + structure_score, item))

    scored.sort(key=lambda pair: pair[0], reverse=True)
    chosen: list[Segment] = []
    for _, item in scored:
        if all(abs(item.segment.start - other.start) > item.segment.duration * 0.65 for other in chosen):
            section = _section_for_segment(item.segment, sections)
            label = f"{section.label} candidate" if section else f"phrase {len(chosen) + 1}"
            chosen.append(Segment(item.segment.start, item.segment.end, label))
        if len(chosen) >= 10:
            break
    return sorted(chosen, key=lambda item: item.start)


def _estimate_tempo(energy: np.ndarray, frame_seconds: float) -> tuple[float, float]:
    if len(energy) < 8:
        return 120.0, 0.5
    novelty = np.maximum(0.0, np.diff(energy, prepend=energy[0]))
    novelty -= np.mean(novelty)
    if float(np.max(np.abs(novelty))) < 1e-6:
        return 120.0, 0.5
    min_bpm, max_bpm = 70.0, 170.0
    min_lag = max(1, int((60.0 / max_bpm) / frame_seconds))
    max_lag = max(min_lag + 1, int((60.0 / min_bpm) / frame_seconds))
    lags = range(min_lag, min(max_lag, len(novelty) // 2))
    scores = [float(np.dot(novelty[:-lag], novelty[lag:])) for lag in lags]
    if not scores:
        return 120.0, 0.5
    best_lag = list(lags)[int(np.argmax(scores))]
    beat_seconds = best_lag * frame_seconds
    bpm = 60.0 / beat_seconds
    return bpm, beat_seconds


def _detect_structure(
    audio: AudioBuffer,
    energy: np.ndarray,
    frame_seconds: float,
    intro_end: float,
    outro_start: float,
    beat_seconds: float,
) -> list[Segment]:
    duration = audio.duration
    grid_seconds = max(beat_seconds * 8.0, 4.0)
    window_seconds = max(beat_seconds * 16.0, 10.0)
    times: list[float] = []
    features: list[np.ndarray] = []
    levels: list[float] = []
    cursor = 0.0
    while cursor + window_seconds <= duration:
        end = min(duration, cursor + window_seconds)
        times.append(cursor + (end - cursor) * 0.5)
        features.append(_window_feature(audio, cursor, end))
        a = int(cursor / frame_seconds)
        b = max(a + 1, int(end / frame_seconds))
        levels.append(float(np.mean(energy[a:b])))
        cursor += grid_seconds

    if len(features) < 4:
        return [
            Segment(0.0, intro_end, "intro"),
            Segment(intro_end, outro_start, "body"),
            Segment(outro_start, duration, "outro"),
        ]

    novelty = []
    for idx in range(1, len(features)):
        feature_change = _cosine_distance(features[idx - 1], features[idx])
        level_change = abs(math.log((levels[idx] + 1e-5) / (levels[idx - 1] + 1e-5)))
        novelty.append(feature_change * 0.8 + level_change * 0.2)

    min_section = max(beat_seconds * 24.0, 18.0)
    max_sections = 8
    threshold = float(np.percentile(novelty, 72)) if novelty else 1.0
    boundaries = [0.0]
    for idx, score in enumerate(novelty, start=1):
        boundary_time = _snap_to_grid(times[idx], grid_seconds)
        if score >= threshold and boundary_time - boundaries[-1] >= min_section and duration - boundary_time >= min_section:
            boundaries.append(boundary_time)
        if len(boundaries) >= max_sections:
            break
    if duration - boundaries[-1] < min_section and len(boundaries) > 1:
        boundaries.pop()
    boundaries.append(duration)

    raw_sections: list[Segment] = []
    for start, end in zip(boundaries[:-1], boundaries[1:]):
        if end - start >= 4.0:
            raw_sections.append(Segment(start, end, "section"))

    labels = _label_sections(audio, raw_sections, intro_end, outro_start)
    return [Segment(section.start, section.end, label) for section, label in zip(raw_sections, labels)]


def _label_sections(audio: AudioBuffer, sections: list[Segment], intro_end: float, outro_start: float) -> list[str]:
    if not sections:
        return []
    features = [_window_feature(audio, section.start, section.end) for section in sections]
    rms_values = [_window_rms(audio, section.start, section.end) for section in sections]
    median_rms = float(np.median(rms_values)) if rms_values else 0.0
    labels: list[str] = []
    chorus_like: set[int] = set()
    for idx, feature in enumerate(features):
        repeats = [
            other
            for other, other_feature in enumerate(features)
            if other != idx and _cosine_distance(feature, other_feature) < 0.22
        ]
        if repeats and rms_values[idx] >= median_rms * 0.92:
            chorus_like.add(idx)

    for idx, section in enumerate(sections):
        center = (section.start + section.end) * 0.5
        if section.end <= intro_end * 1.35 or idx == 0 and section.start < intro_end:
            labels.append("intro")
        elif section.start >= outro_start * 0.96 or idx == len(sections) - 1 and section.end > outro_start:
            labels.append("outro")
        elif idx in chorus_like:
            labels.append("chorus")
        elif rms_values[idx] < median_rms * 0.65 and 0.25 < center / audio.duration < 0.80:
            labels.append("break")
        elif len(labels) >= 2 and labels[-1] == "verse" and rms_values[idx] > median_rms * 1.08:
            labels.append("bridge")
        else:
            labels.append("verse")
    return _dedupe_section_labels(labels)


def _dedupe_section_labels(labels: list[str]) -> list[str]:
    counts: dict[str, int] = {}
    result: list[str] = []
    for label in labels:
        if label in {"intro", "outro"}:
            result.append(label)
            continue
        counts[label] = counts.get(label, 0) + 1
        result.append(f"{label} {counts[label]}" if counts[label] > 1 else label)
    return result


def _section_for_segment(segment: Segment, sections: list[Segment]) -> Segment | None:
    best: tuple[float, Segment] | None = None
    for section in sections:
        overlap = max(0.0, min(segment.end, section.end) - max(segment.start, section.start))
        if best is None or overlap > best[0]:
            best = (overlap, section)
    if best is None or best[0] <= 0:
        return None
    return best[1]


def _section_candidate_score(segment: Segment, sections: list[Segment]) -> float:
    section = _section_for_segment(segment, sections)
    if section is None:
        return 0.0
    label = section.label.lower()
    if "chorus" in label:
        return 0.18
    if "verse" in label:
        return 0.12
    if "bridge" in label:
        return 0.03
    if "break" in label:
        return -0.05
    if "intro" in label or "outro" in label:
        return -0.5
    return 0.0


def _section_transition_penalty(segment: Segment, sections: list[Segment], is_last: bool) -> float:
    section = _section_for_segment(segment, sections)
    if section is None:
        return 0.0
    label = section.label.lower()
    if "intro" in label or "outro" in label:
        return 3.0
    if "break" in label:
        return 0.7
    if "bridge" in label:
        return 0.25 if is_last else 0.45
    if "chorus" in label:
        return -0.18
    if "verse" in label:
        return -0.10
    return 0.0


def _snap_to_grid(value: float, grid: float) -> float:
    return round(value / max(grid, 0.001)) * grid


def _choose_outro_seconds(source_seconds: float, target_seconds: float) -> float:
    preferred = target_seconds * 0.15
    lower = max(18.0, source_seconds * 0.10)
    upper = max(lower, source_seconds * 0.20)
    return float(np.clip(preferred, lower, upper))


def _clamp_blocks(blocks: list[RenderBlock], duration: float) -> list[RenderBlock]:
    clamped = []
    for block in blocks:
        start = max(0.0, min(duration, block.render_start))
        end = max(start, min(duration, block.render_end))
        if end > start:
            clamped.append(
                RenderBlock(
                    render_start=start,
                    render_end=end,
                    source_start=block.source_start,
                    source_end=block.source_end,
                    label=block.label,
                )
            )
    return clamped


def _choose_long_insertions(
    audio: AudioBuffer,
    analysis: AnalysisResult,
    prefix_end_seconds: float,
    outro_start_seconds: float,
    insert_frames: int,
    crossfade_frames: int,
    variant_seed: int,
) -> list[Segment]:
    if insert_frames <= int(analysis.beat_seconds * audio.sample_rate * 4):
        return []

    sr = audio.sample_rate
    beat = max(0.25, analysis.beat_seconds)
    grid_seconds = max(beat * 4.0, 2.0)
    min_piece_seconds = max(beat * 16.0, 18.0)
    allowed_start = _ceil_to_grid(analysis.intro_end, grid_seconds)
    allowed_end = max(allowed_start + min_piece_seconds, outro_start_seconds - grid_seconds)
    max_piece_seconds = max(min_piece_seconds, allowed_end - allowed_start)

    target_raw_seconds_base = insert_frames / sr
    max_pieces = max(3, int(math.ceil(target_raw_seconds_base / max(1.0, max_piece_seconds))) + 1)
    for piece_count in range(1, max_pieces + 1):
        # More insertions create more overlap, so account for the extra crossfades up front.
        desired_total_seconds = target_raw_seconds_base + max(0, piece_count - 1) * crossfade_frames / sr
        if desired_total_seconds <= max_piece_seconds * piece_count:
            lengths = _split_long_lengths(desired_total_seconds, piece_count, min_piece_seconds, max_piece_seconds)
            return _select_ordered_insertions(
                audio=audio,
                analysis=analysis,
                lengths=lengths,
                allowed_start=allowed_start,
                allowed_end=allowed_end,
                prefix_end_seconds=prefix_end_seconds,
                outro_start_seconds=outro_start_seconds,
                grid_seconds=grid_seconds,
                variant_seed=variant_seed,
            )

    desired_total_seconds = target_raw_seconds_base + (max_pieces - 1) * crossfade_frames / sr
    lengths = _split_long_lengths(desired_total_seconds, max_pieces, min_piece_seconds, max_piece_seconds)
    return _select_ordered_insertions(
        audio=audio,
        analysis=analysis,
        lengths=lengths,
        allowed_start=allowed_start,
        allowed_end=allowed_end,
        prefix_end_seconds=prefix_end_seconds,
        outro_start_seconds=outro_start_seconds,
        grid_seconds=grid_seconds,
        variant_seed=variant_seed,
    )


def _split_long_lengths(total_seconds: float, count: int, min_seconds: float, max_seconds: float) -> list[float]:
    remaining = total_seconds
    lengths: list[float] = []
    for index in range(count):
        slots_left = count - index
        length = remaining / slots_left
        length = float(np.clip(length, min_seconds, max_seconds))
        if index == count - 1:
            length = min(max_seconds, max(min_seconds, remaining))
        lengths.append(length)
        remaining -= length
    return lengths


def _select_ordered_insertions(
    audio: AudioBuffer,
    analysis: AnalysisResult,
    lengths: list[float],
    allowed_start: float,
    allowed_end: float,
    prefix_end_seconds: float,
    outro_start_seconds: float,
    grid_seconds: float,
    variant_seed: int,
) -> list[Segment]:
    sr = audio.sample_rate
    edge_seconds = max(1.5, min(4.0, analysis.crossfade_seconds))
    prefix_tail = _window_feature(audio, prefix_end_seconds - edge_seconds, prefix_end_seconds)
    outro_head = _window_feature(audio, outro_start_seconds, outro_start_seconds + edge_seconds)
    selected: list[Segment] = []
    previous_exit = prefix_tail

    for index, length in enumerate(lengths):
        length = min(length, max(0.0, allowed_end - allowed_start))
        candidates = _long_segment_candidates(
            audio=audio,
            start_min=allowed_start,
            start_max=allowed_end - length,
            length=length,
            grid_seconds=grid_seconds,
        )
        if not candidates:
            break

        is_last = index == len(lengths) - 1
        ranked: list[tuple[float, Segment, np.ndarray]] = []
        for segment, entry, exit_feature, body, rms in candidates:
            cost = _cosine_distance(previous_exit, entry) * 3.0
            cost += _cosine_distance(body, _window_feature(audio, prefix_end_seconds - length * 0.25, prefix_end_seconds)) * 0.35
            if is_last:
                cost += _cosine_distance(exit_feature, outro_head) * 3.0
            else:
                cost += _cosine_distance(exit_feature, body) * 0.35
            cost += _section_transition_penalty(segment, analysis.sections, is_last)
            cost += _overlap_penalty(segment, selected)
            cost += abs(math.log((rms + 1e-5) / (_window_rms(audio, prefix_end_seconds - edge_seconds, prefix_end_seconds) + 1e-5))) * 0.25
            cost += _variant_bias(segment, variant_seed, index) * 0.18
            ranked.append((cost, segment, exit_feature))

        if not ranked:
            break
        ranked.sort(key=lambda item: item[0])
        pick = min(len(ranked) - 1, (variant_seed + index) % min(4, len(ranked)))
        best = ranked[pick]
        label = "long insert" if len(lengths) == 1 else f"long insert {index + 1}"
        chosen = Segment(best[1].start, best[1].end, label)
        selected.append(chosen)
        previous_exit = best[2]

    return selected


def _variant_bias(segment: Segment, variant_seed: int, index: int) -> float:
    if variant_seed <= 0:
        return 0.0
    value = math.sin((segment.start * 0.173) + (segment.end * 0.071) + variant_seed * 1.618 + index * 0.577)
    return float(value)


def _long_segment_candidates(
    audio: AudioBuffer,
    start_min: float,
    start_max: float,
    length: float,
    grid_seconds: float,
) -> list[tuple[Segment, np.ndarray, np.ndarray, np.ndarray, float]]:
    if start_max < start_min:
        return []
    sr = audio.sample_rate
    candidates = []
    start = start_min
    edge = max(1.5, min(4.0, length * 0.12))
    while start <= start_max + 1e-6:
        end = min(audio.duration, start + length)
        if end - start >= max(8.0, length * 0.85):
            start_frame = int(start * sr)
            end_frame = int(end * sr)
            chunk = audio.samples[start_frame:end_frame]
            segment = Segment(start, end, "long insert")
            candidates.append(
                (
                    segment,
                    _window_feature(audio, start, start + edge),
                    _window_feature(audio, end - edge, end),
                    _segment_feature(chunk, sr),
                    float(np.sqrt(np.mean(chunk * chunk) + 1e-12)),
                )
            )
        start += grid_seconds
    return candidates


def _window_feature(audio: AudioBuffer, start: float, end: float) -> np.ndarray:
    sr = audio.sample_rate
    start_frame = max(0, min(len(audio.samples), int(start * sr)))
    end_frame = max(start_frame + 1, min(len(audio.samples), int(end * sr)))
    return _segment_feature(audio.samples[start_frame:end_frame], sr)


def _window_rms(audio: AudioBuffer, start: float, end: float) -> float:
    sr = audio.sample_rate
    start_frame = max(0, min(len(audio.samples), int(start * sr)))
    end_frame = max(start_frame + 1, min(len(audio.samples), int(end * sr)))
    chunk = audio.samples[start_frame:end_frame]
    return float(np.sqrt(np.mean(chunk * chunk) + 1e-12))


def _overlap_penalty(segment: Segment, selected: list[Segment]) -> float:
    penalty = 0.0
    for other in selected:
        overlap = max(0.0, min(segment.end, other.end) - max(segment.start, other.start))
        if overlap > 0:
            penalty += 5.0 * overlap / max(1.0, segment.duration)
        if abs(segment.start - other.start) < segment.duration * 0.5:
            penalty += 1.0
    return penalty


def _make_loop_candidates(audio: AudioBuffer, analysis: AnalysisResult) -> list[_LoopCandidate]:
    sr = audio.sample_rate
    beat = max(0.25, analysis.beat_seconds)
    phrase_beats = _phrase_beat_count(beat)
    phrase_seconds = phrase_beats * beat
    step_seconds = max(beat * 4.0, 1.0)
    start = _ceil_to_grid(analysis.intro_end, step_seconds)
    candidates: list[_LoopCandidate] = []

    while start + phrase_seconds <= analysis.outro_start:
        end = start + phrase_seconds
        start_frame = int(start * sr)
        end_frame = int(end * sr)
        chunk = audio.samples[start_frame:end_frame]
        if len(chunk) >= sr:
            feature = _segment_feature(chunk, sr)
            edge = max(int(min(2.0, beat * 2.0) * sr), 1024)
            entry = _segment_feature(chunk[:edge], sr)
            exit_feature = _segment_feature(chunk[-edge:], sr)
            rms = float(np.sqrt(np.mean(chunk * chunk) + 1e-12))
            candidates.append(
                _LoopCandidate(
                    segment=Segment(start, end, f"phrase {len(candidates) + 1}"),
                    start_frame=start_frame,
                    end_frame=end_frame,
                    feature=feature,
                    entry=entry,
                    exit=exit_feature,
                    rms=rms,
                )
            )
        start += step_seconds

    return _dedupe_candidates(candidates)


def _choose_candidate_path(
    candidates: list[_LoopCandidate],
    body_budget: int,
    crossfade_frames: int,
    sample_rate: int,
) -> list[Segment]:
    if not candidates or body_budget <= 0:
        return []

    max_steps = max(1, int(body_budget / max(1, np.median([c.end_frame - c.start_frame for c in candidates]))) + 4)
    beam: list[tuple[float, int, list[int]]] = []
    for idx, candidate in enumerate(candidates):
        intro_penalty = candidate.segment.start * 0.002
        beam.append((intro_penalty, candidate.end_frame - candidate.start_frame, [idx]))
    beam = sorted(beam, key=lambda state: state[0])[:10]

    best: tuple[float, int, list[int]] | None = None
    for _ in range(max_steps):
        expanded: list[tuple[float, int, list[int]]] = []
        for cost, frames, path in beam:
            if frames >= body_budget:
                overshoot = abs(frames - body_budget) / sample_rate
                candidate_state = (cost + overshoot * 0.25, frames, path)
                if best is None or candidate_state[0] < best[0]:
                    best = candidate_state
                continue

            prev = candidates[path[-1]]
            for idx, nxt in enumerate(candidates):
                transition = _transition_cost(prev, nxt)
                repeat_penalty = _repeat_penalty(path, idx, candidates)
                length = max(1, nxt.end_frame - nxt.start_frame - crossfade_frames)
                expanded.append((cost + transition + repeat_penalty, frames + length, path + [idx]))

        if not expanded:
            break
        beam = sorted(expanded, key=lambda state: state[0])[:12]

    if best is None:
        best = min(beam, key=lambda state: abs(state[1] - body_budget))
    return [candidates[idx].segment for idx in best[2]]


def _transition_cost(left: _LoopCandidate, right: _LoopCandidate) -> float:
    boundary = _cosine_distance(left.exit, right.entry)
    body = _cosine_distance(left.feature, right.feature)
    loudness = abs(math.log((left.rms + 1e-5) / (right.rms + 1e-5)))
    source_jump = abs(left.segment.end - right.segment.start)
    adjacency_penalty = 0.35 if source_jump < left.segment.duration * 0.4 else 0.0
    return boundary * 2.2 + body * 0.65 + loudness * 0.45 + adjacency_penalty


def _repeat_penalty(path: list[int], next_idx: int, candidates: list[_LoopCandidate]) -> float:
    if not path:
        return 0.0
    penalty = 0.0
    if path[-1] == next_idx:
        penalty += 3.0
    if next_idx in path[-3:]:
        penalty += 1.1
    previous = candidates[path[-1]].segment
    current = candidates[next_idx].segment
    if abs(previous.start - current.start) < previous.duration * 0.75:
        penalty += 0.8
    return penalty


def _segment_feature(samples: np.ndarray, sample_rate: int) -> np.ndarray:
    if len(samples) > 131_072:
        stride = int(math.ceil(len(samples) / 131_072))
        samples = samples[::stride]
        sample_rate = max(1, int(sample_rate / stride))
    mono = samples.mean(axis=1)
    if len(mono) < 16:
        return np.zeros(28, dtype=np.float32)
    mono = mono * np.hanning(len(mono))
    spectrum = np.abs(np.fft.rfft(mono))
    freqs = np.fft.rfftfreq(len(mono), d=1.0 / sample_rate)
    valid = (freqs >= 55.0) & (freqs <= 6000.0)
    spectrum = np.log1p(spectrum[valid])
    freqs = freqs[valid]
    chroma = np.zeros(12, dtype=np.float64)
    for freq, mag in zip(freqs, spectrum):
        midi = 69 + 12 * math.log2(max(freq, 1.0) / 440.0)
        chroma[int(round(midi)) % 12] += mag

    bands = np.array([55, 110, 220, 440, 880, 1760, 3520, 6000], dtype=np.float64)
    band_energy = []
    for low, high in zip(bands[:-1], bands[1:]):
        mask = (freqs >= low) & (freqs < high)
        band_energy.append(float(np.mean(spectrum[mask])) if np.any(mask) else 0.0)

    centroid = float(np.sum(freqs * spectrum) / (np.sum(spectrum) + 1e-9)) / 6000.0
    spread = float(np.sqrt(np.sum(((freqs / 6000.0 - centroid) ** 2) * spectrum) / (np.sum(spectrum) + 1e-9)))
    zcr = float(np.mean(np.abs(np.diff(np.signbit(mono)))))
    rms = float(np.sqrt(np.mean(samples * samples) + 1e-12))
    feature = np.concatenate(
        [
            _normalize_vector(chroma),
            _normalize_vector(np.array(band_energy, dtype=np.float64)),
            np.array([centroid, spread, zcr, rms], dtype=np.float64),
        ]
    )
    return _normalize_vector(feature).astype(np.float32)


def _dedupe_candidates(candidates: list[_LoopCandidate]) -> list[_LoopCandidate]:
    if len(candidates) <= 18:
        return candidates
    kept: list[_LoopCandidate] = []
    ranked = sorted(candidates, key=lambda item: item.rms, reverse=True)
    for item in ranked:
        if all(abs(item.segment.start - other.segment.start) > item.segment.duration * 0.5 for other in kept):
            kept.append(item)
        if len(kept) >= 18:
            break
    return sorted(kept, key=lambda item: item.segment.start)


def _trim_to_downbeat(samples: np.ndarray, max_frames: int, sample_rate: int, beat_seconds: float) -> np.ndarray:
    beat_frames = max(1, int(beat_seconds * sample_rate))
    phrase_frames = beat_frames * 4
    if max_frames <= phrase_frames:
        return samples[:max_frames]
    trimmed = max(phrase_frames, (max_frames // phrase_frames) * phrase_frames)
    return samples[: min(len(samples), trimmed)]


def _phrase_beat_count(beat_seconds: float) -> int:
    if beat_seconds * 16 <= 24.0:
        return 16
    if beat_seconds * 12 <= 24.0:
        return 12
    return 8


def _ceil_to_grid(value: float, grid: float) -> float:
    return math.ceil(value / max(grid, 0.001)) * grid


def _cosine_distance(left: np.ndarray, right: np.ndarray) -> float:
    denom = float(np.linalg.norm(left) * np.linalg.norm(right))
    if denom <= 1e-9:
        return 1.0
    return float(1.0 - np.clip(np.dot(left, right) / denom, -1.0, 1.0))


def _normalize_vector(values: np.ndarray) -> np.ndarray:
    norm = float(np.linalg.norm(values))
    if norm <= 1e-9:
        return values
    return values / norm


def _frame_rms(mono: np.ndarray, frame_size: int) -> np.ndarray:
    frame_count = max(1, math.ceil(len(mono) / frame_size))
    padded = np.pad(mono, (0, frame_count * frame_size - len(mono)), mode="constant")
    frames = padded.reshape(frame_count, frame_size)
    return np.sqrt(np.mean(frames * frames, axis=1) + 1e-12)


def _append_crossfade(base: np.ndarray, chunk: np.ndarray, fade_frames: int) -> np.ndarray:
    if len(base) == 0:
        return chunk.copy()
    if len(chunk) == 0:
        return base
    fade = min(fade_frames, len(base), len(chunk))
    if fade <= 0:
        return np.vstack([base, chunk])
    t = np.linspace(0.0, 1.0, fade, endpoint=False, dtype=np.float32)[:, None]
    out_curve = np.cos(t * math.pi / 2.0)
    in_curve = np.sin(t * math.pi / 2.0)
    mixed = base[-fade:] * out_curve + chunk[:fade] * in_curve
    return np.vstack([base[:-fade], mixed, chunk[fade:]])


def _fade_out_in_place(samples: np.ndarray, fade_frames: int) -> None:
    if fade_frames <= 0:
        return
    curve = np.linspace(1.0, 0.0, fade_frames, dtype=np.float32)[:, None]
    samples[-fade_frames:] *= curve


def _limit_audio(samples: np.ndarray) -> np.ndarray:
    peak = float(np.max(np.abs(samples))) if len(samples) else 0.0
    if peak > 0.98:
        return samples * (0.98 / peak)
    return samples


def _read_wav(path: Path) -> AudioBuffer:
    with wave.open(str(path), "rb") as wav:
        channels = wav.getnchannels()
        sample_rate = wav.getframerate()
        frames = wav.getnframes()
        raw = wav.readframes(frames)
    pcm = np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0
    samples = pcm.reshape(-1, channels)
    if channels == 1:
        samples = np.repeat(samples, 2, axis=1)
    return AudioBuffer(samples=samples, sample_rate=sample_rate)


def _write_wav(path: Path, samples: np.ndarray, sample_rate: int) -> None:
    pcm = np.clip(samples, -1.0, 1.0)
    pcm16 = (pcm * 32767.0).astype(np.int16)
    with wave.open(str(path), "wb") as wav:
        wav.setnchannels(samples.shape[1])
        wav.setsampwidth(2)
        wav.setframerate(sample_rate)
        wav.writeframes(pcm16.tobytes())


def _encode_output(wav_path: Path, output_path: Path, bitrate: str = "192k") -> None:
    suffix = output_path.suffix.lower()
    cmd = [str(FFMPEG), "-y", "-hide_banner", "-loglevel", "error", "-i", str(wav_path)]
    if suffix == ".wav":
        cmd += ["-c:a", "pcm_s16le", str(output_path)]
    else:
        cmd += ["-codec:a", "libmp3lame", "-b:a", bitrate, str(output_path)]
    subprocess.check_call(cmd)
