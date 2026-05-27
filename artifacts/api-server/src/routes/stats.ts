import { Router, type IRouter } from "express";
import { db, applicationsTable, jobsTable } from "@workspace/db";
import { eq, gte, count, desc, and } from "drizzle-orm";
import { sql } from "drizzle-orm";

const router: IRouter = Router();

router.get("/stats/summary", async (_req, res): Promise<void> => {
  const now = new Date();
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);

  const weekStart = new Date(now);
  weekStart.setDate(weekStart.getDate() - 7);
  weekStart.setHours(0, 0, 0, 0);

  const [
    [totalRow],
    [todayRow],
    [weekRow],
    [queuedRow],
    [failedRow],
    statusRows,
  ] = await Promise.all([
    db.select({ count: count() }).from(applicationsTable),
    db.select({ count: count() }).from(applicationsTable).where(gte(applicationsTable.appliedAt, todayStart)),
    db.select({ count: count() }).from(applicationsTable).where(gte(applicationsTable.appliedAt, weekStart)),
    db.select({ count: count() }).from(jobsTable).where(eq(jobsTable.status, "queued")),
    db.select({ count: count() }).from(jobsTable).where(eq(jobsTable.status, "failed")),
    db.select({ status: applicationsTable.status, count: count() }).from(applicationsTable).groupBy(applicationsTable.status),
  ]);

  const [filteredNonUsRow] = await db
    .select({ count: count() })
    .from(jobsTable)
    .where(eq(jobsTable.status, "filtered_non_us"));

  const total = totalRow?.count ?? 0;
  const interviewRow = statusRows.find((r) => r.status === "interview");
  const offerRow = statusRows.find((r) => r.status === "offer");
  const interviews = interviewRow?.count ?? 0;
  const offers = offerRow?.count ?? 0;

  res.json({
    totalAllTime: total,
    totalToday: todayRow?.count ?? 0,
    totalThisWeek: weekRow?.count ?? 0,
    totalQueued: queuedRow?.count ?? 0,
    totalFailed: failedRow?.count ?? 0,
    totalInterviews: interviews,
    totalOffers: offers,
    totalFilteredNonUs: filteredNonUsRow?.count ?? 0,
    successRate: total > 0 ? Math.round(((interviews + offers) / total) * 100) / 100 : 0,
  });
});

router.get("/stats/daily", async (_req, res): Promise<void> => {
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const rows = await db
    .select({
      date: sql<string>`DATE(${applicationsTable.appliedAt})`.as("date"),
      count: count(),
    })
    .from(applicationsTable)
    .where(gte(applicationsTable.appliedAt, thirtyDaysAgo))
    .groupBy(sql`DATE(${applicationsTable.appliedAt})`)
    .orderBy(sql`DATE(${applicationsTable.appliedAt})`);

  // Fill in missing dates with 0
  const dateMap: Record<string, number> = {};
  for (const row of rows) {
    dateMap[row.date] = row.count;
  }

  const result: { date: string; count: number }[] = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().split("T")[0]!;
    result.push({ date: dateStr, count: dateMap[dateStr] ?? 0 });
  }

  res.json(result);
});

router.get("/stats/platform-breakdown", async (_req, res): Promise<void> => {
  const rows = await db
    .select({
      platform: jobsTable.platform,
      count: count(),
    })
    .from(applicationsTable)
    .innerJoin(jobsTable, eq(applicationsTable.jobId, jobsTable.id))
    .groupBy(jobsTable.platform);

  res.json(rows.map((r) => ({ platform: r.platform, count: r.count })));
});

router.get("/stats/status-breakdown", async (_req, res): Promise<void> => {
  const rows = await db
    .select({ status: applicationsTable.status, count: count() })
    .from(applicationsTable)
    .groupBy(applicationsTable.status);

  res.json(rows.map((r) => ({ status: r.status, count: r.count })));
});

router.get("/stats/recent-activity", async (req, res): Promise<void> => {
  const limitRaw = req.query["limit"];
  const limit = typeof limitRaw === "string" ? Math.min(parseInt(limitRaw, 10) || 10, 50) : 10;

  const rows = await db
    .select({ application: applicationsTable, job: jobsTable })
    .from(applicationsTable)
    .innerJoin(jobsTable, eq(applicationsTable.jobId, jobsTable.id))
    .orderBy(desc(applicationsTable.appliedAt))
    .limit(limit);

  res.json(
    rows.map((r) => ({
      id: r.application.id,
      type: "applied",
      jobTitle: r.job.jobTitle,
      company: r.job.company,
      platform: r.job.platform,
      timestamp: r.application.appliedAt.toISOString(),
      details: r.application.status !== "applied" ? `Status: ${r.application.status}` : null,
    }))
  );
});

export default router;
