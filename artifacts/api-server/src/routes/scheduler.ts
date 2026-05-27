import { Router, type IRouter } from "express";
import {
  getSchedulerState,
  startScheduler,
  stopScheduler,
  runPipeline,
  getRunHistory,
  updateSchedulerSlots,
  requestStopCurrentRun,
} from "../lib/scheduler";
import { getRecentLogs } from "../lib/automationLog";
import { GetSchedulerLogsQueryParams } from "@workspace/api-zod";
import { db, applicationsTable, runHistoryTable } from "@workspace/db";
import { gte, count, isNull } from "drizzle-orm";

const router: IRouter = Router();

router.get("/scheduler/status", async (_req, res): Promise<void> => {
  const state = getSchedulerState();
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const [todayCount] = await db
    .select({ count: count() })
    .from(applicationsTable)
    .where(gte(applicationsTable.appliedAt, todayStart));
  res.json({ ...state, applicationsToday: todayCount?.count ?? 0 });
});

router.post("/scheduler/start", async (_req, res): Promise<void> => {
  await startScheduler();
  const state = getSchedulerState();
  res.json({ ...state, applicationsToday: 0 });
});

router.post("/scheduler/stop", async (_req, res): Promise<void> => {
  await stopScheduler();
  const state = getSchedulerState();
  res.json({ ...state, applicationsToday: 0 });
});

router.post("/scheduler/run-now", async (_req, res): Promise<void> => {
  runPipeline("manual").catch(() => {});
  res.json({ success: true, message: "Automation pipeline triggered. Check the log viewer for progress.", jobId: null });
});

router.get("/scheduler/history", async (req, res): Promise<void> => {
  const limitRaw = req.query["limit"];
  const limit = typeof limitRaw === "string" ? Math.min(parseInt(limitRaw, 10) || 30, 100) : 30;
  const history = await getRunHistory(limit);
  res.json(
    history.map((h) => ({
      id: h.id,
      startedAt: h.startedAt.toISOString(),
      finishedAt: h.finishedAt?.toISOString() ?? null,
      jobsScraped: h.jobsScraped,
      jobsApplied: h.jobsApplied,
      jobsFailed: h.jobsFailed,
      jobsFilteredNonUs: h.jobsFilteredNonUs,
      triggeredBy: h.triggeredBy,
      durationMs: h.durationMs ?? null,
    }))
  );
});

router.put("/scheduler/slots", async (req, res): Promise<void> => {
  const { slots } = req.body as { slots: string[] };
  if (!Array.isArray(slots)) {
    res.status(400).json({ error: "slots must be an array" });
    return;
  }
  await updateSchedulerSlots(slots);
  res.json({ ok: true });
});

router.post("/scheduler/stop-run", async (_req, res): Promise<void> => {
  await requestStopCurrentRun();
  res.json({ ok: true });
});

// Clean up stale "Running" records (finishedAt IS NULL) from crashed/interrupted runs
router.post("/scheduler/cleanup-stale-runs", async (_req, res): Promise<void> => {
  const now = new Date();
  const result = await db
    .update(runHistoryTable)
    .set({ finishedAt: now, durationMs: 0 })
    .where(isNull(runHistoryTable.finishedAt));
  res.json({ ok: true, message: "Stale running records marked as finished", cleaned: result.rowsAffected ?? 0 });
});

router.get("/scheduler/logs", async (req, res): Promise<void> => {
  const query = GetSchedulerLogsQueryParams.safeParse(req.query);
  const limit = query.success ? (query.data.limit ?? 100) : 100;

  const logs = await getRecentLogs(limit);
  res.json({
    logs: logs.map((l) => ({
      timestamp: l.timestamp.toISOString(),
      level: l.level,
      message: l.message,
      platform: l.platform ?? null,
    })),
  });
});

export default router;
