# Autonomous Job Application System

An end-to-end job application bot that scrapes live postings, generates tailored cover letters with GPT-4o-mini, and submits applications automatically via browser automation — all managed from a real-time React dashboard.

**Built by [Aryan Gonsalves](https://linkedin.com/in/aryan-gonsalves)**

---

## Features

- **Multi-platform scraping** — LinkedIn, Greenhouse, Lever, and Handshake (ASU)
- **US geofencing** — automatically filters non-US postings
- **AI cover letters** — GPT-4o-mini generates a tailored cover letter per job
- **ATS question answering** — 3-tier resolution: saved answer bank → resume inference → LLM fallback
- **Browser automation** — Playwright handles LinkedIn Easy Apply multi-step forms including shadow-DOM fields
- **4-phase pipeline** — scrape → generate → apply → email sync (runs on a schedule or manually)
- **Question bank** — low-confidence ATS answers are flagged for your review
- **Run history** — every pipeline run is logged with stats (scraped, applied, failed)
- **React dashboard** — real-time monitoring, job queue management, settings UI

---

## Prerequisites

- [Node.js 20+](https://nodejs.org/) — download and install
- [pnpm](https://pnpm.io/installation) — run `npm install -g pnpm` after installing Node

---

## Setup (Windows)

### Option A — Automated (recommended)

1. Double-click **`setup.bat`** in the project folder
2. Wait for it to finish (installs dependencies, creates the database)
3. Double-click **`start.bat`** to launch both servers
4. Open **http://localhost:5173** in your browser
5. Go to **Settings** and fill in your credentials

### Option B — Manual

```bash
# 1. Install dependencies
pnpm install

# 2. Copy the environment file
copy .env.example .env

# 3. Start both servers (opens two terminal windows)
start.bat
```

---

## Setup (Mac / Linux)

```bash
# 1. Install dependencies
pnpm install

# 2. Copy the environment file
cp .env.example .env

# 3. Start both servers
chmod +x start.sh
./start.sh
```

Then open **http://localhost:5173** in your browser.

---

## Configuration

Go to **http://localhost:5173/settings** after starting and fill in:

| Setting | Description |
|---|---|
| LinkedIn Email / Password | Your LinkedIn login credentials |
| Handshake Email / Password | Your ASU Handshake login |
| OpenAI API Key | From [platform.openai.com](https://platform.openai.com/api-keys) |
| Keywords | Comma-separated job titles to search (e.g. `Data Scientist, Data Analyst`) |
| Daily Limit | Max applications per day (default: 100) |
| Scheduler Slots | Times to auto-run the pipeline (e.g. `08:00`, `14:00`) |

Upload your resume (PDF or DOCX) via the **Resume** tab — it's used for ATS question answering and cover letter context.

---

## Usage

### Dashboard — http://localhost:5173

- **Home** — live stats: jobs scraped, applied, failed today
- **Queue** — browse pending jobs, remove ones you don't want
- **Applications** — track status of submitted applications (applied / interview / offer / rejected)
- **Scheduler** — start/stop the automation pipeline, trigger a manual run
- **Question Bank** — review and correct low-confidence ATS answers
- **Settings** — credentials, keywords, limits

### Running the pipeline manually

Click **"Run Now"** on the Scheduler page, or via curl:

```bash
curl -X POST http://localhost:3000/api/scheduler/run-now
```

### Pipeline phases

1. **Scrape** — fetches new job postings from enabled platforms
2. **Generate** — creates AI cover letters for queued jobs
3. **Apply** — submits applications via browser automation
4. **Email sync** — checks inbox for interview/rejection updates

---

## Project Structure

```
├── artifacts/
│   ├── api-server/          # Express + TypeScript backend (port 3000)
│   │   └── src/
│   │       ├── lib/         # Core logic: scrapers, submitter, AI, scheduler
│   │       └── routes/      # REST API endpoints
│   └── job-dashboard/       # React + Vite frontend (port 5173)
│       └── src/
│           └── pages/       # Dashboard pages
├── lib/
│   ├── db/                  # Drizzle ORM schema + SQLite client
│   └── api-zod/             # Shared Zod validation types
└── .env.example             # Environment variable template
```

---

## Known Limitations

- **LinkedIn session expiry** — if LinkedIn stops working, delete `sessions/linkedin_session.json` and restart; the bot will re-authenticate
- **Embedded ATS forms** (Workable, Ceipal inside LinkedIn Easy Apply) — these use React-managed shadow DOM and are skipped automatically; they can't be filled reliably
- **Indeed** — scraping works but auto-submission is disabled; Indeed's Quick Apply requires additional implementation
- **Handshake** — works but requires valid ASU credentials and active session

---

## Tech Stack

TypeScript · Node.js · Express · React · Vite · Drizzle ORM · SQLite · Playwright · OpenAI GPT-4o-mini · shadcn/ui · Tailwind CSS · pnpm workspaces
