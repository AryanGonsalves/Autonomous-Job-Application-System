import { sqliteTable, integer, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

const platformValues = ["linkedin", "indeed", "greenhouse", "lever", "handshake", "manual"] as const;
const jobStatusValues = ["queued", "applied", "failed", "skipped", "filtered_non_us"] as const;

export const jobsTable = sqliteTable("jobs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  platform: text("platform", { enum: platformValues }).notNull(),
  jobTitle: text("job_title").notNull(),
  company: text("company").notNull(),
  location: text("location"),
  remote: integer("remote", { mode: "boolean" }).notNull().default(false),
  jobDescription: text("job_description"),
  applyUrl: text("apply_url").notNull(),
  scrapedAt: integer("scraped_at", { mode: "timestamp_ms" }).notNull().defaultNow(),
  status: text("status", { enum: jobStatusValues }).notNull().default("queued"),
  coverLetterText: text("cover_letter_text"),
  countryResolved: text("country_resolved"),
  // Last failure/skip reason + retry attempt marker ("[attempt:N] <error>"). Previously
  // referenced by scheduler/retry-failed but the column never existed, so notes were
  // silently dropped (every job showed "(no note)") and the attempt-cap never persisted.
  notes: text("notes"),
}, (t) => [
  uniqueIndex("jobs_apply_url_unique").on(t.applyUrl),
]);

export const insertJobSchema = createInsertSchema(jobsTable).omit({ id: true, scrapedAt: true });
export type InsertJob = z.infer<typeof insertJobSchema>;
export type Job = typeof jobsTable.$inferSelect;
