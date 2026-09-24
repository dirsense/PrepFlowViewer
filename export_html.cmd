@echo off
cd /d "%~dp0"
if "%~1"=="" (
  py -3 -X utf8 prepflow.py --pick --open
) else (
  py -3 -X utf8 prepflow.py "%~1" --open
)
if errorlevel 1 pause
