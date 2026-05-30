@echo off
cd /d "C:\Users\Aryan's Laptop\Downloads\Job-Apply-Bot"
del /f /q ".git\index.lock" 2>nul
git config user.email "aryan.gonsalves123@gmail.com"
git config user.name "AryanGonsalves"
git add -A
git commit -m "docs: update README with current status and known limitations"
git push origin main
echo.
echo Done! Press any key to close.
pause
