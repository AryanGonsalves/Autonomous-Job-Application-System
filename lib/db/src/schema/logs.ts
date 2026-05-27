import { sqliteTable, integer, text } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

const logLevelValues = ["info", "warn", "error", "debug"] as const;

export const automationLogsTable = sqliteTable("automation_logs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  timestamp: integer("timestamp", { mode: "timestamp_ms" }).notNull().defaultNow(),
  level: text("level", { enum: logLevelValues }).notNull().default("info"),
  message: text("message").notNull(),
  platform: text("platform"),
});

export const insertLogSchema = createInsertSchema(automationLogsTable).omit({ id: true, timestamp: true });
export type InsertLog = z.infer<typeof insertLogSchema>;
export type AutomationLog = typeof automationLogsTable.$inferSelect;
