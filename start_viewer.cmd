@echo off
cd /d "%~dp0"
py -3 -X utf8 prepflow.py --serve %*
if errorlevel 1 pause
