import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/schema/index.ts",
  dialect: "turso",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "file:./jobapplybot.db",
  },
});
