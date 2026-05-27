import app from "./app";
import { logger } from "./lib/logger";
import { runMigrations } from "./lib/dbMigrate";
import { startScheduler } from "./lib/scheduler";

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
