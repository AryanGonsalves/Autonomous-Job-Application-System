/**
 * dbMigrate.ts — lightweight startup migrations.
 *
 * Drizzle's `push` command handles the main schema, but new tables added between
 * runs need to exist before the server can use them. This file runs CREATE TABLE
 * IF NOT EXISTS statements for any tables not managed by an existing push.
 *
 * Safe to run on every startup — all statements use IF NOT EXISTS.
 */
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger";

const MIGRATIONS: string[] = [
  // questions_bank — added for ATS question bank feature
  `CREATE TABLE IF NOT EXISTS questions_bank (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    question    TEXT    NOT NULL,
    question_norm TEXT  NOT NULL,
    answer      TEXT,
    source      TEXT    NOT NULL DEFAULT 'ai',
    confidence  REAL    NOT NULL DEFAULT 0,
    needs_review INTEGER NOT NULL DEFAULT 1,
    user_note   TEXT,
    job_id      INTEGER REFERENCES jobs(id),
    company     TEXT,
    job_title   TEXT,
    platform    TEXT,
    created_at  INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000),
    updated_at  INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000)
  )`,
  // Index for fast question lookups
  `CREATE INDEX IF NOT EXISTS idx_questions_norm ON questions_bank(question_norm)`,
  `CREATE INDEX IF NOT EXISTS idx_questions_review ON questions_bank(needs_review)`,
  // jobs.notes — stores the last failure/skip reason + "[attempt:N]" retry marker.
  // The column was referenced by the scheduler/retry-failed but never created, so notes
  // were silently dropped. SQLite has no "ADD COLUMN IF NOT EXISTS", so this errors
  // harmlessly ("duplicate column") once the column exists — runMigrations swallows that
  // per-statement so the rest still run.
  `ALTER TABLE jobs ADD COLUMN notes TEXT`,
];

export async function runMigrations(): Promise<void> {
  // Run each statement independently so one expected failure (e.g. an ALTER on an
  // already-existing column) doesn't block the others.
  for (const statement of MIGRATIONS) {
    try {
      await db.run(sql.raw(statement));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // "duplicate column name" is expected on every boot after the first — ignore it.
      if (!/duplicate column/i.test(msg)) {
        logger.warn({ err, statement: statement.slice(0, 60) }, "DB migration statement skipped");
      }
    }
  }
  logger.info("DB migrations applied");
}
