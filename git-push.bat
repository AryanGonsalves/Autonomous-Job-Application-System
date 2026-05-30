@echo off
cd /d "C:\Users\Aryan's Laptop\Downloads\Job-Apply-Bot"
del /f /q ".git\index.lock" 2>nul
git config user.email "aryan.gonsalves123@gmail.com"
git config user.name "AryanGonsalves"
git rm --cached replit.md 2>nul
git rm --cached -r attached_assets 2>nul
git rm --cached -r .local 2>nul
git rm --cached -r artifacts/mockup-sandbox 2>nul
git add -A
git commit -m "chore: remove replit.md and other Replit artifacts from repo"
git push origin main
echo.
echo Done! Press any key to close.
pause
