import { Router, type IRouter } from "express";
import { getHeadedBrowser, saveSession } from "../lib/browser";
import { getAllSettings, parseSettings } from "../lib/settings";
import { addLog } from "../lib/automationLog";
import type { BrowserContext } from "playwright";

const router: IRouter = Router();

// Tracks open auth sessions so we can report status
const authSessions: Map<string, { status: "open" | "success" | "failed"; message: string }> = new Map();

async function doLogin(
  platform: "linkedin" | "indeed",
  email: string | null,
  password: string | null,
  loginUrl: string,
  sessionFile: string,
  successCheck: (url: string) => boolean
): Promise<void> {
  const browser = await getHeadedBrowser();
  let ctx: BrowserContext | null = null;

  try {
    ctx = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
        "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      viewport: { width: 1280, height: 800 },
      locale: "en-US",
      timezoneId: "America/New_York",
    });

    const page = await ctx.newPage();
    await page.goto(loginUrl, { waitUntil: "domcontentloaded", timeout: 30000 });

    // Pre-fill credentials if configured
    if (email && password) {
      if (platform === "linkedin") {
        await page.fill("#username", email).catch(() => {});
        await page.waitForTimeout(400 + Math.random() * 300);
        await page.fill("#password", password).catch(() => {});
        await page.waitForTimeout(300 + Math.random() * 200);
        await page.click('button[type="submit"]').catch(() => {});
      } else if (platform === "indeed") {
        await page.fill('input[name="email"], input[type="email"]', email).catch(() => {});
        await page.waitForTimeout(400 + Math.random() * 300);
        await page.click('button[type="submit"], button:has-text("Continue")').catch(() => {});
        await page.waitForTimeout(1500);
        await page.fill('input[name="password"], input[type="password"]', password).catch(() => {});
        await page.waitForTimeout(300 + Math.random() * 200);
        await page.click('button[type="submit"], button:has-text("Sign in")').catch(() => {});
      }
    }

    await addLog(
      "info",
      `${platform}: browser window opened — complete any MFA/CAPTCHA then the session will be saved automatically`,
      platform
    );

    // Wait up to 3 minutes for the user to complete login (MFA, CAPTCHA, etc.)
    await page.waitForFunction(
      (check: string) => {
        const fn = new Function("url", `return (${check})(url)`);
        return fn(window.location.href);
      },
      successCheck.toString(),
      { timeout: 180000, polling: 1000 }
    ).catch(() => {
      throw new Error(`${platform}: login not completed within 3 minutes`);
    });

    await saveSession(ctx, sessionFile);
    await addLog("info", `${platform}: session saved successfully — submissions will use this session`, platform);
  } finally {
    if (ctx) await ctx.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

/**
 * POST /api/auth/linkedin
 * Opens a headed Chrome window pre-filled with LinkedIn credentials.
 * Waits up to 3 minutes for login to complete (to handle MFA/CAPTCHA).
 * Saves session cookies and closes the browser.
 */
router.post("/auth/linkedin", async (_req, res): Promise<void> => {
  try {
    const raw = await getAllSettings();
    const settings = parseSettings(raw);

    await doLogin(
      "linkedin",
      settings.linkedinEmail,
      settings.linkedinPassword,
      "https://www.linkedin.com/login",
      "linkedin_session.json",
      (url: string) =>
        !url.includes("/login") &&
        !url.includes("/authwall") &&
        !url.includes("/checkpoint") &&
        !url.includes("/uas/login") &&
        url.includes("linkedin.com")
    );

    res.json({ ok: true, message: "LinkedIn session saved — you are now logged in" });
  } catch (err) {
    await addLog("error", `LinkedIn auth failed: ${err}`, "linkedin");
    res.status(500).json({ ok: false, message: err instanceof Error ? err.message : String(err) });
  }
});

/**
 * POST /api/auth/indeed
 * Same flow for Indeed.
 */
router.post("/auth/indeed", async (_req, res): Promise<void> => {
  try {
    const raw = await getAllSettings();
    const settings = parseSettings(raw);

    await doLogin(
      "indeed",
      settings.indeedEmail,
      settings.indeedPassword,
      "https://secure.indeed.com/account/login",
      "indeed_session.json",
      (url: string) =>
        !url.includes("/login") &&
        !url.includes("/auth") &&
        !url.includes("/account/login") &&
        url.includes("indeed.com")
    );

    res.json({ ok: true, message: "Indeed session saved — you are now logged in" });
  } catch (err) {
    await addLog("error", `Indeed auth failed: ${err}`, "indeed");
    res.status(500).json({ ok: false, message: err instanceof Error ? err.message : String(err) });
  }
});

export default router;
