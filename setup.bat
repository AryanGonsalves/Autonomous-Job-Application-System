@echo off
title Job Apply Bot - Setup
echo ========================================
echo  Job Apply Bot - First Time Setup
echo ========================================
echo.

REM Check Node.js
node --version >nul 2>&1
if errorlevel 1 (
    echo ERROR: Node.js is not installed.
    echo Please download and install it from https://nodejs.org/
    pause
    exit /b 1
)
echo [OK] Node.js found:
node --version

REM Check pnpm
pnpm --version >nul 2>&1
if errorlevel 1 (
    echo Installing pnpm...
    npm install -g pnpm
)
echo [OK] pnpm found:
pnpm --version

echo.
echo Installing dependencies (this may take a minute)...
cd /d "%~dp0"
call pnpm install
if errorlevel 1 (
    echo ERROR: Dependency installation failed.
    pause
    exit /b 1
)
echo [OK] Dependencies installed

echo.
echo Creating .env file...
if not exist .env (
    copy .env.example .env >nul
    echo [OK] Created .env from template
) else (
    echo [OK] .env already exists, skipping
)

echo.
echo ========================================
echo  Setup complete!
echo.
echo  Next steps:
echo    1. Double-click start.bat to launch
echo    2. Open http://localhost:5173
echo    3. Go to Settings and enter your credentials
echo ========================================
echo.
pause
