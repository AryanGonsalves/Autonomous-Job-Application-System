@echo off
REM Job Apply Bot — start BOTH services: API (:3000) and Dashboard (:5173).
REM Free port 3000 first so the API binds cleanly (avoids the EADDRINUSE race).
echo [start-all] Freeing port 3000 if held...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr /R /C:":3000 .*LISTENING"') do taskkill /F /PID %%a >nul 2>&1
timeout /t 2 /nobreak >nul

echo [start-all] Starting API server (build + listen) on http://localhost:3000 ...
start "Job Apply Bot - API" cmd /k "cd /d %~dp0artifacts\api-server && pnpm dev"

timeout /t 4 /nobreak >nul
echo [start-all] Starting Dashboard on http://localhost:5173 ...
start "Job Apply Bot - Dashboard" cmd /k "cd /d %~dp0artifacts\job-dashboard && pnpm dev"

echo.
echo [start-all] Both starting in their own windows. Open http://localhost:5173 in your browser.
echo [start-all] (Give them ~15-20s to build on first launch.)
