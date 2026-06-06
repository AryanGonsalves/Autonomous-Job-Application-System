import app from "./app";
import { logger } from "./lib/logger";
import { runMigrations } from "./lib/dbMigrate";
import { startScheduler } from "./lib/scheduler";

// Keep the long-running automation server alive. Playwright (browser/page/context
// teardown, CDP drops) and IMAP generate many async operations; a SINGLE unhandled
// promise rejection or exception would otherwise crash the whole Node process — the
// recurring "[ELIFECYCLE] Command failed with exit code 1" that kept taking the API
// down. Log and continue instead of dying. (The per-job try/catch in the scheduler
// still handles expected failures; this is the safety net for stray async errors.)
process.on("unhandledRejection", (reason) => {
  logger.error({ err: reason }, "Unhandled promise rejection — server kept alive");
});
process.on("uncaughtException", (err) => {
  logger.error({ err }, "Uncaught exception — server kept alive");
});

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

// Run DB migrations before starting, then start scheduler
runMigrations()
  .then(() => startScheduler())
  .catch((err) => logger.error({ err }, "Startup error"));

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
});
