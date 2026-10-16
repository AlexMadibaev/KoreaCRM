@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-web-preview.ps1"
if errorlevel 1 pause
