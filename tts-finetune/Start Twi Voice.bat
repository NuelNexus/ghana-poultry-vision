@echo off
rem Twi Voice: type Twi, hear it. Opens http://127.0.0.1:7860 in your browser.
cd /d "%~dp0"
set PYTHONIOENCODING=utf-8
".venv\Scripts\python.exe" app\server.py %*
pause
