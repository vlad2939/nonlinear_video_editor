# MP3 Fit Engine

MP3 Fit is used by Nonlinear Video Editor to extend a selected audio clip to the current video timeline duration.

The editor calls `mp3_fit.cli` from Electron and saves the generated file next to the source audio file as:

```text
source_name_fit.mp3
```

## Runtime Requirements

- Python 3.10 or newer.
- Dependencies from `requirements.txt`.
- FFmpeg from the editor-level vendor folder:

```text
..\vendor\ffmpeg\win64\ffmpeg.exe
..\vendor\ffmpeg\win64\ffprobe.exe
```

The editor `start.bat` prepares the local Python environment automatically when Python is available.

## Files Needed By The Editor

```text
mp3_fit/
  src/
  requirements.txt
  README.md
```

