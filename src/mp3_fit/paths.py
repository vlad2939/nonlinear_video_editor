from __future__ import annotations

from pathlib import Path


EDITOR_ROOT = Path(__file__).resolve().parents[3]
FFMPEG = EDITOR_ROOT / "vendor" / "ffmpeg" / "win64" / "ffmpeg.exe"
FFPROBE = EDITOR_ROOT / "vendor" / "ffmpeg" / "win64" / "ffprobe.exe"


def ensure_vendor_ffmpeg() -> None:
    missing = [str(path) for path in (FFMPEG, FFPROBE) if not path.exists()]
    if missing:
        joined = "\n".join(missing)
        raise FileNotFoundError(f"Missing FFmpeg files from the editor vendor folder:\n{joined}")
