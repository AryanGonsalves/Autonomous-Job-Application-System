import { chromium as playwrightChromium } from "playwright";
import { chromium as stealthChromium } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import type { Browser, BrowserContext } from "playwright";
import * as fs from "fs";
import * as path from "path";

// Apply all stealth evasions to the playwright-extra chromium instance
stealthChromium.use(StealthPlugin());

// ── Shared browser instances ────────────────────────────────────────────────

let headlessBrowser: Browser | null = null;
let stealthBrowser: Browser | null = null;

const LAUNCH_ARGS = [
  "--no-sandbox",
  "--disable-setuid-sandbox",
  "--disable-blink-features=AutomationControlled",
  "--disable-dev-shm-usage",
  "--disable-accelerated-2d-canvas",
  "--disable-gpu",
];

const STEALTH_ARGS = [
  ...LAUNCH_ARGS,
  "--disable-infobars",
  "--window-size=1280,800",
  "--start-maximized",
];

/** Plain headless browser — used for scraping (LinkedIn, Indeed search pages). */
export async function getBrowser(): Promise<Browser> {
  if (!headlessBrowser || !headlessBrowser.isConnected()) {
    headlessBrowser = await playwrightChromium.launch({
      headless: true,
      args: LAUNCH_ARGS,
    });
  }
  return headlessBrowser;
}

/**
 * Stealth headless browser — used for submission on sites with bot-detection
 * (LinkedIn Easy Apply, Indeed Quick Apply). Evades navigator.webdriver,
 * Chrome runtime spoofing, permissions fingerprinting, etc.
 */
export async function getStealthBrowser(): Promise<Browser> {
  if (!stealthBrowser || !stealthBrowser.isConnected()) {
    stealthBrowser = await (stealthChromium as any).launch({
      headless: true,
      args: STEALTH_ARGS,
    });
  }
  return stealthBrowser as unknown as Browser;
}

/**
 * Visible (headed) browser for manual logins — passkey, MFA, Duo, etc.
 * NOT cached — caller must close it after use.
 */
export async function getHeadedBrowser(): Promise<Browser> {
  return playwrightChromium.launch({
    headless: false,
    args: LAUNCH_ARGS,
  });
}

// ── Context helpers ─────────────────────────────────────────────────────────

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

async function makeContext(
  browser: Browser,
  userAgent?: string
): Promise<BrowserContext> {
  return browser.newContext({
    userAgent: userAgent ?? UA,
    viewport: { width: 1280, height: 800 },
    extraHTTPHeaders: { "Accept-Language": "en-US,en;q=0.9" },
    // Pretend to be a real Windows desktop with real locale/timezone
    locale: "en-US",
    timezoneId: "America/New_York",
    deviceScaleFactor: 1,
    hasTouch: false,
    isMobile: false,
    javaScriptEnabled: true,
  });
}

/** Regular context — for scraping (search pages). */
export async function getContextWithSession(
  sessionFile: string,
  userAgent?: string
): Promise<BrowserContext> {
  const b = await getBrowser();
  return loadSession(await makeContext(b, userAgent), sessionFile);
}

/** Stealth context — for submission on bot-protected platforms. */
export async function getStealthContextWithSession(
  sessionFile: string,
  userAgent?: string
): Promise<BrowserContext> {
  const b = await getStealthBrowser();
  return loadSession(await makeContext(b, userAgent), sessionFile);
}

/**
 * Creates a FRESH stealth browser + context per call (not the shared singleton).
 * Use this for per-job submissions so a crashed page / closed browser on one job
 * never infects subsequent jobs.
 *
 * The caller MUST invoke `closeBrowserFn()` in a finally block — it closes both
 * the context AND the browser.
 */
export async function createFreshStealthContext(
  sessionFile: string,
  userAgent?: string
): Promise<{ ctx: BrowserContext; closeBrowserFn: () => Promise<void> }> {
  const browser = await (stealthChromium as any).launch({
    headless: true,
    args: STEALTH_ARGS,
  }) as unknown as Browser;

  const ctx = await loadSession(await makeContext(browser, userAgent), sessionFile);

  return {
    ctx,
    closeBrowserFn: async () => {
      await ctx.close().catch(() => {});
      await browser.close().catch(() => {});
    },
  };
}

// ── Session persistence ─────────────────────────────────────────────────────

async function loadSession(
  ctx: BrowserContext,
  sessionFile: string
): Promise<BrowserContext> {
  const sessionPath = path.join(__dirname, "../../../sessions", sessionFile);
  if (fs.existsSync(sessionPath)) {
    try {
      const cookies = JSON.parse(fs.readFileSync(sessionPath, "utf-8"));
      await ctx.addCookies(cookies);
    } catch {
      // Corrupt session file — start fresh
    }
  }
  return ctx;
}

export async function saveSession(
  ctx: BrowserContext,
  sessionFile: string
): Promise<void> {
  const cookies = await ctx.cookies();
  const sessionPath = path.join(__dirname, "../../../sessions", sessionFile);
  fs.mkdirSync(path.dirname(sessionPath), { recursive: true });
  fs.writeFileSync(sessionPath, JSON.stringify(cookies, null, 2));
}

export async function closeBrowser(): Promise<void> {
  if (headlessBrowser) {
    await headlessBrowser.close();
    headlessBrowser = null;
  }
  if (stealthBrowser) {
    await stealthBrowser.close();
    stealthBrowser = null;
  }
}
