@echo off
setlocal enabledelayedexpansion
echo [restart] Killing node process(es) LISTENING on port 3000...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr /R /C:":3000 .*LISTENING"') do (
  echo   taskkill /F /PID %%a
  taskkill /F /PID %%a >nul 2>&1
)

REM Wait until port 3000 is actually free before starting (root cause of the
REM old race: a busy node process kept :3000, so the new server crashed on
REM EADDRINUSE and the stale process kept serving). Poll up to ~40s.
set /a tries=0
:waitfree
set "busy="
for /f "tokens=5" %%a in ('netstat -aon ^| findstr /R /C:":3000 .*LISTENING"') do (
  set "busy=%%a"
)
if defined busy (
  set /a tries+=1
  if !tries! GEQ 40 (
    echo [restart] WARNING: port 3000 still held by PID !busy! after 40s - force-killing again
    taskkill /F /PID !busy! >nul 2>&1
    set /a tries=0
  )
  timeout /t 1 /nobreak >nul
  goto waitfree
)
echo [restart] Port 3000 is free.

cd /d "%~dp0artifacts\api-server"
echo [restart] Building and starting api-server (build then listen)...
start "API Server" cmd /k "pnpm dev"
echo [restart] Launched. VERIFY: GET http://localhost:3000/api/scheduler/status returns 200
echo [restart] and that the running code reflects your latest changes before trusting it.
timeout /t 2 /nobreak >nul
endlocal
