@echo off
title Job Apply Bot - Starting
echo ========================================
echo  Job Apply Bot - Starting Servers
echo ========================================
echo.

cd /d "%~dp0"

REM Check .env exists
if not exist .env (
    echo ERROR: .env file not found.
    echo Run setup.bat first.
    pause
    exit /b 1
)

REM Kill any existing Node processes on our ports
echo Stopping any existing servers...
for /f "tokens=5" %%a in ('netstat -aon ^| find ":3000" ^| find "LISTENING"') do taskkill /f /pid %%a >nul 2>&1
for /f "tokens=5" %%a in ('netstat -aon ^| find ":5173" ^| find "LISTENING"') do taskkill /f /pid %%a >nul 2>&1
timeout /t 1 /nobreak >nul

echo.
echo Starting API Server (port 3000)...
start "Job Apply Bot - API" cmd /k "cd /d "%~dp0artifacts\api-server" && pnpm dev"
timeout /t 3 /nobreak >nul

echo Starting Dashboard (port 5173)...
start "Job Apply Bot - Dashboard" cmd /k "cd /d "%~dp0artifacts\job-dashboard" && pnpm dev"
timeout /t 3 /nobreak >nul

echo.
echo ========================================
echo  Both servers are starting!
echo.
echo  Dashboard: http://localhost:5173
echo  API:       http://localhost:3000/api
echo.
echo  (Two terminal windows opened in background)
echo ========================================
echo.
pause
