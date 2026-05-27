import { db, automationLogsTable } from "@workspace/db";
import { desc } from "drizzle-orm";
import { logger } from "./logger";

export type LogLevel = "info" | "warn" | "error" | "debug";

export async function addLog(level: LogLevel, message: string, platform?: string): Promise<void> {
  try {
    await db.insert(automationLogsTable).values({ level, message, platform: platform ?? null });
  } catch (err) {
    logger.error({ err }, "Failed to write automation log");
  }
}

export async function getRecentLogs(limit = 100) {
  return db
    .select()
    .from(automationLogsTable)
    .orderBy(desc(automationLogsTable.timestamp))
    .limit(limit);
}
