@echo off
cd /d "C:\Users\Aryan's Laptop\Downloads\Job-Apply-Bot"
del /f /q ".git\index.lock" 2>nul
git config user.email "aryan.gonsalves123@gmail.com"
git config user.name "AryanGonsalves"
git add -A
git commit -m "fix: Greenhouse submit button polling + job-boards URL + retryable errors

submitter.ts (Opus fix):
- Replace single-pass submit selector check with 15s polling loop that
  scrolls the page bottom and retries all selectors while React renders
- Add scrollIntoViewIfNeeded() + force-click fallback for sticky overlays
- Add selector variants: 'Submit your application', 'Submit my application',
  button[aria-label*='Submit'], div[role=button]:has-text('Submit')
- Guard custom career pages (e.g. Stripe) with no-form detection to throw
  early with a clear message instead of 'submit button not found'
- Fix job-boards.greenhouse.io URL: don't append /apply (causes 404);
  only boards.greenhouse.io gets the /apply path appended

scheduler.ts:
- ORDER BY RANDOM() in apply queue for fair platform coverage
- Add Greenhouse submit/page-not-found errors to retryable list

CLAUDE.md: document all fixes
"
git push origin main
echo.
echo Done! Press any key to close.
pause
