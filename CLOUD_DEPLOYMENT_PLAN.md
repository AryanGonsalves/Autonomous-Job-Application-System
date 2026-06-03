# Cloud-Deployable Version — Plan

Goal: run the Job Apply Bot without the user's PC being on, with secure secrets, a hosted
database, and (eventually) multiple users. The current app is a local Windows setup
(bat files, localhost, headed-browser logins, SQLite). Below is the path to a hosted product.

## 0. What blocks "lift-and-shift" today
- **Headed-browser logins.** LinkedIn/Indeed/Handshake sessions are created by opening a
  *visible* Chrome window for the user to complete MFA/CAPTCHA. A server has no display and
  no user present. → Sessions must be captured client-side and uploaded, or via a remote
  interactive browser (see §4).
- **SQLite + local file sessions.** `lib/db` (libsql/SQLite file) and `sessions/*.json` are
  on local disk. → Move to hosted Postgres + object storage / encrypted secrets.
- **Single hard-coded profile.** Answer logic (`aiClient.inferFromResume`) encodes one user's
  facts. → Per-user profile object loaded from DB.
- **Secrets in the DB settings table in plaintext** (LinkedIn/Indeed/IMAP passwords, OpenAI
  key). → Move to a secrets manager / encrypted columns.
- **No authentication** on the API/dashboard. → Add auth before exposing publicly.

## 1. Architecture (target)
- **API service** (Express) — containerized (Docker), stateless, horizontally scalable.
- **Worker service** — runs the scraper/submitter pipeline (Playwright). Separate from the
  API so long browser jobs don't block HTTP. Triggered by a queue/cron.
- **Headless browser farm** — Playwright with `chromium` headless in the worker image
  (install `npx playwright install --with-deps chromium` in the Dockerfile). Use stealth +
  residential/proxy egress to reduce blocking.
- **Postgres** (managed: Neon/RDS/Supabase) — swap libsql client for Postgres in `lib/db`
  (Drizzle already supports pg; mostly a driver + migration change).
- **Object storage / secrets** — resumes + session cookie blobs in S3 (encrypted);
  credentials + API keys in a secrets manager (AWS Secrets Manager / Doppler / Vault).
- **Queue + scheduler** — replace the in-process `setTimeout` scheduler with a real queue
  (BullMQ/Redis or a cloud cron + SQS) so runs survive restarts and scale.
- **Dashboard** — build the Vite app to static assets, serve via CDN (Vercel/Netlify/S3+CloudFront).

## 2. Hosting options (pick one)
- **Fastest:** Render / Railway / Fly.io — Docker deploy, managed Postgres + Redis add-ons,
  background workers, cron. Good for a single-tenant or small product.
- **Most control / scale:** AWS (ECS Fargate for API+worker, RDS Postgres, ElastiCache Redis,
  S3, Secrets Manager, EventBridge cron).
- Browsers are heavy (RAM/CPU); size worker instances accordingly, cap concurrency.

## 3. Concrete migration steps
1. **Dockerize**: Dockerfile for api-server (node:20-slim + `playwright install --with-deps
   chromium`); separate `worker` entrypoint that runs the scheduler/pipeline.
2. **DB → Postgres**: switch Drizzle driver to `pg`; generate + run migrations; move the
   `questions_bank` CREATE-IF-NOT-EXISTS into a proper migration.
3. **Secrets**: read credentials/keys from env/secret store, not the settings table; keep
   non-secret prefs in DB.
4. **Sessions → storage**: persist `sessions/*.json` (Playwright storageState) to S3
   (encrypted); load at job start, save after a successful login.
5. **Profile → per-user**: extract the hard-coded facts in `inferFromResume` into a
   `userProfile` record (work auth, sponsorship stance, citizenship, GPA, salary, EEO
   defaults, years-by-skill); answer logic reads it.
6. **Auth**: add login (Clerk/Auth0 or simple session) to the API + dashboard.
7. **Queue/cron**: move scheduler slots to a managed cron that enqueues run jobs; worker
   consumes them with concurrency limits + per-job timeouts (already have a 4-min guard).
8. **Observability**: ship logs (pino → hosted log drain), add health/readiness endpoints,
   alerts on run failures.

## 4. The hard problem: platform logins at scale
- LinkedIn/Indeed actively fight automation; server-side logins trigger MFA/CAPTCHA and bans.
- Options: (a) **client-side capture** — a browser extension or local helper logs the user in
  and uploads the `storageState`; (b) **remote interactive browser** (e.g., Browserless /
  hosted Chrome) the user drives once via a link to complete MFA; (c) prefer **API/no-login
  platforms** (Greenhouse, Lever, Ashby) which need no session and scale cleanly.
- Recommendation: lean on API-based boards for the hosted product; treat LinkedIn/Indeed as
  opt-in with user-supplied sessions.

## 5. Compliance / ToS note
- LinkedIn & Indeed ToS prohibit automated access; scaling this as a public product carries
  account-ban and legal risk. Greenhouse/Lever/Ashby public application flows are lower-risk.
  Decide the product's platform scope with this in mind.

## 6. Suggested order of work
1) Dockerize + Postgres + Render/Fly deploy (single-tenant, API-board platforms only).
2) Secrets manager + S3 sessions + auth.
3) Per-user profile + multi-tenant.
4) Queue/scheduler hardening + observability.
5) LinkedIn/Indeed via client-side session capture (optional).
