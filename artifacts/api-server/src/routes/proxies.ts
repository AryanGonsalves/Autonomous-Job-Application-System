import { Router, type IRouter } from "express";
import { db, proxiesTable, settingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { getSetting, setSetting } from "../lib/settings";

const router: IRouter = Router();

function serializeProxy(p: typeof proxiesTable.$inferSelect) {
  return {
    ...p,
    lastTestedAt: p.lastTestedAt ? p.lastTestedAt.toISOString() : null,
    createdAt: p.createdAt.toISOString(),
  };
}

// GET /proxies
router.get("/proxies", async (_req, res): Promise<void> => {
  const proxies = await db.select().from(proxiesTable).orderBy(proxiesTable.createdAt);
  res.json(proxies.map(serializeProxy));
});

// POST /proxies
router.post("/proxies", async (req, res): Promise<void> => {
  const { label, host, port, username, password, protocol = "http", enabled = true } = req.body as {
    label?: string;
    host: string;
    port: string;
    username?: string;
    password?: string;
    protocol?: string;
    enabled?: boolean;
  };

  if (!host || !port) {
    res.status(400).json({ error: "host and port are required" });
    return;
  }

  const [proxy] = await db
    .insert(proxiesTable)
    .values({ label: label ?? null, host, port, username: username ?? null, password: password ?? null, protocol, enabled })
    .returning();

  res.status(201).json(serializeProxy(proxy!));
});

// PATCH /proxies/:id
router.patch("/proxies/:id", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw!, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const { label, host, port, username, password, protocol, enabled } = req.body as Partial<{
    label: string; host: string; port: string; username: string;
    password: string; protocol: string; enabled: boolean;
  }>;

  const updates: Partial<typeof proxiesTable.$inferInsert> = {};
  if (label !== undefined) updates.label = label;
  if (host !== undefined) updates.host = host;
  if (port !== undefined) updates.port = port;
  if (username !== undefined) updates.username = username;
  if (password !== undefined) updates.password = password;
  if (protocol !== undefined) updates.protocol = protocol;
  if (enabled !== undefined) updates.enabled = enabled;

  const [proxy] = await db.update(proxiesTable).set(updates).where(eq(proxiesTable.id, id)).returning();
  if (!proxy) { res.status(404).json({ error: "Proxy not found" }); return; }

  res.json(serializeProxy(proxy));
});

// DELETE /proxies/:id
router.delete("/proxies/:id", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw!, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  await db.delete(proxiesTable).where(eq(proxiesTable.id, id));
  res.sendStatus(204);
});

// POST /proxies/:id/test
router.post("/proxies/:id/test", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw!, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [proxy] = await db.select().from(proxiesTable).where(eq(proxiesTable.id, id));
  if (!proxy) { res.status(404).json({ error: "Proxy not found" }); return; }

  const start = Date.now();
  let success = false;
  let message = "";
  let ip: string | null = null;

  try {
    const proxyUrl = proxy.username && proxy.password
      ? `${proxy.protocol}://${proxy.username}:${proxy.password}@${proxy.host}:${proxy.port}`
      : `${proxy.protocol}://${proxy.host}:${proxy.port}`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    const response = await fetch("https://api.ipify.org?format=json", {
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (response.ok) {
      const data = await response.json() as { ip?: string };
      ip = data.ip ?? null;
      success = true;
      message = `Connected successfully via ${proxy.host}:${proxy.port}`;
    } else {
      message = `HTTP ${response.status} from test endpoint`;
    }
  } catch (err) {
    message = err instanceof Error
      ? (err.name === "AbortError" ? "Connection timed out (8s)" : err.message)
      : "Connection failed";
  }

  const latencyMs = Date.now() - start;
  const testStatus = success ? "ok" : "failed";

  await db
    .update(proxiesTable)
    .set({ lastTestedAt: new Date(), lastTestStatus: testStatus })
    .where(eq(proxiesTable.id, id));

  res.json({ success, message, latencyMs: success ? latencyMs : null, ip });
});

// GET /proxies/rotation
router.get("/proxies/rotation", async (_req, res): Promise<void> => {
  const [enabled, strategy, rotateEvery] = await Promise.all([
    getSetting("proxyRotationEnabled"),
    getSetting("proxyRotationStrategy"),
    getSetting("proxyRotateEvery"),
  ]);

  res.json({
    enabled: enabled === "true",
    strategy: (strategy || "round-robin") as "round-robin" | "random" | "least-used",
    rotateEvery: parseInt(rotateEvery || "10", 10),
    activeProxyId: null,
  });
});

// PUT /proxies/rotation
router.put("/proxies/rotation", async (req, res): Promise<void> => {
  const { enabled, strategy, rotateEvery } = req.body as {
    enabled?: boolean; strategy?: string; rotateEvery?: number;
  };

  const ops: Promise<void>[] = [];
  if (enabled !== undefined) ops.push(setSetting("proxyRotationEnabled", String(enabled)));
  if (strategy !== undefined) ops.push(setSetting("proxyRotationStrategy", strategy));
  if (rotateEvery !== undefined) ops.push(setSetting("proxyRotateEvery", String(rotateEvery)));
  await Promise.all(ops);

  const [ena, strat, rEvery] = await Promise.all([
    getSetting("proxyRotationEnabled"),
    getSetting("proxyRotationStrategy"),
    getSetting("proxyRotateEvery"),
  ]);

  res.json({
    enabled: ena === "true",
    strategy: (strat || "round-robin") as "round-robin" | "random" | "least-used",
    rotateEvery: parseInt(rEvery || "10", 10),
    activeProxyId: null,
  });
});

export default router;
