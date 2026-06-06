@echo off
REM Job Apply Bot — keep-alive watchdog.
REM Polls the API every 45s; if it's unreachable 3 times in a row (~2 min of real
REM downtime), it runs kill-and-restart.bat. The 3-strike threshold avoids false
REM restarts during heavy phases (e.g. email-sync briefly saturates the event loop).
REM Leave this window open while you're away. Double-click to start.
setlocal enabledelayedexpansion
cd /d "%~dp0"
set FAILS=0
echo [watchdog] started %DATE% %TIME% - monitoring http://localhost:3000
:loop
powershell -NoProfile -Command "try{Invoke-WebRequest -UseBasicParsing -TimeoutSec 8 http://localhost:3000/api/scheduler/status ^| Out-Null; exit 0}catch{exit 1}"
if errorlevel 1 (set /a FAILS+=1) else (set FAILS=0)
if !FAILS! GEQ 3 (
  echo [watchdog] %DATE% %TIME% - API down 3x in a row, restarting...
  call "%~dp0kill-and-restart.bat"
  set FAILS=0
  timeout /t 40 /nobreak >nul
) else (
  echo [watchdog] %DATE% %TIME% - ok ^(fails=!FAILS!^)
)
timeout /t 45 /nobreak >nul
goto loop
