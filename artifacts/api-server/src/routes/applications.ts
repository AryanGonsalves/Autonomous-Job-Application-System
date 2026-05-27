import { Router, type IRouter } from "express";
import { db, applicationsTable, jobsTable } from "@workspace/db";
import { eq, and, desc, count, like, gte, lte, SQL } from "drizzle-orm";
import {
  ListApplicationsQueryParams,
  GetApplicationParams,
  UpdateApplicationStatusParams,
  UpdateApplicationStatusBody,
} from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/applications", async (req, res): Promise<void> => {
  const query = ListApplicationsQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }

  const { status, platform, keyword, dateFrom, dateTo, limit = 50, offset = 0 } = query.data;

  const appConditions: SQL[] = [];
  const jobConditions: SQL[] = [];

  if (status) appConditions.push(eq(applicationsTable.status, status));
  if (platform) jobConditions.push(eq(jobsTable.platform, platform));
  if (keyword) jobConditions.push(like(jobsTable.jobTitle, `%${keyword}%`));
  if (dateFrom) appConditions.push(gte(applicationsTable.appliedAt, new Date(dateFrom)));
  if (dateTo) appConditions.push(lte(applicationsTable.appliedAt, new Date(dateTo)));

  const allConditions = [...appConditions, ...jobConditions];
  const whereClause = allConditions.length > 0 ? and(...allConditions) : undefined;

  const baseQuery = db
    .select({
      application: applicationsTable,
      job: jobsTable,
    })
    .from(applicationsTable)
    .innerJoin(jobsTable, eq(applicationsTable.jobId, jobsTable.id))
    .where(whereClause);

  const [rows, [totalRow]] = await Promise.all([
    baseQuery.orderBy(desc(applicationsTable.appliedAt)).limit(limit).offset(offset),
    db
      .select({ count: count() })
      .from(applicationsTable)
      .innerJoin(jobsTable, eq(applicationsTable.jobId, jobsTable.id))
      .where(whereClause),
  ]);

  res.json({
    applications: rows.map((r) => serializeApplication(r.application, r.job)),
    total: totalRow?.count ?? 0,
  });
});

router.get("/applications/:id", async (req, res): Promise<void> => {
  const params = GetApplicationParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [row] = await db
    .select({ application: applicationsTable, job: jobsTable })
    .from(applicationsTable)
    .innerJoin(jobsTable, eq(applicationsTable.jobId, jobsTable.id))
    .where(eq(applicationsTable.id, params.data.id));

  if (!row) {
    res.status(404).json({ error: "Application not found" });
    return;
  }

  res.json(serializeApplication(row.application, row.job));
});

router.patch("/applications/:id", async (req, res): Promise<void> => {
  const params = UpdateApplicationStatusParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const body = UpdateApplicationStatusBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  const updateValues: Partial<typeof applicationsTable.$inferInsert> = {};
  if (body.data.status) updateValues.status = body.data.status;
  if (body.data.notes !== undefined) updateValues.notes = body.data.notes;

  const [updated] = await db
    .update(applicationsTable)
    .set(updateValues)
    .where(eq(applicationsTable.id, params.data.id))
    .returning();

  if (!updated) {
    res.status(404).json({ error: "Application not found" });
    return;
  }

  const [row] = await db
    .select({ application: applicationsTable, job: jobsTable })
    .from(applicationsTable)
    .innerJoin(jobsTable, eq(applicationsTable.jobId, jobsTable.id))
    .where(eq(applicationsTable.id, params.data.id));

  res.json(serializeApplication(row!.application, row!.job));
});

function serializeApplication(
  app: typeof applicationsTable.$inferSelect,
  job: typeof jobsTable.$inferSelect
) {
  return {
    ...app,
    appliedAt: app.appliedAt.toISOString(),
    job: {
      ...job,
      scrapedAt: job.scrapedAt.toISOString(),
    },
  };
}

export default router;
