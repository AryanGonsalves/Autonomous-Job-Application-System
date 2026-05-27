import { sqliteTable, integer, text } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const resumeTable = sqliteTable("resume", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  rawText: text("raw_text").notNull(),
  parsedJson: text("parsed_json", { mode: "json" }).notNull(),
  uploadedAt: integer("uploaded_at", { mode: "timestamp_ms" }).notNull().defaultNow(),
});

export const insertResumeSchema = createInsertSchema(resumeTable).omit({ id: true, uploadedAt: true });
export type InsertResume = z.infer<typeof insertResumeSchema>;
export type Resume = typeof resumeTable.$inferSelect;
