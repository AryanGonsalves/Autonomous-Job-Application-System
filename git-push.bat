@echo off
cd /d "C:\Users\Aryan's Laptop\Downloads\Job-Apply-Bot"
del /f /q ".git\index.lock" 2>nul
git config user.email "aryan.gonsalves123@gmail.com"
git config user.name "AryanGonsalves"

REM Rewrite ALL commits to use AryanGonsalves identity
git filter-branch -f --env-filter ^
  "export GIT_AUTHOR_NAME='AryanGonsalves'; ^
   export GIT_AUTHOR_EMAIL='aryan.gonsalves123@gmail.com'; ^
   export GIT_COMMITTER_NAME='AryanGonsalves'; ^
   export GIT_COMMITTER_EMAIL='aryan.gonsalves123@gmail.com';" ^
  --tag-name-filter cat -- --all

git push origin main --force

echo.
echo Done! Press any key to close.
pause
