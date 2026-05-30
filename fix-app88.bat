@echo off
curl -s -X PATCH http://localhost:3000/api/applications/88 -H "Content-Type: application/json" -d "{\"status\":\"applied\",\"notes\":\"Reset - false positive email match (Pipe short name matched email body)\"}"
echo.
echo Done. Press any key to close.
pause
