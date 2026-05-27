import { Router, type IRouter } from "express";
import multer from "multer";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { db, resumeTable } from "@workspace/db";
import { desc } from "drizzle-orm";
import { parseResume } from "../lib/resumeParser";
import { setSetting } from "../lib/settings";
import { GetResumeResponse } from "@workspace/api-zod";

const RESUME_DIR = path.join(__dirname, "../../../resumes");

const router: IRouter = Router();
const upload = multer({ dest: os.tmpdir() });

router.get("/resume", async (_req, res): Promise<void> => {
  const [resume] = await db.select().from(resumeTable).orderBy(desc(resumeTable.uploadedAt)).limit(1);
  if (!resume) {
    res.status(404).json({ error: "No resume uploaded" });
    return;
  }
  res.json(GetResumeResponse.parse({
    id: resume.id,
    rawText: resume.rawText,
    parsedJson: resume.parsedJson,
    uploadedAt: resume.uploadedAt.toISOString(),
  }));
});

router.post("/resume/upload", upload.single("file"), async (req, res): Promise<void> => {
  if (!req.file) {
    res.status(400).json({ error: "No file uploaded" });
    return;
  }

  try {
    const { rawText, parsed } = await parseResume(req.file.path, req.file.mimetype);

    const [resume] = await db
      .insert(resumeTable)
      .values({ rawText, parsedJson: parsed })
      .returning();

    // Persist the original file for use in application uploads
    const ext = path.extname(req.file.originalname) || ".pdf";
    const savedPath = path.join(RESUME_DIR, `resume_${resume!.id}${ext}`);
    fs.mkdirSync(RESUME_DIR, { recursive: true });
    fs.copyFileSync(req.file.path, savedPath);
    await setSetting("resumeFilePath", savedPath);

    // Clean up temp file
    fs.unlinkSync(req.file.path);

    res.json(GetResumeResponse.parse({
      id: resume!.id,
      rawText: resume!.rawText,
      parsedJson: resume!.parsedJson,
      uploadedAt: resume!.uploadedAt.toISOString(),
    }));
  } catch (err) {
    req.log.error({ err }, "Failed to parse resume");
    try { fs.unlinkSync(req.file.path); } catch { /* ignore */ }
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to parse resume" });
  }
});

export default router;
