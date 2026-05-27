import { Router, type IRouter } from "express";
import { runEmailImport } from "../lib/emailImporter";

const router: IRouter = Router();

router.post("/import/email", async (_req, res): Promise<void> => {
  try {
    const result = await runEmailImport();
    res.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

export default router;
