@echo off
cd /d "C:\Users\Aryan's Laptop\Downloads\Job-Apply-Bot"
del /f /q ".git\index.lock" 2>nul
git config user.email "aryan.gonsalves123@gmail.com"
git config user.name "AryanGonsalves"
git add -A
git commit -m "fix: job-boards.greenhouse.io uses listing URL (form is inline, /apply is 404)

- Explicit branch for job-boards.greenhouse.io: strip /apply if present,
  use listing URL as-is (the form is inline on the listing page)
- Broaden hasFormFields guard to match new Greenhouse React UI field selectors
  (autocomplete attributes, aria-label, input[type=email]) so it isn't
  falsely flagged as 'no application form'
- boards.greenhouse.io behavior unchanged (still appends /apply)
"
git push origin main
echo.
echo Done! Press any key to close.
pause
