@echo off
echo Killing existing node processes on port 3000...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":3000"') do taskkill /F /PID %%a 2>nul
timeout /t 2 /nobreak >nul
echo Starting api-server...
cd /d "%~dp0artifacts\api-server"
start "API Server" cmd /k "pnpm dev"
echo Done! Server starting in new window.
