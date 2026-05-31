@echo off
cd /d "C:\Users\Aryan's Laptop\Downloads\Job-Apply-Bot"
set LOG=_gitop.log
echo === git op %DATE% %TIME% === > "%LOG%"
del /f /q ".git\index.lock" 2>nul
del /f /q ".git\config.lock" 2>nul
git config user.email "aryan.gonsalves123@gmail.com" >> "%LOG%" 2>&1
git config user.name "AryanGonsalves" >> "%LOG%" 2>&1

REM keep transient logs out of the repo
findstr /x /c:"_startup.log" .gitignore >nul 2>&1 || echo _startup.log>> .gitignore
findstr /x /c:"_gitop.log" .gitignore >nul 2>&1 || echo _gitop.log>> .gitignore

git add -A >> "%LOG%" 2>&1
echo --- staged --- >> "%LOG%"
git diff --cached --name-only >> "%LOG%" 2>&1
git commit -m "fix: harden Greenhouse submit (iframe/frame resolution + numeric questionnaire fields), add email confirmation tracking without manual/bot conflation, harden Yahoo IMAP; update CLAUDE.md" >> "%LOG%" 2>&1
echo COMMIT_EXITCODE=%errorlevel% >> "%LOG%"

echo --- rewriting authorship to AryanGonsalves on all commits --- >> "%LOG%"
git filter-branch -f --env-filter "export GIT_AUTHOR_NAME='AryanGonsalves'; export GIT_AUTHOR_EMAIL='aryan.gonsalves123@gmail.com'; export GIT_COMMITTER_NAME='AryanGonsalves'; export GIT_COMMITTER_EMAIL='aryan.gonsalves123@gmail.com';" --tag-name-filter cat -- --all >> "%LOG%" 2>&1
echo FILTER_EXITCODE=%errorlevel% >> "%LOG%"

git push origin main --force >> "%LOG%" 2>&1
echo PUSH_EXITCODE=%errorlevel% >> "%LOG%"
echo === done === >> "%LOG%"
pause
