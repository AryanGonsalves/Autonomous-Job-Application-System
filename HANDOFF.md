# Job Apply Bot — Full Handoff Context for New Conversation

## ⚠️ Session 2026-05-31 — Findings & Fixes (READ FIRST)

- **248 applications all-time; 425 queued.** Server verified healthy on :3000 with all fixes compiled into `dist`.
- **Root cause of "fixes not working": the rebuild had been silently failing.** Restarts via `kill-and-restart.bat` raced an email-import-saturated node process that held port 3000, so the freshly built server crashed on `listen()` (EADDRINUSE) and the **old, stale-code** process kept serving. After clearing the stuck process and rebuilding cleanly (`BUILD_EXITCODE=0`, "Server listening port 3000"), `dist/index.mjs` now contains every fix. **Always confirm `GET /api/scheduler/status` returns 200 AND new code is live after a restart; if an email import is running, wait for it (or kill node) before restarting.** `_diag-restart.bat` rebuilds and tees stdout to `_startup.log` for diagnosis.
- **Submission success rate ~15%, dominated by LinkedIn ATS-overlay (Workable/Ceipal) validation failures** — a known/expected limitation. Retryable failures cycle back to `queued` each run. Phase 3 has no priority ORDER BY, so LinkedIn jobs can consume the daily budget before higher-yield Greenhouse/Lever (API-based) are reached. **Recommended:** prioritise greenhouse/lever in phase-3 `jobsToApply`, or give them a separate sub-budget.

### Fixes applied & pushed this session
- **Greenhouse submitter (`submitter.ts`):** resolves the real embedded `Frame` via a broad selector (`#grnhse_app iframe, iframe[id*="grnhse"], iframe[title*="greenhouse"]`, …) instead of a hard-coded `iframe[src*="greenhouse.io"]` — fixes "submit button not found" on Roblox/PubMatic custom career pages. Custom-question loop now coerces numeric fields (years/salary/notice) to a bare number (defaults: current salary `0`, expected/desired `85000` annual, notice `0`, else `extractYearsNumber()`).
- **Email importer (`emailImporter.ts`):** (1) Sent-folder manual import is gated behind `importManualFromSent` (default `false`) so manual applies are never conflated with the bot's. (2) New confirmation tracking flags a bot application confirmed only when a confirmation email arrives at/after that app's `appliedAt` (5-min skew grace), writing `[confirmed] <ISO>` to `applications.notes`; result includes `confirmed`/`confirmations`. (3) Yahoo IMAP hardened (`disableAutoIdle`, `greetingTimeout`, post-connect `usable` check, `error` handler, one reconnect retry) — Yahoo now connects and fetches ~760 emails. **49 bot applications have verified confirmations** as of this session.
- **`settings.ts`:** added `importManualFromSent` default.
- Plain confirmation emails never change status — only AI-classified rejected/interview/offer do, so "updated 0 statuses" is normal when only confirmations exist.

### Git / repo
- All code fixes committed and **force-pushed to `main`**; **all commits rewritten to author AryanGonsalves (replit-agent removed)** via the `git-push.bat` filter-branch flow.
- `CLAUDE.md` is **gitignored** (local agent context only) — session findings live there locally and in this HANDOFF.md (tracked).

### Restart race fixed + Indeed re-enabled (later in session)
- **`kill-and-restart.bat` rewritten** to fix the EADDRINUSE race that caused stale code to keep serving: it now kills only the PID LISTENING on :3000, then **polls until the port is free (up to ~40s)** before rebuild+start. Verified live (server returns 200 cleanly). Pushed.
- **Indeed re-enabled (config):** `submitIndeed` is a complete implementation, not a stub; it was disabled by `enableIndeed="false"` in the DB. Set to `"true"` (persisted). **Still requires a one-time manual Indeed login** to create `sessions/indeed_session.json` — until then submissions throw `SESSION_EXPIRED` → `skipped` (retryable). Agent cannot perform the login (credentials). Flip back to `"false"` if the per-attempt waste (~15–30s) is undesirable before logging in.

---

## Current State (as of 2026-05-28, 4:30 PM local)

- **189 total applications submitted** (all-time)
- **417 jobs queued** for next run
- **Server is running** on port 3000 (cmd window open, do not close)
- **Scheduler slots**: 1:00 AM, 8:00 AM, 5:30 PM (local time)
- **Next scheduled run**: 1:00 AM tonight

---

## What Was Done This Session (Sonnet conversation — fixes applied but NOT yet tested)

All code changes are saved to disk. Server was just restarted at 4:30 PM and is running with all fixes live. The test run was NOT triggered yet — do that first thing.

### Fix 1: Greenhouse URL Bug (CRITICAL — was causing ~60 failures per run)
**File**: `artifacts/api-server/src/lib/submitter.ts` — `submitGreenhouse()` function

**Problem**: `/apply` was appended after query strings, making broken URLs:
- `boards.greenhouse.io/braze/jobs/123?gh_jid=123` → `...?gh_jid=123/apply` ❌
- Should be: `boards.greenhouse.io/braze/jobs/123/apply?gh_jid=123` ✅

**Fix**: Uses `new URL()` to insert `/apply` before the query string for `greenhouse.io` hostnames. Custom career pages (Roblox `careers.roblox.com`, PubMatic `pubmatic.com`) use URL as-is since they embed Greenhouse via iframe.

### Fix 2: Broader Greenhouse Submit Button Selectors
**File**: `artifacts/api-server/src/lib/submitter.ts` — `submitGreenhouse()`

Added 8 fallback selectors tried in order:
`input[type="submit"]`, `button[type="submit"]`, `button[id*="submit"]`, `button[class*="submit"]`, `button:has-text("Submit Application")`, `button:has-text("Submit")`, `button:has-text("Apply")`, `a[class*="submit"]`

### Fix 3: LinkedIn Numeric Field Detection (salary, notice period)
**File**: `artifacts/api-server/src/lib/submitter.ts` — `fillScreeningQuestions()`

**Problem**: Fields like "What is your current monthly salary?" and "What is your notice?" were getting long AI prose answers. Validation error: "Enter a decimal number larger than 0.0"

**Fix**: Added salary/notice/compensation to `isNumericField` check, with domain-specific defaults:
- Current salary → `"0"` (student/intern)
- Expected salary → `"7000"` (monthly, reasonable for new grad)
- Notice period → `"0"` (can start immediately)

### Fix 4: LinkedIn Dropdown (select) Now Uses AI + React Events
**File**: `artifacts/api-server/src/lib/submitter.ts` — `fillScreeningQuestions()`

**Problem**: "Do you agree to work W2 only?" dropdown stuck on "Select an option" because React synthetic events weren't firing.

**Fix**: 
- For yes/no dropdowns: uses `generateYesNoAnswer()` to pick correct option
- Fires React-compatible events: `nativeInputValueSetter` + `dispatchEvent("input")` + `dispatchEvent("change")`
- Then also calls Playwright's `selectOption()` as fallback

### Fix 5: Error Messages Now Saved to jobs.notes
**File**: `artifacts/api-server/src/lib/scheduler.ts`

**Problem**: When a job failed, error was only in logs, not in the DB. Hard to debug.

**Fix**: `.set({ status: isRetryable ? "skipped" : "failed", notes: errMsg.slice(0, 500) })`

### Fix 6: Doubled LinkedIn Job Titles Fixed
**File**: `artifacts/api-server/src/lib/scrapers/linkedin.ts`

**Problem**: Titles like "Scala Developer with FujistuScala Developer with Fujistu" — LinkedIn DOM has title repeated for screen readers, `textContent` concatenated both.

**Fix**: After extracting title, checks if string is exact double of itself and deduplicates.

### Fix 7: Yahoo IMAP "Connection not available"
**File**: `artifacts/api-server/src/lib/emailImporter.ts`

**Problem**: Yahoo IMAP connection dropped after long Gmail inbox processing. Error: "Connection not available"

**Fix**:
- Added 30s connect timeout with `Promise.race()`
- Added `socketTimeout: 30000` to ImapFlow config
- Added `safeLogout()` helper that catches logout errors
- Added 2s pause between Gmail and Yahoo connections
- Reduced inbox fetch window from 30 days → 14 days to prevent timeout

---

## What Needs to Be Done (in order)

### 1. FIRST: Trigger a test run and verify Greenhouse fix works
```
curl -X POST http://localhost:3000/api/scheduler/run-now
```
Or double-click `run-now.bat` in the Job-Apply-Bot folder.

Watch the server console for Greenhouse submissions — should see SUCCESS logs instead of "submit button not found" or broken URL errors. Look for: `Greenhouse: submitted application for "..." at ...`

### 2. Check email confirmations after 4:23 PM May 28 2026
Trigger email import:
```
curl -X POST http://localhost:3000/api/import/email
```
Cross-check returned `details` array (company, oldStatus, newStatus) against applications DB at `GET /api/applications`.

Manually check Gmail (aryan.gonsalves123@gmail.com) and Yahoo (Aryan_gonsalves@yahoo.com) for:
- Application confirmation emails
- Any interview requests
- Any rejections

### 3. Check for any remaining submission failures
After the test run, query failed jobs:
```
GET http://localhost:3000/api/jobs?status=failed&limit=30
```
Each failed job now has `notes` field with the actual error message. Categorize and fix any new patterns.

### 4. LinkedIn session validity
If LinkedIn submissions fail with SESSION_EXPIRED:
- Delete `artifacts/api-server/sessions/linkedin_session.json`
- The scraper will re-authenticate on next run

### 5. Monitor question bank
Visit `http://localhost:5173/questions` on the dashboard. Answer any questions marked "Needs Review" — these are ATS questions where confidence < 0.6. Your answers get saved and reused on future applications.

---

## Known Issues / Expected Failures (not bugs, don't fix)

- **Greenhouse "job page not found or closed"**: Stale postings from Doximity, Scopely, etc. Already closed. Correct behavior — they get marked failed and stay failed.
- **LinkedIn Ceipal/Workable ATS overlay**: Jobs that embed a third-party ATS (Workable, Ceipal) inside LinkedIn Easy Apply fail at step 0 with ~3-6 validation errors. Skipped quickly. This is expected — can't reliably fill React dropdowns via DOM manipulation.
- **LinkedIn "Easy Apply button not found"**: Job was removed or requires external application. Marked `skipped` (retryable).

---

## Architecture Quick Reference

### Running the server
```
# Windows — double-click:
C:\Users\Aryan's Laptop\Downloads\Job-Apply-Bot\kill-and-restart.bat

# Trigger a run immediately:
C:\Users\Aryan's Laptop\Downloads\Job-Apply-Bot\run-now.bat
```

### Key files
| File | Purpose |
|------|---------|
| `artifacts/api-server/src/lib/submitter.ts` | All submission logic (LinkedIn, Greenhouse, Lever, Handshake) |
| `artifacts/api-server/src/lib/scheduler.ts` | Pipeline orchestration (phases 1-4) |
| `artifacts/api-server/src/lib/scrapers/linkedin.ts` | LinkedIn scraper + Easy Apply |
| `artifacts/api-server/src/lib/greenhouse.ts` | Greenhouse API scraper |
| `artifacts/api-server/src/lib/emailImporter.ts` | IMAP email sync |
| `artifacts/api-server/src/lib/aiClient.ts` | GPT-4o-mini for cover letters + ATS answers |
| `artifacts/api-server/src/data/greenhouse_companies.json` | 180 companies tracked via Greenhouse API |
| `artifacts/api-server/sessions/linkedin_session.json` | LinkedIn session cookies |

### API endpoints
```
GET  /api/stats/summary          — overall stats
GET  /api/scheduler/status       — running/phase/applicationsToday
GET  /api/scheduler/history      — run history with counts
GET  /api/scheduler/logs         — last 100 automation log entries
POST /api/scheduler/run-now      — trigger immediate run
POST /api/jobs/retry-failed      — reset failed+skipped → queued
GET  /api/jobs?status=failed     — list failed jobs (now has notes field)
POST /api/import/email           — run IMAP email sync
GET  /api/questions?needsReview=true — ATS questions needing answers
```

### Dashboard
- Frontend: http://localhost:5173
- Backend API: http://localhost:3000/api

### Scheduler phases
1. **Scraping**: LinkedIn, Greenhouse (180 companies), Lever, Handshake
2. **Cover letters**: GPT-4o-mini generates for all queued jobs
3. **Submissions**: 3-12s delay between jobs, Playwright browser automation
4. **Email sync**: IMAP Gmail + Yahoo, updates application statuses

### Database (SQLite via Drizzle ORM)
- `jobs`: all scraped jobs with status (queued/applied/failed/skipped/filtered_non_us)
- `applications`: successful applications with status (applied/interview/offer/rejected)
- `questions_bank`: saved ATS question/answer pairs
- `run_history`: per-run stats
- `settings`: key-value config (credentials, keywords, resume path)

---

## Stats as of Session End
- Total submitted (all-time): **189**
- Queued for next run: **417**
- Failed (reset to queued): **0** (all reset)
- Filtered non-US: **235**
- Run history: 44 runs total

## Credentials (already configured in Settings)
- LinkedIn: Aryan_gonsalves@yahoo.com
- Gmail IMAP: aryan.gonsalves123@gmail.com (app password set)
- Yahoo IMAP: Aryan_gonsalves@yahoo.com (app password set)
- OpenAI: configured
- Resume: uploaded (Aryan_Gonsalves_Resume_Updated_latest.docx)

---

## Prompt for new Opus conversation

Paste this at the start:

> I have a Job Apply Bot — a TypeScript monorepo that automates job applications across LinkedIn, Greenhouse, Lever, and Handshake. The server is running on port 3000. There are 417 jobs queued. Several code fixes were just applied (see HANDOFF.md in the project root at C:\Users\Aryan's Laptop\Downloads\Job-Apply-Bot\). 
>
> Please read HANDOFF.md first, then CLAUDE.md (both in the project root) to get full context. Then:
> 1. Trigger a test run via `POST http://localhost:3000/api/scheduler/run-now` using Chrome MCP or a curl bat file
> 2. Monitor the logs and verify the Greenhouse URL fix is working
> 3. Check email confirmations after 4:23 PM May 28 2026 via `POST http://localhost:3000/api/import/email`
> 4. Fix any remaining issues found
> 5. Make the app production ready
>
> The mounted folder is C:\Users\Aryan's Laptop\Downloads\Job-Apply-Bot\. Use computer use tools to double-click bat files for server restart. The dashboard is at http://localhost:5173. Update CLAUDE.md with any new findings.
