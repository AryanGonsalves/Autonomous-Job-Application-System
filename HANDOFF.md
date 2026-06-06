# Job Apply Bot — Full Handoff Context for New Conversation

## ✅ 2026-06-05 — Email verified + keep-alive watchdog

- **Gmail + Yahoo both confirmed working.** Live email import: Gmail connected + fetched
  138/147 inbox emails; Yahoo connected + fetched 696 inbox emails with NO "Connection not
  available" error (the hardening holds); "Email import complete: … 2 confirmations matched".
  Manual/bot Sent-folder separation active.
- **Server kept dying while unattended** (console window closing / crashes) — the #1 reliability
  gap. Added **`watchdog.bat`**: polls `http://localhost:3000/api/scheduler/status` every 45s and
  runs `kill-and-restart.bat` only after **3 consecutive failures** (~2 min real downtime), so it
  won't false-restart during heavy phases (email-sync briefly saturates the event loop). Leave it
  running while away. (For the cloud build this becomes a real process supervisor / health probe.)
- Note: the dashboard (:5173) is a separate Vite process — `start-all.bat` launches both API +
  dashboard; the watchdog only keeps the API alive.

---


## ✅ Greenhouse monoculture fix (2026-06-04)

Diagnosis (verified by opening the boards directly in Chrome): Greenhouse applications were
~all Pinterest (14) + Peloton (2); 148 other jobs (Anthropic, Stripe, Roblox, SoFi, Affirm,
Lyft, Klaviyo, Databricks…) sat "skipped" with NO note. Two causes:
1. **Wrong apply URL.** The scraper stored `absolute_url`, which for some companies is their
   OWN careers site (stripe.com/jobs, careers.roblox.com) — no Greenhouse form to submit.
2. **Complex forms.** Real boards (Affirm/Anthropic on job-boards.greenhouse.io) DO have a
   working "Submit application" button + form (Affirm = 32 fields) but many required
   fields aren't fully completed → validation blocks submit.

Fixes applied:
- `greenhouse.ts`: when `absolute_url` is not a `*.greenhouse.io` domain, store the canonical
  hosted form `https://job-boards.greenhouse.io/{slug}/jobs/{id}` instead — so we never queue
  an unsubmittable company-site URL. (Next scrape inserts corrected records; old custom-URL
  rows stay skipped, harmless.)
- `scheduler.ts`: skip/fail notes can never be blank now (`unknown error (no message
  captured)` fallback) — fixes the "(no note)" blind spot so failures are always diagnosable.
- STILL TODO (#3): harden the multi-field Affirm/Anthropic form fill (required custom fields).

---


## ✅ Location preference is now free-form (2026-06-03)

`locationPreference` is a **user-set** value (edit in Settings / `PUT /api/settings`) that can be
any **city** ("Phoenix, AZ"), **state** ("Arizona" / "TX"), or **nationwide** ("United States" /
"USA" / "Anywhere" / "Nationwide" / "Remote"). Nothing is hardcoded. Implementation:
- New `parseLocationPreference()` in `submitter.ts` classifies the value into `{city, state,
  nationwide}`. Application **city/state fields** (which ask where the APPLICANT lives) only get a
  concrete city typed in; for broad/state-only values the form's pre-filled value is left intact
  (no more typing "USA" into a city autocomplete). Fixed all three fill sites.
- **Indeed search scope** now uses `locationPreference`: broad values → nationwide ("United
  States"); a city/state → that exact `&l=` location. Logs `Indeed: search location = "..."`.
- Default `locationPreference` changed to "United States" (nationwide) for fresh installs.
- (LinkedIn search geography still uses its hardcoded US geoId — wire `&location=` later if needed.)

---


## ✅ Answer-quality fix 2026-06-02 + Cloud plan

- **Root-cause fix for wrong screening answers.** `aiClient.inferFromResume` had a hardcoded
  `require sponsorship → "No" (0.9)` which is WRONG for an F-1/STEM-OPT applicant (will need
  future H-1B sponsorship) — it kept regenerating bad answers (e.g. bank id 275). Replaced with
  an authoritative **profile-facts layer**: sponsorship/visa → "Yes"; authorized-to-work-now →
  "Yes"; authorized-WITHOUT-sponsorship → "No (will need future sponsorship)"; US citizen / green
  card / permanent resident → "No"; security clearance → "No"; 18+ → "Yes"; felony/criminal → "No";
  background check/drug screen → "Yes"; **EEO self-id (gender/race/ethnicity/veteran/disability) →
  "I prefer not to disclose" (never fabricated)**; GPA → "3.8". Corrected the existing bad bank
  entry (id 275) to "Yes" via the API. For the multi-user cloud version these constants must
  become a per-user profile object (see CLOUD_DEPLOYMENT_PLAN.md).
- **Cloud-deployable plan** added in `CLOUD_DEPLOYMENT_PLAN.md` (Docker, Postgres, S3 sessions,
  secrets manager, queue/cron, per-user profile, auth; headed-login + ToS caveats).
- **#3 (done): numeric answers stored as clean numbers.** `generateAtsAnswer` now coerces
  years/salary/notice/1-10-rating questions to a bare number at every return path (saved /
  resume / AI), so the bank no longer stores prose like "approximately 0 years" for numeric
  fields. (Yes/No radios are unaffected — those go through `generateYesNoAnswer`.)
- **#4 (done): bank consistency checker + dedup endpoints.** `GET /api/questions/issues`
  returns contradiction groups (same normalized question, different answers — e.g. the old
  275-vs-244 sponsorship clash). `POST /api/questions/dedup` collapses duplicate normalized
  questions, keeping the best row (answered first, then user > resume > saved > ai, then
  highest confidence). Run dedup once after deploy to shrink the ~296-entry bank.

---


## ✅ Fixes applied 2026-06-02 (Indeed scraper — deploy-blocker)

- **Indeed scraper no longer hangs automated runs.** `scrapers/indeed.ts` used fragile profile-icon selectors in `isLoggedIn()`; when Indeed changed its header DOM it false-negatived even with a valid `indeed_session.json`, so the scraper opened a **headed manual-login window and blocked ~3 min every run**. Fix: `isLoggedIn` is now lenient (logged-in unless redirected to /login or a visible "Sign in" link), and the automated path **never launches an interactive login** — with no valid session it warns and skips Indeed (`{scraped:0}`). Login stays an explicit action: `POST /api/auth/indeed` (Settings → Indeed login).
- `GET /api/jobs` already returns `notes` (full row) → attempt-cap `[attempt:N]` and failure reasons are inspectable.
- Remaining items are data/inherent, not code bugs: expand Lever slug list; prune custom-ATS redirect companies (Carta, Risk Ops) from `greenhouse_companies.json`; LinkedIn ATS-overlay failures are a third-party limitation.

---


## ✅ Fixes applied 2026-06-01 (compiled + pushed)

- **Retryable requeue-loop cap.** `scheduler.ts` records `[attempt:N]` in `jobs.notes` (preserved across retry-failed) and after **MAX_RETRYABLE_ATTEMPTS = 4** marks a retryable failure `failed` instead of `skipped`. `routes/jobs.ts` `retry-failed` resets all `skipped` but keeps `failed` jobs with `[attempt:N] ≥ 4`. This stops DriveWealth/ALO (JOB_TIMEOUT) and "Easy Apply not found" jobs from cycling back to `queued` every run and draining the daily limit.
- **Greenhouse Affirm "submit button not found".** The 15s lazy-render submit-button poll now also covers `job-boards.greenhouse.io` (previously only `boards.greenhouse.io`). Should fix Affirm-type boards if the button was simply mounting after the old 3s fast-fail window.
- **Indeed** left `enableIndeed=true` (user's explicit choice). Still wastes ~3min/run until a manual Indeed login creates `sessions/indeed_session.json`. Recommended follow-ups (NOT yet applied): session-file pre-check in `scrapers/indeed.ts` to skip fast; make "job no longer available" retryable.

---

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

---

## Run Verification 2026-06-01

**Run triggered**: 09:04 UTC (manual via POST /api/scheduler/run-now). Monitored for ~50 minutes. Run still active at verification end.

### Scraping Phase (completed ~09:13 UTC)
| Platform | Scraped | Filtered non-US | Notes |
|---|---|---|---|
| LinkedIn | 17 new jobs | 2 | 4 keywords × ~14 cards each |
| Greenhouse | 6 new jobs | 0 | 180 companies, API-based |
| Lever | 0 new jobs | 26 | 83 companies, already in DB |
| Handshake (ASU) | 0 new jobs | 0 | SSO login successful, no new listings |
| Indeed | FAILED | — | TimeoutError: 3-min login window expired; no session file |
- Total new: 23 jobs scraped this run
- Indeed scraping failed because `enableIndeed=true` but no `sessions/indeed_session.json` exists; wastes ~3min per run

### Submission Phase (applying, observed 09:15–09:47+ UTC)
| Platform | Submitted | Failed/Skipped | Top failure reason |
|---|---|---|---|
| **LinkedIn** | **3** | ~15+ | JOB_TIMEOUT (long forms >4min), Easy Apply not found, ATS overlays |
| **Greenhouse** | **1** | 5 | Custom career page redirect (Roblox, Figma, Robinhood), submit btn not found (Affirm) |
| **Lever** | **0** | 0 | No queued Lever jobs reached in observed window |
| **Indeed** | **0** | 1 | "job is no longer available" (job 57, ClearSky Solar) |
| **Handshake** | **0** | 0 | No queued Handshake jobs reached |

**Total submitted during monitoring: 4 applications** (3 LinkedIn + 1 Greenhouse)
- totalAllTime went 249 → 253 during monitoring
- totalToday = 4 confirmed

**LinkedIn successes** (observed):
1. "DOMO Certified Business Analyst" at Minisoft Technologies LLC — modal-detached (09:33 UTC)
2. "Quantitative Researcher" at Durlston Partners — modal-detached (09:39 UTC)
3. "Jr. Business Analyst" at Marathon TS — modal-detached (09:42 UTC)

**Greenhouse success**:
1. "Sr. Machine Learning Engineer, Responsible AI – Applied Research Science" at Pinterest (09:43 UTC)

### Greenhouse "Submit Button Not Found" — Status
**PARTIALLY FIXED, NOT FULLY RESOLVED.** The iframe-resolution fix (from 2026-05-31) works for some Greenhouse forms. Observed this run:
- **Affirm** (job 1161, "Business Systems Analyst II"): still throws "Greenhouse: submit button not found on [URL]" — the standard Greenhouse board, not a custom page
- **Chime, Figma x2, Robinhood, Roblox**: "no application form found — likely a custom career page" (these are custom redirects, correctly identified as such and skipped retryably)
- **The Trade Desk** (job 1199): "form still present after submit — possible validation error"
- **Pinterest** (job 934, 1019): one previously failed (browser closed), one **succeeded** this run at Pinterest
- **Net**: the submit-button-not-found error still occurs on standard Greenhouse boards (Affirm confirmed). The iframe fix resolves embedded-iframe cases but not all standard board flows.

### Email Import Results
Email import ran at 09:37 UTC (triggered manually via POST /api/import/email):
- Gmail: fetched 179 inbox emails
- Yahoo: fetched 716 inbox emails
- Imported 0 new applications, updated 0 statuses, **1 confirmation matched**
- Prior confirmed total was 49; now **50 confirmed applications** (49 previously documented + 1 new from this import run)
- importManualFromSent=false (Sent folder scan disabled, correct)

### Current Stats (as of ~09:47 UTC)
- **totalAllTime**: 253 submitted applications
- **totalToday**: 4
- **totalQueued**: 433
- **totalFailed**: 3 (1 new: Indeed "job no longer available")
- **Confirmed applications**: ~50 (49 prior + 1 from this import)
- Platform breakdown (all-time applications): LinkedIn 178, Lever 39, Greenhouse 7

### Recommended Code Fixes / Improvements

1. **Disable Indeed or fix session**: `enableIndeed=true` with no session file wastes 3+ min per run and causes a hard `application failed` error (not retryable). Either set `enableIndeed=false` until login is done, or make the scraper skip gracefully when no session file exists rather than opening a browser login window that times out.

2. **Greenhouse submit-button-not-found (Affirm-type)**: The iframe fix resolved embedded cases but standard Greenhouse boards like Affirm still fail. Need to investigate why the submit button selector chain fails for Affirm specifically — the form loads but no button is found. May need a broader selector or a wait-for-form-ready check before looking for the button.

3. **LinkedIn JOB_TIMEOUT on very long forms (DriveWealth, ALO ERP)**: These jobs hit the 4-minute per-job limit at steps 7+. The DriveWealth form has 20+ pages noted in CLAUDE.md. These re-queue forever (retryable). Consider adding a `maxRetries` counter per job and marking them permanently failed/skipped after N retries to stop wasting budget on them.

4. **LinkedIn "Easy Apply button not found" on non-US/expired jobs**: Multiple skips per run on jobs that redirect to `/jobs` homepage or are non-US (Turing, ERMA, BeaconFire). These re-queue but won't ever succeed. Consider: after N skips of this type, mark permanently skipped; or re-check job status before attempting.

5. **Indeed "job no longer available" as hard failure**: The Indeed submitter marks this as a non-retryable `failed` (confirmed: totalFailed incremented). It should be retryable (mark skipped) since it's a stale job state issue.

6. **Prioritize Greenhouse/Lever over LinkedIn in phase 3**: RANDOM() ordering now ensures fairness but Greenhouse/Lever jobs still compete with LinkedIn. Per previous recommendation, consider giving them a guaranteed sub-budget of N jobs per run to ensure API-based platforms always get a chance.

7. **The Trade Desk Greenhouse form validation error**: "form still present after submit" suggests a required field isn't being filled. Could add more debug info or widen the question-filling logic for this board.

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
