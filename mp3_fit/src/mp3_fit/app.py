from __future__ import annotations

import subprocess
import sys
import tempfile
import traceback
from html import escape
from pathlib import Path

from PySide6.QtCore import QUrl, Qt, QThread, Signal
from PySide6.QtGui import QColor, QFont, QIcon, QPainter, QPen
from PySide6.QtMultimedia import QAudioOutput, QMediaPlayer
from PySide6.QtWidgets import (
    QApplication,
    QDialog,
    QFileDialog,
    QFrame,
    QHBoxLayout,
    QLabel,
    QMainWindow,
    QMessageBox,
    QProgressBar,
    QPushButton,
    QComboBox,
    QSlider,
    QSpinBox,
    QTextBrowser,
    QVBoxLayout,
    QWidget,
)

from .audio_engine import (
    AnalysisResult,
    RenderResult,
    analyze_audio,
    decode_audio,
    render_extended,
    waveform_peaks,
)
from .paths import FFMPEG, ensure_vendor_ffmpeg


class AnalysisWorker(QThread):
    finished_ok = Signal(object, object, object)
    failed = Signal(str)

    def __init__(self, path: Path):
        super().__init__()
        self.path = path

    def run(self) -> None:
        try:
            audio, analysis = analyze_audio(self.path)
            peaks = waveform_peaks(audio.samples)
            self.finished_ok.emit(audio, analysis, peaks)
        except Exception:
            self.failed.emit(traceback.format_exc())


class RenderWorker(QThread):
    finished_ok = Signal(object)
    failed = Signal(str)

    def __init__(self, source: Path, target_seconds: float, output: Path, analysis: AnalysisResult):
        super().__init__()
        self.source = source
        self.target_seconds = target_seconds
        self.output = output
        self.analysis = analysis

    def run(self) -> None:
        try:
            result = render_extended(self.source, self.target_seconds, self.output, self.analysis)
            self.finished_ok.emit(result)
        except Exception:
            self.failed.emit(traceback.format_exc())


class PreviewWorker(QThread):
    finished_ok = Signal(object, object, object, object, int)
    failed = Signal(str)

    def __init__(self, source: Path, target_seconds: float, output: Path, analysis: AnalysisResult, slot: int, variant_seed: int):
        super().__init__()
        self.source = source
        self.target_seconds = target_seconds
        self.output = output
        self.analysis = analysis
        self.slot = slot
        self.variant_seed = variant_seed

    def run(self) -> None:
        try:
            result = render_extended(self.source, self.target_seconds, self.output, self.analysis, self.variant_seed)
            audio = decode_audio(self.output)
            peaks = waveform_peaks(audio.samples)
            self.finished_ok.emit(result, audio.duration, peaks, self.output, self.slot)
        except Exception:
            self.failed.emit(traceback.format_exc())


class WaveformWidget(QWidget):
    selected = Signal()

    def __init__(self) -> None:
        super().__init__()
        self.setMinimumHeight(240)
        self.peaks = None
        self.duration = 0.0
        self.analysis: AnalysisResult | None = None
        self.render_result: RenderResult | None = None
        self.playhead_seconds: float | None = None
        self.active = True
        self.light_theme = False
        self.empty_text = "Choose an MP3"

    def set_waveform(self, peaks, analysis: AnalysisResult) -> None:
        self.peaks = peaks
        self.duration = analysis.duration
        self.analysis = analysis
        self.render_result = None
        self.playhead_seconds = None
        self.update()

    def set_preview_waveform(self, peaks, duration: float) -> None:
        self.peaks = peaks
        self.duration = duration
        self.analysis = None
        self.render_result = None
        self.playhead_seconds = 0.0
        self.update()

    def set_render_result(self, result: RenderResult) -> None:
        self.render_result = result
        self.update()

    def clear(self) -> None:
        self.peaks = None
        self.duration = 0.0
        self.analysis = None
        self.render_result = None
        self.playhead_seconds = None
        self.update()

    def set_active(self, active: bool) -> None:
        self.active = active
        self.update()

    def set_light_theme(self, light_theme: bool) -> None:
        self.light_theme = light_theme
        self.update()

    def set_empty_text(self, text: str) -> None:
        self.empty_text = text
        self.update()

    def set_playhead(self, seconds: float | None) -> None:
        self.playhead_seconds = seconds
        self.update()

    def paintEvent(self, event) -> None:
        painter = QPainter(self)
        painter.fillRect(self.rect(), QColor("#f6f8fa") if self.light_theme else QColor("#111418"))
        painter.setRenderHint(QPainter.Antialiasing, True)

        width = max(1, self.width())
        height = max(1, self.height())
        mid = height // 2

        painter.setPen(QPen(QColor("#d0d7de") if self.light_theme else QColor("#29313a"), 1))
        painter.drawLine(0, mid, width, mid)

        if self.peaks is None or self.duration <= 0:
            painter.setPen(QColor("#57606a") if self.light_theme else QColor("#8b949e"))
            painter.drawText(self.rect(), Qt.AlignCenter, self.empty_text)
            return

        active_wave = QColor("#159bd3") if self.light_theme else QColor("#5fd0ff")
        inactive_wave = QColor("#8c959f") if self.light_theme else QColor("#6e7681")
        pen = QPen(active_wave if self.active else inactive_wave, 1)
        painter.setPen(pen)
        count = len(self.peaks)
        for x in range(width):
            idx = min(count - 1, int(x / width * count))
            amp = float(self.peaks[idx])
            y = int(amp * (height * 0.42))
            painter.drawLine(x, mid - y, x, mid + y)

        if self.analysis:
            for section in self.analysis.sections:
                self._draw_structure_section(painter, section.start, section.end, section.label)
            self._draw_time_band(painter, self.analysis.intro_end, QColor("#78d64b"), "intro")
            self._draw_time_band(painter, self.analysis.outro_start, QColor("#f2c94c"), "outro", from_start=False)
            for candidate in self.analysis.candidates:
                self._draw_segment(painter, candidate.start, candidate.end, QColor("#a78bfa"), candidate.label)
                fade = self.analysis.crossfade_seconds * 0.5
                self._draw_crossfade_region(painter, candidate.start, fade)
                self._draw_crossfade_region(painter, candidate.end, fade)
        elif self.render_result:
            self._draw_review_blocks(painter, self.render_result)

        if self.playhead_seconds is not None:
            self._draw_playhead(painter, self.playhead_seconds)

    def _x_for_time(self, seconds: float) -> int:
        return int(max(0.0, min(1.0, seconds / max(0.001, self.duration))) * self.width())

    def _draw_segment(self, painter: QPainter, start: float, end: float, color: QColor, label: str) -> None:
        if not self.active and self.render_result:
            color = QColor("#8c959f") if self.light_theme else QColor("#7d8590")
        x1 = self._x_for_time(start)
        x2 = self._x_for_time(end)
        fill = QColor(color)
        fill.setAlpha(55)
        painter.fillRect(x1, 18, max(2, x2 - x1), self.height() - 36, fill)
        painter.setPen(QPen(color, 2))
        painter.drawLine(x1, 18, x1, self.height() - 18)
        painter.drawLine(x2, 18, x2, self.height() - 18)
        self._draw_label(painter, x1 + 6, 28, label, color)

    def _draw_time_band(self, painter: QPainter, seconds: float, color: QColor, label: str, from_start: bool = True) -> None:
        x = self._x_for_time(seconds)
        fill = QColor(color)
        fill.setAlpha(35)
        if from_start:
            painter.fillRect(0, 0, x, self.height(), fill)
            tx = 8
        else:
            painter.fillRect(x, 0, self.width() - x, self.height(), fill)
            tx = x + 8
        painter.setPen(QPen(color, 2))
        painter.drawLine(x, 0, x, self.height())
        self._draw_label(painter, tx, self.height() - 22, label, color)

    def _draw_structure_section(self, painter: QPainter, start: float, end: float, label: str) -> None:
        colors = {
            "intro": QColor("#78d64b"),
            "outro": QColor("#f2c94c"),
            "chorus": QColor("#5fd0ff"),
            "verse": QColor("#a78bfa"),
            "bridge": QColor("#ffb86b"),
            "break": QColor("#8b949e"),
        }
        base = label.split()[0].lower()
        color = colors.get(base, QColor("#8b949e"))
        fill = QColor(color)
        fill.setAlpha(22 if self.active else 16)
        x1 = self._x_for_time(start)
        x2 = self._x_for_time(end)
        painter.fillRect(x1, 0, max(2, x2 - x1), self.height(), fill)
        painter.setPen(QPen(color, 1))
        painter.drawLine(x1, 0, x1, self.height())
        self._draw_label(painter, x1 + 5, 8, label, color)

    def _draw_crossfade_region(self, painter: QPainter, center: float, half_width: float) -> None:
        start = max(0.0, center - half_width)
        end = min(self.duration, center + half_width)
        x1 = self._x_for_time(start)
        x2 = self._x_for_time(end)
        color = QColor("#ff7a90")
        color.setAlpha(65)
        painter.fillRect(x1, 0, max(2, x2 - x1), self.height(), color)
        painter.setPen(QPen(QColor("#ff7a90"), 1))
        painter.drawLine(self._x_for_time(center), 0, self._x_for_time(center), self.height())

    def _draw_review_blocks(self, painter: QPainter, result: RenderResult) -> None:
        palette = {
            "source intact": QColor("#78d64b"),
            "source ending": QColor("#f2c94c"),
            "trim": QColor("#78d64b"),
        }
        insert_colors = [QColor("#a78bfa"), QColor("#5fd0ff"), QColor("#ffb86b"), QColor("#7ee787")]
        insert_index = 0

        for block in result.blocks:
            color = palette.get(block.label)
            if color is None:
                color = insert_colors[insert_index % len(insert_colors)]
                insert_index += 1
            label = f"{block.label} ({_format_seconds(block.source_start)}-{_format_seconds(block.source_end)})"
            self._draw_segment(painter, block.render_start, block.render_end, color, label)

        for start, end in result.crossfades:
            self._draw_crossfade_span(painter, start, end)

    def _draw_crossfade_span(self, painter: QPainter, start: float, end: float) -> None:
        x1 = self._x_for_time(start)
        x2 = self._x_for_time(end)
        color = QColor("#d1242f" if self.active and self.light_theme else "#ff7a90" if self.active else "#8b949e")
        color.setAlpha(75)
        painter.fillRect(x1, 0, max(2, x2 - x1), self.height(), color)
        painter.setPen(QPen(QColor("#ff7a90"), 2))
        painter.drawLine(x2, 0, x2, self.height())

    def _draw_playhead(self, painter: QPainter, seconds: float) -> None:
        x = self._x_for_time(seconds)
        accent = QColor("#ff9f1a")
        painter.setPen(QPen(accent, 2))
        painter.drawLine(x, 0, x, self.height())
        painter.setBrush(accent)
        painter.drawEllipse(x - 5, 5, 10, 10)

    def _draw_label(self, painter: QPainter, x: int, y: int, text: str, accent: QColor) -> None:
        font = QFont(painter.font())
        font.setBold(True)
        font.setPointSize(max(9, font.pointSize()))
        painter.setFont(font)
        metrics = painter.fontMetrics()
        width = min(metrics.horizontalAdvance(text) + 12, max(40, self.width() - x - 6))
        rect = painter.boundingRect(x, y, width, 22, Qt.AlignLeft | Qt.AlignVCenter, text)
        bg = QColor("#ffffff" if self.light_theme else "#000000")
        bg.setAlpha(205)
        painter.fillRect(rect.adjusted(-4, -2, 4, 2), bg)
        painter.setPen(QPen(accent.lighter(125) if not self.light_theme else accent.darker(130), 1))
        painter.drawText(rect, Qt.AlignLeft | Qt.AlignVCenter, text)

    def mousePressEvent(self, event) -> None:
        self.selected.emit()
        super().mousePressEvent(event)


class PreviewTrackWidget(QWidget):
    selected = Signal(int)
    delete_requested = Signal(int)

    def __init__(self, index: int) -> None:
        super().__init__()
        self.setObjectName("previewTrack")
        self.index = index
        self.has_review = False
        self.waveform = WaveformWidget()
        self.waveform.setMinimumHeight(105)
        self.waveform.set_empty_text(f"Preview {index + 1}")
        self.waveform.selected.connect(lambda: self.selected.emit(self.index))
        self.delete_button = QPushButton("Delete")
        self.delete_button.setEnabled(False)
        self.delete_button.clicked.connect(lambda: self.delete_requested.emit(self.index))

        layout = QHBoxLayout(self)
        layout.setContentsMargins(0, 4, 0, 4)
        layout.addWidget(self.waveform, 1)
        layout.addWidget(self.delete_button)
        self.setVisible(False)

    def set_review(self, peaks, duration: float, result: RenderResult, active: bool) -> None:
        self.has_review = True
        self.setVisible(True)
        self.delete_button.setEnabled(True)
        self.waveform.set_preview_waveform(peaks, duration)
        self.waveform.set_render_result(result)
        self.waveform.set_active(active)

    def clear_review(self) -> None:
        self.has_review = False
        self.delete_button.setEnabled(False)
        self.waveform.clear()
        self.setVisible(False)

    def set_active(self, active: bool) -> None:
        self.waveform.set_active(active)

    def set_light_theme(self, light_theme: bool) -> None:
        self.waveform.set_light_theme(light_theme)

    def set_playhead(self, seconds: float | None) -> None:
        self.waveform.set_playhead(seconds if self.has_review else None)

    def mousePressEvent(self, event) -> None:
        if self.has_review:
            self.selected.emit(self.index)
        super().mousePressEvent(event)


class MainWindow(QMainWindow):
    def __init__(self) -> None:
        super().__init__()
        self.setWindowTitle("MP3 Fit")
        icon_path = Path(__file__).resolve().parents[2] / "icon.ico"
        if icon_path.exists():
            self.setWindowIcon(QIcon(str(icon_path)))
        self.resize(980, 620)
        self.source_path: Path | None = None
        self.analysis: AnalysisResult | None = None
        self.analysis_worker: AnalysisWorker | None = None
        self.render_worker: RenderWorker | None = None
        self.preview_worker: PreviewWorker | None = None
        self.preview_dir = tempfile.TemporaryDirectory(prefix="mp3_fit_reviews_")
        self.review_slots: list[dict | None] = [None, None, None, None]
        self.active_review_slot: int | None = None
        self.review_generation_count = 0
        self.current_play_path: Path | None = None
        self.source_active = False
        self.light_theme = False
        self.player = QMediaPlayer(self)
        self.audio_output = QAudioOutput(self)
        self.audio_output.setVolume(0.85)
        self.player.setAudioOutput(self.audio_output)
        self.player.positionChanged.connect(self._player_position_changed)
        self.player.durationChanged.connect(self._player_duration_changed)
        self.player.playbackStateChanged.connect(self._player_state_changed)

        root = QWidget()
        layout = QVBoxLayout(root)
        layout.setSpacing(8)

        file_row = QHBoxLayout()
        self.choose_button = QPushButton("Choose MP3")
        self.choose_button.clicked.connect(self.choose_file)
        self.file_label = QLabel("File: no file selected")
        self.file_label.setMinimumWidth(420)
        self.file_label.setTextFormat(Qt.RichText)
        self.file_label.setTextInteractionFlags(Qt.TextSelectableByMouse)
        self.theme_button = QPushButton("☾")
        self.theme_button.setFixedWidth(42)
        self.theme_button.setToolTip("Schimba tema")
        self.theme_button.clicked.connect(self.toggle_theme)
        file_row.addWidget(self.choose_button)
        file_row.addSpacing(24)
        file_row.addWidget(self.file_label, 1)
        file_row.addWidget(self.theme_button)
        layout.addLayout(file_row)

        self.waveform = WaveformWidget()
        self.waveform.setMinimumHeight(185)
        self.waveform.set_empty_text("Source track")
        self.waveform.selected.connect(self.select_source_track)
        layout.addWidget(self.waveform)

        layout.addWidget(_separator())

        self.minutes = QSpinBox()
        self.minutes.setRange(0, 240)
        self.minutes.setValue(8)
        self.seconds = QSpinBox()
        self.seconds.setRange(0, 59)
        self.seconds.setValue(0)
        duration_row = QHBoxLayout()
        self.duration_label = QLabel("Target duration")
        duration_row.addWidget(self.duration_label)
        duration_row.addWidget(self.minutes)
        duration_row.addWidget(QLabel("minutes"))
        duration_row.addWidget(self.seconds)
        duration_row.addWidget(QLabel("seconds"))
        duration_row.addStretch(1)
        layout.addLayout(duration_row)

        layout.addWidget(_separator())

        self.review_tracks: list[PreviewTrackWidget] = []
        for index in range(4):
            track = PreviewTrackWidget(index)
            track.selected.connect(self.select_review_track)
            track.delete_requested.connect(self.delete_review_track)
            self.review_tracks.append(track)
            layout.addWidget(track, 1)

        layout.addWidget(_separator())

        player_row = QHBoxLayout()
        self.play_button = QPushButton("Play")
        self.play_button.clicked.connect(self.toggle_playback)
        self.play_button.setEnabled(False)
        self.stop_button = QPushButton("Stop")
        self.stop_button.clicked.connect(self.stop_playback)
        self.stop_button.setEnabled(False)
        self.position_slider = QSlider(Qt.Horizontal)
        self.position_slider.setRange(0, 0)
        self.position_slider.sliderMoved.connect(self.seek_player)
        self.time_label = QLabel("00:00 / 00:00")
        player_row.addWidget(self.play_button)
        player_row.addWidget(self.stop_button)
        player_row.addWidget(self.position_slider, 1)
        player_row.addWidget(self.time_label)
        layout.addLayout(player_row)

        layout.addWidget(_separator())

        controls = QHBoxLayout()
        self.analyze_button = QPushButton("Analyze")
        self.analyze_button.clicked.connect(self.analyze)
        self.review_button = QPushButton("Generate Preview")
        self.review_button.clicked.connect(self.generate_review)
        self.review_button.setEnabled(False)
        self.export_button = QPushButton("Export")
        self.export_button.clicked.connect(self.export)
        self.export_button.setEnabled(False)
        self.bitrate_label = QLabel("MP3 bitrate")
        self.bitrate_combo = QComboBox()
        self.bitrate_combo.addItems(["128 kbps", "192 kbps", "256 kbps", "320 kbps"])
        self.bitrate_combo.setCurrentText("192 kbps")
        self.readme_button = QPushButton("Readme")
        self.readme_button.clicked.connect(self.show_readme)
        controls.addWidget(self.analyze_button)
        controls.addWidget(self.review_button)
        controls.addWidget(self.export_button)
        controls.addSpacing(18)
        controls.addWidget(self.bitrate_label)
        controls.addWidget(self.bitrate_combo)
        controls.addStretch(1)
        controls.addWidget(self.readme_button)
        layout.addLayout(controls)

        status_row = QHBoxLayout()
        self.progress = QProgressBar()
        self.progress.setRange(0, 1)
        self.progress.setValue(0)
        self.progress.setTextVisible(False)
        self.progress.setFixedWidth(180)
        self.progress.setFixedHeight(6)
        self.status_label = QLabel("Ready.")
        self.status_label.setMinimumHeight(20)
        self.status_label.setTextInteractionFlags(Qt.TextSelectableByMouse)
        status_row.addWidget(self.progress)
        status_row.addWidget(self.status_label, 1)
        layout.addLayout(status_row)

        self.setCentralWidget(root)
        self.apply_theme()
        self._validate_ffmpeg()

    def _validate_ffmpeg(self) -> None:
        try:
            ensure_vendor_ffmpeg()
            self.status_label.setText("Ready.")
        except Exception as exc:
            self.status_label.setText("FFmpeg is missing.")
            QMessageBox.critical(self, "Missing FFmpeg", str(exc))

    def choose_file(self) -> None:
        path, _ = QFileDialog.getOpenFileName(self, "Choose MP3", str(Path.cwd()), "Audio (*.mp3 *.wav *.m4a *.aac)")
        if not path:
            return
        self.source_path = Path(path)
        self._update_file_label()
        self.analysis = None
        self._clear_all_reviews()
        self.current_play_path = self.source_path
        self.player.setSource(QUrl.fromLocalFile(str(self.source_path)))
        self.source_active = True
        self.waveform.set_active(True)
        self.export_button.setEnabled(True)
        self.review_button.setEnabled(False)
        self.play_button.setEnabled(True)
        self.stop_button.setEnabled(True)
        self.waveform.set_playhead(None)
        self._set_status("File selected. Analysis starts automatically...")
        self.analyze()

    def analyze(self) -> None:
        if not self.source_path:
            QMessageBox.information(self, "Choose file", "Choose an MP3 file first.")
            return
        self.stop_playback()
        self._clear_all_reviews()
        self._set_busy(True, "Analyzing audio...")
        self.analysis_worker = AnalysisWorker(self.source_path)
        self.analysis_worker.finished_ok.connect(self._analysis_done)
        self.analysis_worker.failed.connect(self._worker_failed)
        self.analysis_worker.start()

    def generate_review(self) -> None:
        if not self.source_path or not self.analysis:
            QMessageBox.information(self, "Analysis required", "Run analysis before generating a preview.")
            return
        slot = self._first_empty_review_slot()
        if slot is None:
            QMessageBox.information(self, "Preview limit", "There are already 4 previews. Delete one before generating another.")
            return
        target = self._target_seconds()
        if target <= 0:
            QMessageBox.warning(self, "Invalid duration", "Choose a duration greater than zero.")
            return
        self.stop_playback()
        self.review_generation_count += 1
        preview_path = Path(self.preview_dir.name) / f"{self.source_path.stem}_review_{self.review_generation_count}.mp3"
        self._set_busy(True, f"Generating preview {slot + 1}...")
        self.preview_worker = PreviewWorker(
            self.source_path,
            target,
            preview_path,
            self.analysis,
            slot,
            self.review_generation_count,
        )
        self.preview_worker.finished_ok.connect(self._preview_done)
        self.preview_worker.failed.connect(self._worker_failed)
        self.preview_worker.start()

    def export(self) -> None:
        source_path = self._active_export_path()
        if source_path is None:
            QMessageBox.information(self, "Track required", "Select the source track or a preview before exporting.")
            return
        suffix = "source" if self.source_active else f"review_{self.active_review_slot + 1}"
        suggested = self.source_path.with_name(f"{self.source_path.stem}_fit_{suffix}.mp3")
        output, _ = QFileDialog.getSaveFileName(self, "Export audio", str(suggested), "MP3 (*.mp3);;WAV (*.wav)")
        if not output:
            return
        try:
            self._export_audio_file(source_path, Path(output), self._selected_bitrate())
        except Exception:
            QMessageBox.critical(self, "Export error", traceback.format_exc())
            return
        self._set_busy(False, f"Export complete: {output}")

    def _analysis_done(self, audio, analysis: AnalysisResult, peaks) -> None:
        self.analysis = analysis
        self.waveform.set_waveform(peaks, analysis)
        self._update_file_label(analysis.duration)
        self.select_source_track()
        self.play_button.setEnabled(True)
        self.stop_button.setEnabled(True)
        self.review_button.setEnabled(True)
        self._set_busy(False, analysis.message)

    def _preview_done(self, result: RenderResult, duration: float, peaks, path: Path, slot: int) -> None:
        self.review_slots[slot] = {
            "result": result,
            "duration": duration,
            "peaks": peaks,
            "path": path,
        }
        self.review_tracks[slot].set_review(peaks, duration, result, active=False)
        self.select_review_track(slot)
        self.play_button.setEnabled(True)
        self.stop_button.setEnabled(True)
        self._set_busy(False, f"Preview {slot + 1} ready: {duration:.1f}s. Track {slot + 1} is active.")

    def _render_done(self, result: RenderResult) -> None:
        self.waveform.set_render_result(result)
        self._set_busy(False, f"Export complete: {result.output_path} ({result.duration:.1f}s)")
        QMessageBox.information(self, "Export complete", f"File created:\n{result.output_path}")

    def _worker_failed(self, details: str) -> None:
        self._set_busy(False, "Error")
        QMessageBox.critical(self, "Error", details)

    def toggle_theme(self) -> None:
        self.light_theme = not self.light_theme
        self.apply_theme()

    def apply_theme(self) -> None:
        self.theme_button.setText("☀" if self.light_theme else "☾")
        self.waveform.set_light_theme(self.light_theme)
        for track in self.review_tracks:
            track.set_light_theme(self.light_theme)
        self.setStyleSheet(_light_stylesheet() if self.light_theme else _dark_stylesheet())

    def show_readme(self) -> None:
        readme_path = Path(__file__).resolve().parents[2] / "README.md"
        text = readme_path.read_text(encoding="utf-8") if readme_path.exists() else "README.md was not found."
        dialog = QDialog(self)
        dialog.setWindowTitle("Readme")
        dialog.resize(720, 640)
        layout = QVBoxLayout(dialog)
        browser = QTextBrowser()
        browser.setOpenExternalLinks(True)
        browser.setMarkdown(text)
        browser.setStyleSheet(_readme_stylesheet(self.light_theme))
        close_button = QPushButton("Close")
        close_button.clicked.connect(dialog.accept)
        layout.addWidget(browser, 1)
        layout.addWidget(close_button, alignment=Qt.AlignRight)
        dialog.exec()

    def select_review_track(self, slot: int) -> None:
        if slot < 0 or slot >= len(self.review_slots) or self.review_slots[slot] is None:
            return
        self.source_active = False
        self.waveform.set_active(False)
        self.waveform.set_playhead(None)
        self.active_review_slot = slot
        active = self.review_slots[slot]
        self.current_play_path = active["path"]
        self.player.setSource(QUrl.fromLocalFile(str(active["path"])))
        self.position_slider.setRange(0, int(active["duration"] * 1000))
        self.position_slider.setValue(0)
        for index, track in enumerate(self.review_tracks):
            is_active = index == slot and self.review_slots[index] is not None
            track.set_active(is_active)
            track.set_playhead(0.0 if is_active else None)
        self.export_button.setEnabled(True)
        self.play_button.setEnabled(True)
        self.stop_button.setEnabled(True)
        self._set_status(f"Active track: Preview {slot + 1}.")

    def select_source_track(self) -> None:
        if not self.source_path:
            return
        self.source_active = True
        self.active_review_slot = None
        self.current_play_path = self.source_path
        self.player.setSource(QUrl.fromLocalFile(str(self.source_path)))
        self.waveform.set_active(True)
        self.waveform.set_playhead(0.0)
        for track in self.review_tracks:
            track.set_active(False)
            track.set_playhead(None)
        self.export_button.setEnabled(True)
        self.play_button.setEnabled(True)
        self.stop_button.setEnabled(True)
        self._set_status("Active track: source.")

    def delete_review_track(self, slot: int) -> None:
        if slot < 0 or slot >= len(self.review_slots) or self.review_slots[slot] is None:
            return
        if self.active_review_slot == slot:
            self.stop_playback()
        path = self.review_slots[slot]["path"]
        try:
            Path(path).unlink(missing_ok=True)
        except OSError:
            pass
        self.review_slots[slot] = None
        self.review_tracks[slot].clear_review()
        if self.active_review_slot == slot:
            self.active_review_slot = None
            next_slot = self._first_filled_review_slot()
            if next_slot is not None:
                self.select_review_track(next_slot)
            else:
                self.select_source_track()
        else:
            self._refresh_review_track_states()

    def _clear_all_reviews(self) -> None:
        self.stop_playback()
        for index, slot in enumerate(self.review_slots):
            if slot is not None:
                try:
                    Path(slot["path"]).unlink(missing_ok=True)
                except OSError:
                    pass
            self.review_slots[index] = None
            self.review_tracks[index].clear_review()
        self.active_review_slot = None
        self.source_active = self.source_path is not None
        self.review_generation_count = 0
        self.waveform.set_active(self.source_active)
        self.export_button.setEnabled(self.source_active)

    def _first_empty_review_slot(self) -> int | None:
        for index, slot in enumerate(self.review_slots):
            if slot is None:
                return index
        return None

    def _first_filled_review_slot(self) -> int | None:
        for index, slot in enumerate(self.review_slots):
            if slot is not None:
                return index
        return None

    def _active_review(self) -> dict | None:
        if self.active_review_slot is None:
            return None
        return self.review_slots[self.active_review_slot]

    def _active_export_path(self) -> Path | None:
        if self.source_active and self.source_path:
            return self.source_path
        active = self._active_review()
        if active is None:
            return None
        return active["path"]

    def _refresh_review_track_states(self) -> None:
        for index, track in enumerate(self.review_tracks):
            track.set_active(index == self.active_review_slot and self.review_slots[index] is not None)

    def _export_audio_file(self, source: Path, output: Path, bitrate: str) -> None:
        output.parent.mkdir(parents=True, exist_ok=True)
        cmd = [
            str(FFMPEG),
            "-y",
            "-hide_banner",
            "-loglevel",
            "error",
            "-i",
            str(source),
        ]
        if output.suffix.lower() == ".mp3":
            cmd += ["-codec:a", "libmp3lame", "-b:a", bitrate, str(output)]
        else:
            cmd += ["-c:a", "pcm_s16le", str(output)]
        subprocess.check_call(cmd)

    def _set_busy(self, busy: bool, message: str) -> None:
        self.choose_button.setEnabled(not busy)
        self.analyze_button.setEnabled(not busy)
        self.export_button.setEnabled((not busy) and self._active_export_path() is not None)
        self.review_button.setEnabled((not busy) and self.analysis is not None)
        self.play_button.setEnabled((not busy) and self.current_play_path is not None)
        self.stop_button.setEnabled((not busy) and self.current_play_path is not None)
        if busy:
            self.progress.setRange(0, 0)
        else:
            self.progress.setRange(0, 1)
            self.progress.setValue(1 if message and message != "Ready." else 0)
        self._set_status(message)

    def _set_status(self, message: str) -> None:
        self.status_label.setText(message)

    def _update_file_label(self, duration: float | None = None) -> None:
        if not self.source_path:
            self.file_label.setText("File: no file selected")
            return
        details = f"File: {escape(str(self.source_path))}"
        if duration is not None:
            details += (
                "&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;"
                f"<span style='color:#ff9f1a; font-weight:700;'>Duration: {_format_seconds(duration)}</span>"
            )
        self.file_label.setText(details)

    def _target_seconds(self) -> float:
        return float(self.minutes.value() * 60 + self.seconds.value())

    def _selected_bitrate(self) -> str:
        return self.bitrate_combo.currentText().replace(" kbps", "k")

    def toggle_playback(self) -> None:
        if self.player.playbackState() == QMediaPlayer.PlayingState:
            self.player.pause()
        else:
            self.player.play()

    def stop_playback(self) -> None:
        self.player.stop()
        if self.active_review_slot is not None:
            for index, track in enumerate(self.review_tracks):
                track.set_playhead(0.0 if index == self.active_review_slot else None)
        else:
            self.waveform.set_playhead(0.0 if self.current_play_path else None)

    def seek_player(self, position: int) -> None:
        self.player.setPosition(position)

    def _player_position_changed(self, position: int) -> None:
        self.position_slider.blockSignals(True)
        self.position_slider.setValue(position)
        self.position_slider.blockSignals(False)
        seconds = position / 1000.0
        if self.active_review_slot is not None:
            for index, track in enumerate(self.review_tracks):
                track.set_playhead(seconds if index == self.active_review_slot else None)
        else:
            self.waveform.set_playhead(seconds)
        self.time_label.setText(f"{_format_ms(position)} / {_format_ms(self.player.duration())}")

    def _player_duration_changed(self, duration: int) -> None:
        self.position_slider.setRange(0, max(0, duration))
        self.time_label.setText(f"{_format_ms(self.player.position())} / {_format_ms(duration)}")

    def _player_state_changed(self, state: QMediaPlayer.PlaybackState) -> None:
        self.play_button.setText("Pause" if state == QMediaPlayer.PlayingState else "Play")


def _format_ms(value: int) -> str:
    total_seconds = max(0, int(value / 1000))
    minutes, seconds = divmod(total_seconds, 60)
    hours, minutes = divmod(minutes, 60)
    if hours:
        return f"{hours:02d}:{minutes:02d}:{seconds:02d}"
    return f"{minutes:02d}:{seconds:02d}"


def _format_seconds(value: float) -> str:
    return _format_ms(int(value * 1000))


def _markdown_to_html(markdown: str, light_theme: bool) -> str:
    bg = "#ffffff" if light_theme else "#111418"
    fg = "#24292f" if light_theme else "#f0f3f6"
    muted = "#57606a" if light_theme else "#8b949e"
    accent = "#0969da" if light_theme else "#5fd0ff"
    parts = [
        "<html><head><style>",
        f"body {{ background:{bg}; color:{fg}; font-family: Segoe UI, Arial, sans-serif; font-size: 13px; line-height: 1.45; }}",
        f"h1, h2, h3 {{ color:{fg}; margin-top: 18px; margin-bottom: 8px; }}",
        f"h1 {{ border-bottom: 1px solid {muted}; padding-bottom: 8px; }}",
        f"code {{ background: rgba(128,128,128,0.18); color:{accent}; padding: 2px 4px; border-radius: 3px; }}",
        "ul, ol { margin-top: 6px; margin-bottom: 10px; }",
        "li { margin: 4px 0; }",
        "</style></head><body>",
    ]
    in_ul = False
    in_ol = False
    for raw in markdown.splitlines():
        line = raw.rstrip()
        stripped = line.strip()
        if not stripped:
            if in_ul:
                parts.append("</ul>")
                in_ul = False
            if in_ol:
                parts.append("</ol>")
                in_ol = False
            parts.append("<br>")
            continue
        if stripped.startswith("#"):
            if in_ul:
                parts.append("</ul>")
                in_ul = False
            if in_ol:
                parts.append("</ol>")
                in_ol = False
            level = min(3, len(stripped) - len(stripped.lstrip("#")))
            text = _inline_markdown(stripped[level:].strip())
            parts.append(f"<h{level}>{text}</h{level}>")
        elif stripped.startswith("- "):
            if in_ol:
                parts.append("</ol>")
                in_ol = False
            if not in_ul:
                parts.append("<ul>")
                in_ul = True
            parts.append(f"<li>{_inline_markdown(stripped[2:])}</li>")
        elif len(stripped) > 3 and stripped[0].isdigit() and ". " in stripped[:5]:
            if in_ul:
                parts.append("</ul>")
                in_ul = False
            if not in_ol:
                parts.append("<ol>")
                in_ol = True
            parts.append(f"<li>{_inline_markdown(stripped.split('. ', 1)[1])}</li>")
        else:
            if in_ul:
                parts.append("</ul>")
                in_ul = False
            if in_ol:
                parts.append("</ol>")
                in_ol = False
            parts.append(f"<p>{_inline_markdown(stripped)}</p>")
    if in_ul:
        parts.append("</ul>")
    if in_ol:
        parts.append("</ol>")
    parts.append("</body></html>")
    return "".join(parts)


def _inline_markdown(text: str) -> str:
    chunks = escape(text).split("`")
    for index in range(1, len(chunks), 2):
        chunks[index] = f"<code>{chunks[index]}</code>"
    return "".join(chunks)


def _readme_stylesheet(light_theme: bool) -> str:
    if light_theme:
        return """
        QTextBrowser {
            background: #ffffff;
            color: #24292f;
            border: 1px solid #d0d7de;
            padding: 18px;
            font-size: 14px;
            line-height: 1.45;
        }
        """
    return """
    QTextBrowser {
        background: #111418;
        color: #f0f3f6;
        border: 1px solid #30363d;
        padding: 18px;
        font-size: 14px;
        line-height: 1.45;
    }
    """


def _separator() -> QFrame:
    line = QFrame()
    line.setObjectName("separator")
    line.setFrameShape(QFrame.HLine)
    line.setFrameShadow(QFrame.Plain)
    return line


def _dark_stylesheet() -> str:
    return """
    QWidget {
        background: #1b1b1b;
        color: #f0f3f6;
        font-size: 12px;
    }
    QPushButton {
        background: #2d2d2d;
        color: #ffffff;
        border: 1px solid #4a4a4a;
        border-radius: 4px;
        padding: 4px 10px;
    }
    QPushButton:hover { background: #3a3a3a; }
    QPushButton:disabled { color: #777; background: #242424; }
    QSlider::groove:horizontal {
        height: 4px;
        background: #9aa0a6;
    }
    QSlider::handle:horizontal {
        width: 12px;
        margin: -4px 0;
        border-radius: 6px;
        background: #ff9f1a;
    }
    QProgressBar {
        border: 1px solid #4a4a4a;
        border-radius: 3px;
        background: #101418;
    }
    QProgressBar::chunk { background: #ff9f1a; }
    #separator { color: #30363d; background: #30363d; max-height: 1px; }
    #previewTrack {
        border-top: 1px solid #30363d;
        border-bottom: 1px solid #101418;
    }
    QTextBrowser {
        background: #111418;
        color: #f0f3f6;
        border: 1px solid #30363d;
        padding: 16px;
    }
    """


def _light_stylesheet() -> str:
    return """
    QWidget {
        background: #f6f8fa;
        color: #24292f;
        font-size: 12px;
    }
    QPushButton {
        background: #ffffff;
        color: #24292f;
        border: 1px solid #d0d7de;
        border-radius: 4px;
        padding: 4px 10px;
    }
    QPushButton:hover { background: #f3f4f6; }
    QPushButton:disabled { color: #8c959f; background: #f6f8fa; }
    QSlider::groove:horizontal {
        height: 4px;
        background: #8c959f;
    }
    QSlider::handle:horizontal {
        width: 12px;
        margin: -4px 0;
        border-radius: 6px;
        background: #ff9f1a;
    }
    QProgressBar {
        border: 1px solid #d0d7de;
        border-radius: 3px;
        background: #ffffff;
    }
    QProgressBar::chunk { background: #ff9f1a; }
    #separator { color: #d0d7de; background: #d0d7de; max-height: 1px; }
    #previewTrack {
        border-top: 1px solid #d0d7de;
        border-bottom: 1px solid #ffffff;
    }
    QTextBrowser {
        background: #ffffff;
        color: #24292f;
        border: 1px solid #d0d7de;
        padding: 16px;
    }
    """


def main() -> int:
    app = QApplication(sys.argv)
    window = MainWindow()
    window.show()
    return app.exec()


if __name__ == "__main__":
    raise SystemExit(main())
