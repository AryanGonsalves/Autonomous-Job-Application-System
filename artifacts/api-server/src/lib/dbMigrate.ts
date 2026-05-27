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
];

export async function runMigrations(): Promise<void> {
  try {
    for (const statement of MIGRATIONS) {
      await db.run(sql.raw(statement));
    }
    logger.info("DB migrations applied");
  } catch (err) {
    logger.error({ err }, "DB migration error");
  }
}
