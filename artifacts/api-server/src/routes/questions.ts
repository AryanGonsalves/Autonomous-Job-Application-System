import { Router, type IRouter } from "express";
import { db, questionsBankTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";

const router: IRouter = Router();

// GET /questions — list all questions (optionally filter by needsReview)
router.get("/questions", async (req, res): Promise<void> => {
  const reviewOnly = req.query["needsReview"] === "true";

  const rows = await db
    .select()
    .from(questionsBankTable)
    .where(reviewOnly ? eq(questionsBankTable.needsReview, true) : undefined)
    .orderBy(desc(questionsBankTable.createdAt))
    .limit(200);

  res.json(rows);
});

// GET /questions/review — shortcut: questions pending user review
router.get("/questions/review", async (_req, res): Promise<void> => {
  const rows = await db
    .select()
    .from(questionsBankTable)
    .where(eq(questionsBankTable.needsReview, true))
    .orderBy(desc(questionsBankTable.createdAt))
    .limit(100);

  res.json(rows);
});

// GET /questions/stats — counts for the dashboard badge
router.get("/questions/stats", async (_req, res): Promise<void> => {
  const all = await db.select().from(questionsBankTable);
  res.json({
    total: all.length,
    needsReview: all.filter((q) => q.needsReview).length,
    answered: all.filter((q) => !q.needsReview && q.answer).length,
  });
});

// POST /questions/:id/answer — user provides a canonical answer
router.post("/questions/:id/answer", async (req, res): Promise<void> => {
  const id = parseInt(req.params["id"] ?? "", 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid question id" }); return; }

  const { answer, note } = req.body as { answer?: string; note?: string };
  if (!answer || typeof answer !== "string" || answer.trim().length === 0) {
    res.status(400).json({ error: "answer is required" }); return;
  }

  const [updated] = await db
    .update(questionsBankTable)
    .set({
      answer: answer.trim().slice(0, 2000),
      source: "user",
      confidence: 1.0,
      needsReview: false,
      userNote: note ? note.slice(0, 500) : null,
      updatedAt: new Date(),
    })
    .where(eq(questionsBankTable.id, id))
    .returning();

  if (!updated) { res.status(404).json({ error: "Question not found" }); return; }
  res.json({ ok: true, question: updated });
});

// DELETE /questions/:id — remove a question from the bank
router.delete("/questions/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params["id"] ?? "", 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid question id" });
    return;
  }

  await db.delete(questionsBankTable).where(eq(questionsBankTable.id, id));
  res.json({ ok: true });
});

// PUT /questions/:id — update question details (answer, note, needsReview)
router.put("/questions/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params["id"] ?? "", 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid question id" }); return; }

  const body = req.body as { answer?: string; note?: string; needsReview?: boolean };
  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (body.answer !== undefined) {
    updates["answer"] = body.answer.slice(0, 2000);
    updates["source"] = "user";
    updates["confidence"] = 1.0;
    updates["needsReview"] = false;
  }
  if (body.note !== undefined) updates["userNote"] = body.note.slice(0, 500);
  if (body.needsReview !== undefined) updates["needsReview"] = body.needsReview;

  const [updated] = await db
    .update(questionsBankTable)
    .set(updates)
    .where(eq(questionsBankTable.id, id))
    .returning();

  if (!updated) { res.status(404).json({ error: "Question not found" }); return; }
  res.json({ ok: true, question: updated });
});

// ── (#4) Consistency checker + dedup ─────────────────────────────────────────

type QRow = typeof questionsBankTable.$inferSelect;
const SOURCE_RANK: Record<string, number> = { user: 4, resume: 3, saved: 2, ai: 1 };
function rowScore(q: QRow): number {
  return (SOURCE_RANK[q.source ?? "ai"] ?? 0) * 10 + (q.confidence ?? 0);
}
function groupByNorm(all: QRow[]): Map<string, QRow[]> {
  const groups = new Map<string, QRow[]>();
  for (const q of all) {
    const k = (q.questionNorm || q.question || "").trim().toLowerCase();
    if (!k) continue;
    const list = groups.get(k);
    if (list) list.push(q);
    else groups.set(k, [q]);
  }
  return groups;
}

// GET /questions/issues — surface contradictions: same normalized question, different answers.
router.get("/questions/issues", async (_req, res): Promise<void> => {
  const all = await db.select().from(questionsBankTable);
  const conflicts: Array<{ question: string; count: number; variants: Array<{ id: number; answer: string; source: string | null; confidence: number | null }> }> = [];
  for (const rows of groupByNorm(all).values()) {
    const distinct = new Set(rows.map((r) => (r.answer ?? "").trim().toLowerCase()).filter(Boolean));
    if (rows.length > 1 && distinct.size > 1) {
      conflicts.push({
        question: (rows[0]?.question ?? "").slice(0, 140),
        count: rows.length,
        variants: rows.map((r) => ({ id: r.id, answer: (r.answer ?? "").slice(0, 90), source: r.source, confidence: r.confidence })),
      });
    }
  }
  res.json({ conflictGroups: conflicts.length, conflicts: conflicts.slice(0, 100) });
});

// POST /questions/dedup — collapse duplicate normalized questions, keeping the best answer
// (prefers answered rows, then user > resume > saved > ai, then highest confidence).
router.post("/questions/dedup", async (_req, res): Promise<void> => {
  const all = await db.select().from(questionsBankTable);
  let removed = 0;
  let kept = 0;
  for (const rows of groupByNorm(all).values()) {
    if (rows.length <= 1) { kept += rows.length; continue; }
    const sorted = [...rows].sort((a, b) => {
      const answered = Number(!!b.answer) - Number(!!a.answer);
      if (answered !== 0) return answered;
      return rowScore(b) - rowScore(a);
    });
    kept++;
    for (const r of sorted.slice(1)) {
      await db.delete(questionsBankTable).where(eq(questionsBankTable.id, r.id));
      removed++;
    }
  }
  res.json({ ok: true, removed, kept });
});

export default router;
