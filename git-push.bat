@echo off
cd /d "C:\Users\Aryan's Laptop\Downloads\Job-Apply-Bot"
del /f /q ".git\index.lock" 2>nul
git config user.email "aryan.gonsalves123@gmail.com"
git config user.name "AryanGonsalves"
git add -A
git commit -m "fix: reduce Greenhouse polling to 3s for job-boards subdomain; add more retryable errors

- submitter.ts: job-boards.greenhouse.io uses 3s poll timeout (form is
  already on page, no lazy loading) vs 15s for boards.greenhouse.io.
  Cuts 50-failure stall from ~12.5min to ~2.5min.
- scheduler.ts: add 'form validation error at step 0' to retryable list
- CLAUDE.md: update status to 213+ applications
"
git push origin main
echo.
echo Done! Press any key to close.
pause
