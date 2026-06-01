import { Router, type IRouter } from "express";
import { db, jobsTable } from "@workspace/db";
import { eq, and, desc, count, SQL } from "drizzle-orm";
import {
  ListJobsQueryParams,
  GetJobParams,
  UpdateJobStatusParams,
  UpdateJobStatusBody,
  DeleteJobParams,
  GetJobPreviewParams,
} from "@workspace/api-zod";
import { generateCoverLetter } from "../lib/aiClient";
import { db as dbClient, resumeTable } from "@workspace/db";

const router: IRouter = Router();

router.get("/jobs", async (req, res): Promise<void> => {
  const query = ListJobsQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }

  const { status, platform, limit = 50, offset = 0 } = query.data;

  const conditions: SQL[] = [];
  if (status) conditions.push(eq(jobsTable.status, status));
  if (platform) conditions.push(eq(jobsTable.platform, platform));

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const [jobs, [totalRow]] = await Promise.all([
    db.select().from(jobsTable).where(whereClause).orderBy(desc(jobsTable.scrapedAt)).limit(limit).offset(offset),
    db.select({ count: count() }).from(jobsTable).where(whereClause),
  ]);

  res.json({
    jobs: jobs.map(serializeJob),
    total: totalRow?.count ?? 0,
  });
});

router.get("/jobs/:id", async (req, res): Promise<void> => {
  const params = GetJobParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [job] = await db.select().from(jobsTable).where(eq(jobsTable.id, params.data.id));
  if (!job) {
    res.status(404).json({ error: "Job not found" });
    return;
  }

  res.json(serializeJob(job));
});

router.patch("/jobs/:id", async (req, res): Promise<void> => {
  const params = UpdateJobStatusParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const body = UpdateJobStatusBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  const [job] = await db
    .update(jobsTable)
    .set({ status: body.data.status })
    .where(eq(jobsTable.id, params.data.id))
    .returning();

  if (!job) {
    res.status(404).json({ error: "Job not found" });
    return;
  }

  res.json(serializeJob(job));
});

router.delete("/jobs/:id", async (req, res): Promise<void> => {
  const params = DeleteJobParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  await db.delete(jobsTable).where(eq(jobsTable.id, params.data.id));
  res.sendStatus(204);
});

router.get("/jobs/:id/preview", async (req, res): Promise<void> => {
  const params = GetJobPreviewParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [job] = await db.select().from(jobsTable).where(eq(jobsTable.id, params.data.id));
  if (!job) {
    res.status(404).json({ error: "Job not found" });
    return;
  }

  let coverLetter: string | null = job.coverLetterText ?? null;

  if (!coverLetter && job.jobDescription) {
    try {
      const [resume] = await dbClient.select().from(resumeTable).orderBy(desc(resumeTable.uploadedAt)).limit(1);
      if (resume) {
        coverLetter = await generateCoverLetter(
          job.id,
          resume.parsedJson as Record<string, unknown>,
          job.jobDescription,
          job.jobTitle,
          job.company
        );
      }
    } catch (err) {
      req.log.warn({ err }, "Could not generate cover letter for preview");
    }
  }

  res.json({
    job: serializeJob(job),
    coverLetter,
  });
});

// Reset failed/skipped jobs back to queued so they can be retried — EXCEPT jobs
// that have exhausted their retryable-attempt budget (notes [attempt:N], N>=MAX),
// which would otherwise keep cycling and burning the daily limit every run.
router.post("/jobs/retry-failed", async (_req, res): Promise<void> => {
  try {
    const MAX_RETRYABLE_ATTEMPTS = 4;
    // skipped → queued (always; these are still within their attempt budget)
    await db
      .update(jobsTable)
      .set({ status: "queued" })
      .where(eq(jobsTable.status, "skipped"));
    // failed → queued, but keep exhausted jobs as failed
    const failed = await db
      .select({ id: jobsTable.id, notes: jobsTable.notes })
      .from(jobsTable)
      .where(eq(jobsTable.status, "failed"));
    let reset = 0;
    let kept = 0;
    for (const j of failed) {
      const m = (j.notes ?? "").match(/\[attempt:(\d+)\]/);
      const attempts = m ? parseInt(m[1], 10) : 0;
      if (attempts >= MAX_RETRYABLE_ATTEMPTS) {
        kept++;
        continue;
      }
      await db.update(jobsTable).set({ status: "queued" }).where(eq(jobsTable.id, j.id));
      reset++;
    }
    res.json({
      ok: true,
      message: `Reset skipped + ${reset} failed jobs to queued; kept ${kept} exhausted (>=${MAX_RETRYABLE_ATTEMPTS} attempts) as failed`,
    });
  } catch (err) {
    console.error("retry-failed route error:", err);
    res.status(500).json({ ok: false, message: String(err) });
  }
});

function serializeJob(job: typeof jobsTable.$inferSelect) {
  return {
    ...job,
    scrapedAt: job.scrapedAt.toISOString(),
  };
}

export default router;
