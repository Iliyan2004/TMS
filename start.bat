@echo off
cd /d "%~dp0"
".runtime
ode-v24.21.0-win-x64
ode.exe" server.js
pause
