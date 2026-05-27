import { sqliteTable, integer, text } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

const runTriggerValues = ["scheduled", "manual"] as const;

export const runHistoryTable = sqliteTable("run_history", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  startedAt: integer("started_at", { mode: "timestamp_ms" }).notNull().defaultNow(),
  finishedAt: integer("finished_at", { mode: "timestamp_ms" }),
  jobsScraped: integer("jobs_scraped").notNull().default(0),
  jobsApplied: integer("jobs_applied").notNull().default(0),
  jobsFailed: integer("jobs_failed").notNull().default(0),
  jobsFilteredNonUs: integer("jobs_filtered_non_us").notNull().default(0),
  triggeredBy: text("triggered_by", { enum: runTriggerValues }).notNull().default("manual"),
  durationMs: integer("duration_ms"),
});

export const insertRunHistorySchema = createInsertSchema(runHistoryTable).omit({ id: true, startedAt: true });
export type InsertRunHistory = z.infer<typeof insertRunHistorySchema>;
export type RunHistory = typeof runHistoryTable.$inferSelect;
