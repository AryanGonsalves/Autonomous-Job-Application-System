@echo off
cd /d "C:\Users\Aryan's Laptop\Downloads\Job-Apply-Bot"
del /f /q ".git\index.lock" 2>nul
git config user.email "aryan.gonsalves123@gmail.com"
git config user.name "AryanGonsalves"
git add -A
git commit -m "fix: make Greenhouse submit errors retryable; update CLAUDE.md

- scheduler.ts: add 'Greenhouse: submit button not found' and
  'Greenhouse: job page not found' to retryable error list — these are
  now marked 'skipped' instead of hard 'failed', so they retry next run
- CLAUDE.md: document both Greenhouse fixes (starvation + retryable)
- Confirmed: randomized queue picks Greenhouse jobs between LinkedIn submissions
"
git push origin main
echo.
echo Done! Press any key to close.
pause
