import { Router, type IRouter } from "express";
import { getAllSettings, parseSettings, setSetting } from "../lib/settings";
import { UpdateSettingsBody } from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/settings", async (_req, res): Promise<void> => {
  const raw = await getAllSettings();
  const settings = parseSettings(raw);
  res.json(settings);
});

router.put("/settings", async (req, res): Promise<void> => {
  const body = UpdateSettingsBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  const updates = body.data;
  const ops: Promise<void>[] = [];

  if (updates.contactEmail !== undefined) ops.push(setSetting("contactEmail", updates.contactEmail ?? ""));
  if (updates.contactPhone !== undefined) ops.push(setSetting("contactPhone", updates.contactPhone ?? ""));
  if (updates.keywords !== undefined) ops.push(setSetting("keywords", JSON.stringify(updates.keywords)));
  if (updates.avoidKeywords !== undefined) ops.push(setSetting("avoidKeywords", JSON.stringify(updates.avoidKeywords)));
  if (updates.locationPreference !== undefined) ops.push(setSetting("locationPreference", updates.locationPreference));
  if (updates.dailyLimit !== undefined) ops.push(setSetting("dailyLimit", String(updates.dailyLimit)));
  if (updates.openaiApiKey !== undefined) ops.push(setSetting("openaiApiKey", updates.openaiApiKey));
  if (updates.linkedinEmail !== undefined) ops.push(setSetting("linkedinEmail", updates.linkedinEmail));
  if (updates.linkedinPassword !== undefined) ops.push(setSetting("linkedinPassword", updates.linkedinPassword));
  if (updates.indeedEmail !== undefined) ops.push(setSetting("indeedEmail", updates.indeedEmail));
  if (updates.indeedPassword !== undefined) ops.push(setSetting("indeedPassword", updates.indeedPassword));
  if (updates.handshakeAsuEmail !== undefined) ops.push(setSetting("handshakeAsuEmail", updates.handshakeAsuEmail ?? ""));
  if (updates.handshakeAsuPassword !== undefined) ops.push(setSetting("handshakeAsuPassword", updates.handshakeAsuPassword ?? ""));
  if (updates.imapGmailEmail !== undefined) ops.push(setSetting("imapGmailEmail", updates.imapGmailEmail ?? ""));
  if (updates.imapGmailAppPassword !== undefined) ops.push(setSetting("imapGmailAppPassword", updates.imapGmailAppPassword ?? ""));
  if (updates.imapYahooEmail !== undefined) ops.push(setSetting("imapYahooEmail", updates.imapYahooEmail ?? ""));
  if (updates.imapYahooAppPassword !== undefined) ops.push(setSetting("imapYahooAppPassword", updates.imapYahooAppPassword ?? ""));
  if (updates.enableLinkedin !== undefined) ops.push(setSetting("enableLinkedin", String(updates.enableLinkedin)));
  if (updates.enableIndeed !== undefined) ops.push(setSetting("enableIndeed", String(updates.enableIndeed)));
  if (updates.enableGreenhouse !== undefined) ops.push(setSetting("enableGreenhouse", String(updates.enableGreenhouse)));
  if (updates.enableLever !== undefined) ops.push(setSetting("enableLever", String(updates.enableLever)));
  if (updates.enableHandshake !== undefined) ops.push(setSetting("enableHandshake", String(updates.enableHandshake)));
  if (updates.enableResumeTailoring !== undefined) ops.push(setSetting("enableResumeTailoring", String(updates.enableResumeTailoring)));
  if (updates.scheduledTime !== undefined) ops.push(setSetting("scheduledTime", updates.scheduledTime));

  await Promise.all(ops);

  const raw = await getAllSettings();
  const settings = parseSettings(raw);
  res.json(settings);
});

export default router;
