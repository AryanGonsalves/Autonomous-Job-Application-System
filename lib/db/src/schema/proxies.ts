import { sqliteTable, integer, text } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const proxiesTable = sqliteTable("proxies", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  label: text("label"),
  host: text("host").notNull(),
  port: text("port").notNull(),
  username: text("username"),
  password: text("password"),
  protocol: text("protocol").notNull().default("http"),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  lastTestedAt: integer("last_tested_at", { mode: "timestamp" }),
  lastTestStatus: text("last_test_status"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().defaultNow(),
});

export const insertProxySchema = createInsertSchema(proxiesTable).omit({ id: true, createdAt: true });
export type InsertProxy = z.infer<typeof insertProxySchema>;
export type Proxy = typeof proxiesTable.$inferSelect;
