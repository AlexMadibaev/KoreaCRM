@echo off
cd /d "%~dp0.."
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0restart-local-crm.ps1"
set CRM_RESTART_RESULT=%errorlevel%
if not "%CRM_RESTART_RESULT%"=="0" pause
exit /b %CRM_RESTART_RESULT%