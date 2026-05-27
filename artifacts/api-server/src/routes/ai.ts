import { Router, type IRouter } from "express";
import { GenerateCoverLetterBody } from "@workspace/api-zod";
import { db, jobsTable, resumeTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { generateCoverLetter } from "../lib/aiClient";

const router: IRouter = Router();

router.post("/ai/generate-cover-letter", async (req, res): Promise<void> => {
  const body = GenerateCoverLetterBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  const [job] = await db.select().from(jobsTable).where(eq(jobsTable.id, body.data.jobId));
  if (!job) {
    res.status(404).json({ error: "Job not found" });
    return;
  }

  const cached = !!job.coverLetterText;

  const [resume] = await db.select().from(resumeTable).orderBy(desc(resumeTable.uploadedAt)).limit(1);
  if (!resume) {
    res.status(400).json({ error: "No resume uploaded. Please upload your resume first." });
    return;
  }

  try {
    const coverLetter = await generateCoverLetter(
      job.id,
      resume.parsedJson as Record<string, unknown>,
      job.jobDescription ?? "",
      job.jobTitle,
      job.company
    );
    res.json({ coverLetter, cached });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to generate cover letter";
    res.status(500).json({ error: message });
  }
});

export default router;
