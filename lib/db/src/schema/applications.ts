import { sqliteTable, integer, text } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { jobsTable } from "./jobs";

const applicationStatusValues = ["applied", "interview", "offer", "rejected"] as const;
const applicationSourceValues = ["automated", "imported"] as const;

export const applicationsTable = sqliteTable("applications", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  jobId: integer("job_id").notNull().references(() => jobsTable.id),
  appliedAt: integer("applied_at", { mode: "timestamp_ms" }).notNull().defaultNow(),
  coverLetterText: text("cover_letter_text"),
  resumePath: text("resume_path"),
  status: text("status", { enum: applicationStatusValues }).notNull().default("applied"),
  source: text("source", { enum: applicationSourceValues }).notNull().default("automated"),
  notes: text("notes"),
});

export const insertApplicationSchema = createInsertSchema(applicationsTable).omit({ id: true, appliedAt: true });
export type InsertApplication = z.infer<typeof insertApplicationSchema>;
export type Application = typeof applicationsTable.$inferSelect;
