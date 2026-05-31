@echo off
echo === diag restart %DATE% %TIME% === > "%~dp0_startup.log"
echo Killing node on port 3000... >> "%~dp0_startup.log"
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":3000"') do (
  echo killing PID %%a >> "%~dp0_startup.log"
  taskkill /F /PID %%a >> "%~dp0_startup.log" 2>&1
)
timeout /t 3 /nobreak >nul
cd /d "%~dp0artifacts\api-server"
echo Building... >> "%~dp0_startup.log"
call node ./build.mjs >> "%~dp0_startup.log" 2>&1
echo BUILD_EXITCODE=%errorlevel% >> "%~dp0_startup.log"
echo Starting server... >> "%~dp0_startup.log"
node --enable-source-maps --env-file=../../.env ./dist/index.mjs >> "%~dp0_startup.log" 2>&1
echo SERVER_EXITED_CODE=%errorlevel% >> "%~dp0_startup.log"
pause
