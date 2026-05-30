@echo off
cd /d "C:\Users\Aryan's Laptop\Downloads\Job-Apply-Bot"
del /f /q ".git\index.lock" 2>nul
git config user.email "aryan.gonsalves123@gmail.com"
git config user.name "AryanGonsalves"
git add -A
git commit -m "feat: randomize apply queue for fair platform coverage; fix Greenhouse starvation

- scheduler.ts: add ORDER BY RANDOM() to jobsToApply query so Greenhouse/Lever
  jobs get submitted alongside LinkedIn instead of always being skipped
- extractYearsNumber() now defined in submitter.ts (was called but missing)
- 191+ applications submitted; Lever 90%% confirmation rate via IMAP
- LinkedIn 125 applied, Lever 39, Greenhouse 2 (now fixed with random ordering)
- All IMAP (Gmail + Yahoo) working; 40 confirmed apps matched
"
git push origin main
echo.
echo Done! Press any key to close.
pause
