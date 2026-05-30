@echo off
curl -s -X POST http://localhost:3000/api/scheduler/run-now
echo.
echo Run triggered. Check the dashboard logs.
pause
