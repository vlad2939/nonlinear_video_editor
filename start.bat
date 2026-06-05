@echo off
setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0"

where npm >nul 2>nul
if errorlevel 1 (
  echo npm was not found. Install Node.js LTS from https://nodejs.org/ and run this file again.
  pause
  exit /b 1
)

if not exist node_modules (
  echo Installing project dependencies...
  call npm install
  if errorlevel 1 (
    echo Dependency installation failed.
    pause
    exit /b 1
  )
)

if exist mp3_fit\requirements.txt (
  set "PYTHON_CMD="
  py -3 --version >nul 2>nul
  if not errorlevel 1 set "PYTHON_CMD=py -3"

  if not defined PYTHON_CMD (
    python --version >nul 2>nul
    if not errorlevel 1 set "PYTHON_CMD=python"
  )

  if defined PYTHON_CMD (
    if exist mp3_fit\.venv\Scripts\python.exe (
      mp3_fit\.venv\Scripts\python.exe -c "import sys" >nul 2>nul
      if errorlevel 1 (
        echo Recreating MP3 Fit Python environment...
        rmdir /s /q mp3_fit\.venv
      )
    )

    if not exist mp3_fit\.venv\Scripts\python.exe (
      echo Creating MP3 Fit Python environment...
      !PYTHON_CMD! -m venv mp3_fit\.venv
      if errorlevel 1 (
        echo MP3 Fit environment could not be created. The editor will still start.
      )
    )

    if exist mp3_fit\.venv\Scripts\python.exe (
      echo Installing/checking MP3 Fit dependencies...
      mp3_fit\.venv\Scripts\python.exe -m pip install -r mp3_fit\requirements.txt
      if errorlevel 1 (
        echo MP3 Fit dependencies could not be installed. The editor will still start.
      )
    )
  ) else (
    echo Python was not found. MP3 Fit integration will be unavailable until Python 3.10+ is installed.
  )
)

echo Starting Nonlinear Video Editor...
call npm start
if errorlevel 1 (
  echo The application stopped with an error.
  pause
  exit /b 1
)

endlocal
