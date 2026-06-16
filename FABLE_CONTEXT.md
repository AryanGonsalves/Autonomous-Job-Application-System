# Job Apply Bot — Context & Open Issues (for an agent to fix)

This file is a self-contained brief. Read it fully before changing anything. The goal of the
app: automatically scrape data/analyst/DS job postings and submit applications across
LinkedIn, Indeed, Greenhouse, Lever, and Handshake (ASU), tracking confirmations via email.

Owner profile (used by the answer logic): **Aryan Gonsalves** — M.S. Data Science @ ASU
(May 2026, GPA 3.8), Tempe AZ. **F-1, on/eligible for OPT/STEM-OPT: authorized to work now,
WILL need visa sponsorship (H-1B) in the future.** Targeting Data Scientist / Data Analyst /
BI roles. Early-career (~1–2 yrs via internships/projects).

---

## 1. Architecture & layout

- pnpm monorepo. Root: `C:\Users\Aryan's Laptop\Downloads\Job-Apply-Bot`.
- **Backend** (Express + TS): `artifacts/api-server/` → builds via esbuild (`node build.mjs`) to
  `dist/index.mjs`; runs on **:3000** (PORT from `../../.env`). The in-process scheduler
  auto-starts on boot.
- **Frontend** (React + Vite): `artifacts/job-dashboard/` → **:5173**.
- **DB** (Drizzle + libsql/SQLite): `lib/db/` (schema in `lib/db/src/schema/*.ts`). Startup
  migrations: `artifacts/api-server/src/lib/dbMigrate.ts` (CREATE TABLE IF NOT EXISTS + ALTER).
- **Zod types**: `lib/api-zod/` (generated — `src/generated/api.ts`; `UpdateSettingsBody`
  strips unknown keys, so new settings must be added there to be PUT-able).
- Key backend files: `lib/submitter.ts` (all platform submit logic), `lib/scheduler.ts`
  (phases 1 scrape → 2 cover letters → 3 submit w/ dailyLimit → 4 email sync),
  `lib/aiClient.ts` (answers: bank lookup → `inferFromResume` profile facts → gpt-4o-mini),
  `lib/greenhouse.ts` (+ `src/data/greenhouse_companies.json`), `lib/scrapers/{linkedin,indeed,lever,handshake}.ts`,
  `lib/emailImporter.ts`, `lib/browser.ts`, `routes/*.ts`, `routes/auth.ts` (headed-login flow).

## 2. Build / run / restart / push — and CRITICAL gotchas

- **Build = esbuild, which does NOT typecheck.** It catches syntax errors only. Validate logic
  by hand. Source files are bundled (incl. `lib/db` from source) into `dist/index.mjs`.
- **Restart:** double-click `kill-and-restart.bat` (kills node on :3000, waits for the port to
  free, rebuilds, starts). `start-all.bat` starts API **and** dashboard. `watchdog.bat` keeps
  the API alive (auto-restart after 3 failed health checks) — it is meant to be left running.
- **⚠️ The dev/agent sandbox MOUNT of this folder is frequently STALE/TRUNCATED.** Reading files
  or running `tsc`/`grep` against the mount often reports phantom "unterminated string / } expected"
  errors and truncated content. **Trust the host files** (the Windows build reads the host).
  **Verify a build by:** `dist/index.mjs` mtime is fresh (≈ now) AND `grep`-ing dist for a unique
  string from your change returns ≥1. If dist mtime didn't change, the build/restart failed.
- **Pushing git:** do it through a `.bat` run on Windows (the sandbox has no git creds and the
  mount is read-only for deletes). Pattern: a bat that does `git add <files>` → `git commit -m ...`
  → `git push origin main`, logging to a file you then read. Identity:
  `AryanGonsalves` / `aryan.gonsalves123@gmail.com`. Repo:
  `github.com/AryanGonsalves/Autonomous-Job-Application-System` (main). Scratch helper files are
  named `_*` and are gitignored.
- **Reaching the API for verification:** the bot's API is on the user's machine localhost:3000;
  use the Claude-in-Chrome MCP (deviceId `677b091c-d7b7-42ec-a7ad-4a912480fd05`) — the Linux
  sandbox cannot reach host localhost. Chrome sometimes sits on a "Who's using Chrome?" profile
  picker which blocks the extension (can't be clicked).
- **`esbuild` is pinned to `@esbuild/win32-x64`** in `artifacts/api-server/package.json` — it will
  NOT build on Linux/containers without adding `@esbuild/linux-x64` (matters only for cloud).

Key endpoints: `GET /api/scheduler/{status,logs,history}`, `POST /api/scheduler/run-now`,
`GET /api/stats/summary`, `GET /api/jobs?status=&platform=`, `POST /api/jobs/retry-failed`,
`GET /api/applications`, `GET/PUT /api/settings`, `GET /api/questions[...]`,
`POST /api/questions/:id/answer`, `POST /api/import/email`, `POST /api/auth/{linkedin,indeed}`.

## 3. Current state (verified working)

- Server resilient: global `unhandledRejection`/`uncaughtException` handlers in `index.ts` +
  `watchdog.bat`. Email: **Gmail + Yahoo both fetch** (≈141 / ≈700 inbox); confirmation tracking
  matches only emails dated ≥ appliedAt (no manual/bot conflation); ~56/341 apps confirmed.
- Answer logic: authoritative profile-facts in `inferFromResume` (work-auth=Yes, sponsorship=Yes,
  citizen/green-card=No, clearance=No, 18+=Yes, felony=No, EEO=“I prefer not to disclose”,
  GPA=3.8, generic professional-years=2, salary annual=85000 / monthly=7000 / hourly=45,
  current-salary=0). Numeric coercion + bank consistency/dedup endpoints exist.
- `jobs.notes` column now exists (was missing → attempt-cap + retry-failed were broken; fixed).
  `retry-failed` returns 200; attempt-cap (`[attempt:N]`, MAX 4) now persists.
- `locationPreference` is free-form (city / "City, ST" / state / nationwide); drives Indeed
  search and is safe on forms (broad values don't break the city autocomplete).
- Greenhouse scraper routes company-own-domain URLs (stripe.com, careers.roblox.com) to the
  canonical `job-boards.greenhouse.io/{slug}/jobs/{id}` form. +24 Greenhouse, +12 Lever slugs added.
- Indeed scraper no longer hangs 3 min when no session — it skips cleanly. Session at
  `artifacts/api-server/sessions/indeed_session.json` (present). LinkedIn/Handshake sessions present.

## 4. OPEN ISSUES (priority order)

### P1 — Complex Greenhouse forms don't get fully filled (biggest submission blocker)
- **Symptom:** Greenhouse applications are almost all Pinterest/Peloton. Real boards on
  `job-boards.greenhouse.io` (Affirm, Anthropic, etc.) skip with "form still present after submit"
  / validation, despite having a working "Submit application" button. Affirm's form has ~32 fields
  incl. resume upload + many required custom + EEO/demographic `<select>` dropdowns.
- **Root cause (hypothesis):** `submitGreenhouse` in `lib/submitter.ts` fills custom questions via
  a loop keyed on `[data-field-type], .field-container, .custom-field` (+ standard name/email/
  resume). The **newer React board uses different field-container markup**, so required custom
  fields + required `<select>`/demographic dropdowns are left blank → submit blocked.
- **Fix direction (ADDITIVE — do not remove existing selectors; Pinterest/Peloton already work):**
  1) Open a live `job-boards.greenhouse.io` form (e.g. Affirm/Anthropic) and inspect the real
     wrapper classes around inputs/selects and the "required" markers.
  2) Broaden the custom-question container selectors to match those.
  3) Handle required `<select>` dropdowns: pick a valid option; for EEO/demographic ones choose
     the "decline / prefer not to say" option; for yes/no use `generateYesNoAnswer`. Coerce numeric.
  4) Re-check the submit only after all required fields are filled; capture the validation-error
     text into `jobs.notes` so failures are diagnosable.
- **Verify:** trigger a run, confirm a non-Pinterest Greenhouse company submits, and that Pinterest
  STILL submits (no regression).

### P2 — Submission volume is low overall
- **LinkedIn is disabled** (`enableLinkedin=false`) — it was the highest-volume source. With it off
  and API boards low-yield, throughput collapses. Re-enabling raises volume but LinkedIn Easy Apply
  is ~15% success (Workable/Ceipal ATS overlays fail at step 0 — an inherent limitation, jobs are
  skipped quickly). Decision needed: re-enable LinkedIn for volume, or rely on API boards (then P1
  must be solved for Greenhouse to matter).
- **Queue can drain to 0** → 0 submits. Sustainable supply needs P1 (Greenhouse), more valid
  Lever/Greenhouse slugs (P3), and/or LinkedIn.

### P3 — Custom-ATS & exhausted source lists (data hygiene)
- Several `greenhouse_companies.json` entries are companies that host their own ATS and have NO
  public Greenhouse form (Stripe, Roblox, …). With the URL fix these now resolve to a canonical
  form that 404s → skip-with-note. **Prune the confirmed-dead ones** (or auto-detect a 404 on the
  hosted form and drop the company), so the queue isn't clogged with unsubmittable jobs.
- **Lever list is exhausted** — returns 0 new jobs. Needs *validated* `jobs.lever.co/{slug}` slugs
  that actually have data/analytics roles (the recently-added ones are mostly invalid/already-applied).
  Consider also adding **Ashby** (`jobs.ashbyhq.com`) as a new no-login source.

### P4 — Operational / product polish
- **Dashboard (:5173) isn't always running** — `kill-and-restart.bat` only restarts the API.
  Use `start-all.bat` (starts both) or add the dashboard to the watchdog.
- **EEO-decline path is untested live** (no EEO question has appeared yet) — verify when one does.
- **Email confirmations** never change status (only AI-classified rejected/interview/offer do);
  "updated 0 statuses" is normal.
- **Cloud deployment** not done. `CLOUD_DEPLOYMENT_PLAN.md` exists; the user leaned toward a
  **locally-distributed app** (each user runs it with their own keys/sessions stored locally)
  over a multi-tenant cloud SaaS, mainly due to credential-liability + LinkedIn/Indeed ToS risk.

### P5 — Known/expected (NOT bugs — don't "fix" these)
- LinkedIn Easy Apply on Workable/Ceipal overlays failing at step 0 (expected; skipped fast).
- Stale/closed postings → "job page not found" (expected; marked failed/skipped).
- Indeed needs a periodic manual login (`POST /api/auth/indeed`, headed browser) to refresh the
  session; cannot be automated.

## 5. Verification recipe (use after every change)
1. Build via `kill-and-restart.bat`; confirm `dist/index.mjs` mtime is fresh AND `grep` dist for a
   unique string from your change ≥1. If not fresh → build failed; read the server console.
2. Via Chrome MCP from the :3000 origin: `GET /api/scheduler/status` (200, running),
   `/api/stats/summary`, `/api/settings`, `/api/questions/stats`.
3. Regression guards: `POST /api/jobs/retry-failed` must return 200; queued jobs must have a
   `notes` field; `POST /api/import/email` must show Gmail AND Yahoo fetching (no "Connection not
   available"). Then `POST /api/scheduler/run-now` and confirm at least one real submission and
   that Pinterest/Peloton Greenhouse still submit.
4. Never print raw URLs/query-strings/emails/phones in tool output — they trip a content filter;
   scrub them.

## 6. Latest run diagnostics (2026-06-16) — target these for P1

Fable's React-board loop IS running ("new React board detected (N field wrappers)" fires for SoFi,
Instacart, ClickHouse, The Trade Desk, Airbnb, Databricks) but **0 new-board Greenhouse submissions
succeed**. All Greenhouse applied jobs are still Pinterest(36)/Peloton(3)/Datadog(1). Verbatim
failure notes captured (now persisted in jobs.notes):
- **Instacart**: "form still present … : This field is required." → a required field is left unfilled
  (label not captured — likely a react-select with no option chosen, or a required text field the
  loop didn't detect as required).
- **The Trade Desk**: "This field is required.; **Please accept the terms to proceed.**" → (1) a
  required field unfilled AND (2) the **terms/consent checkbox is not being checked** — the consent
  fix isn't catching this instance (different checkbox markup, or the `#current-role-*` exclusion is
  over-excluding).
- **ClickHouse / Databricks**: security-code flow works end-to-end (code fetched from Yahoo, entered,
  resubmitted) BUT form still present afterward — because the **underlying required-field errors were
  never resolved**, so the resubmit just re-surfaces them. (Also: ClickHouse note showed the code
  input `valLen=1` at capture — verify the full 8-char code is actually typed, not truncated.)
- **SoFi**: "submit button not found" even though the React board was detected → SoFi has a submit-
  button variant the selector list misses after the field-wrapper loop.
- **Airbnb / Sisense / Fivetran / Anthropic / SingleStore**: "form still present" / "submit button
  not found" (no field detail captured).
- **Stripe / Roblox**: "no application form found — custom career page" (no Greenhouse form; prune).
- **Brex**: `page.goto Timeout 45000ms` on `networkidle` (page never idles) — consider waitUntil:"load".

**Fix priority for P1:** make the React-board loop reliably fill EVERY required field before submit —
especially (1) required `react-select` dropdowns (open → choose; EEO/demographic → decline option),
(2) required consent/terms checkboxes (broaden selector; don't over-exclude), (3) capture the failing
field LABEL into notes (currently only the generic "This field is required." text is saved). Verify a
non-Pinterest board (e.g. Instacart, The Trade Desk) actually submits, and that Pinterest still does.

### Answer-input fix applied 2026-06-16 (already done)
`aiClient.inferFromResume` work-authorization matching was substring-based and missed phrasings like
"authorized to **lawfully** work" and "require assistance with work authorization" → the AI wrongly
answered **"No"** to work-authorization questions. Replaced with regex matching (asksWork) + ordered
logic: WITHOUT-sponsorship → "No (future sponsorship)"; sponsorship/visa/"assistance with work
authorization" → "Yes"; general authorized/eligible/legally-allowed to work → "Yes". Bad bank entries
corrected via the API. Cross-check any remaining `ai`-sourced legal/eligibility answers against the
resume-sourced ones for consistency.
