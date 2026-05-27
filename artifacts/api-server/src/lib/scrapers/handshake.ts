import { type Page } from "playwright";
import { getContextWithSession, saveSession } from "../browser";
import { db, jobsTable } from "@workspace/db";
import { addLog } from "../automationLog";
import { isUsLocation, resolveCountry, isTitleAvoided } from "../locationFilter";
import type { ScrapeResult } from "./linkedin";

const SESSION_FILE = "handshake_asu_session.json";
const DUO_WAIT_MS = 120_000;

async function isLoggedIn(page: Page): Promise<boolean> {
  try {
    await page.goto("https://asu.joinhandshake.com/stu/postings", {
      waitUntil: "domcontentloaded",
      timeout: 20000,
    });
    const url = page.url();
    return url.includes("joinhandshake.com/stu");
  } catch {
    return false;
  }
}

async function loginAsu(page: Page, email: string, password: string): Promise<void> {
  await addLog("info", "Handshake: navigating to ASU SSO login", "handshake");
  await page.goto("https://asu.joinhandshake.com/login", {
    waitUntil: "domcontentloaded",
    timeout: 30000,
  });

  // Click ASU SSO button
  const ssoBtn = await page.$(
    'a[href*="saml"], button:has-text("Sign in with your school account"), a:has-text("ASU"), a:has-text("school")'
  );
  if (ssoBtn) {
    await ssoBtn.click();
    await page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 15000 });
  }

  // Fill ASU weblogin
  const emailInput = await page.$('input[name="username"], input[type="email"], #username');
  if (emailInput) {
    await emailInput.fill(email);
    await page.waitForTimeout(300 + Math.random() * 300);
  }

  const passwordInput = await page.$('input[name="password"], input[type="password"], #password');
  if (passwordInput) {
    await passwordInput.fill(password);
    await page.waitForTimeout(200 + Math.random() * 200);
  }

  const submitBtn = await page.$('input[type="submit"], button[type="submit"]');
  if (submitBtn) await submitBtn.click();

  // Handle Duo MFA
  await page.waitForTimeout(3000);
  const hasDuo = await page.$('#duo_iframe, iframe[src*="duo"]').catch(() => null);
  if (hasDuo) {
    await addLog(
      "warn",
      "Handshake: Duo MFA required — please approve the Duo push notification. Waiting up to 2 minutes.",
      "handshake"
    );

    const duoStart = Date.now();
    while (Date.now() - duoStart < DUO_WAIT_MS) {
      await page.waitForTimeout(5000);
      const url = page.url();
      if (url.includes("joinhandshake.com")) {
        await addLog("info", "Handshake: Duo MFA approved, session established", "handshake");
        return;
      }
    }
    throw new Error("Handshake: Duo MFA not approved within 2 minutes");
  }

  // Wait for redirect to Handshake
  await page.waitForURL((url) => url.toString().includes("joinhandshake.com"), {
    timeout: 30000,
  });
  await addLog("info", "Handshake: ASU SSO login successful", "handshake");
}

export async function scrapeHandshakeJobs(
  keywords: string[],
  asuEmail: string | null,
  asuPassword: string | null,
  avoidKeywords: string[] = []
): Promise<ScrapeResult> {
  if (!asuEmail || !asuPassword) {
    await addLog("warn", "Handshake credentials not configured — skipping", "handshake");
    return { scraped: 0, filteredNonUs: 0 };
  }

  let scraped = 0;
  let filteredNonUs = 0;

  const ctx = await getContextWithSession(SESSION_FILE);
  const page = await ctx.newPage();

  try {
    const loggedIn = await isLoggedIn(page);
    if (!loggedIn) {
      await loginAsu(page, asuEmail, asuPassword);
      await saveSession(ctx, SESSION_FILE);
    } else {
      await addLog("info", "Handshake: using saved ASU session", "handshake");
    }

    for (const keyword of keywords) {
      await addLog(`info`, `Handshake: scraping keyword "${keyword}"`, "handshake");

      const searchUrl =
        `https://asu.joinhandshake.com/stu/postings?` +
        `category=full-time&sort_direction=desc&sort_column=core_job_posting&` +
        `query=${encodeURIComponent(keyword)}&job_type_names[]=Full-Time`;

      await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
      await page.waitForTimeout(2000 + Math.random() * 1000);

      // Scroll to load more
      for (let i = 0; i < 3; i++) {
        await page.evaluate(() => { (globalThis as any).scrollBy(0, 600); });
        await page.waitForTimeout(500 + Math.random() * 400);
      }

      // Collect job posting links
      const jobLinks = await page
        .$$eval(
          'a[href*="/stu/postings/"]',
          (links: any[]) =>
            [
              ...new Set(
                links.map((l: any) => l.href as string).filter((u: string) => /\/stu\/postings\/\d+/.test(u))
              ),
            ]
        )
        .catch(() => [] as string[]);

      for (const jobUrl of jobLinks.slice(0, 15)) {
        try {
          await page.goto(jobUrl, { waitUntil: "domcontentloaded", timeout: 20000 });
          await page.waitForTimeout(500 + Math.random() * 800);

          const jobTitle = await page
            .$eval('h1[data-testid="posting-title"], h1.posting-title, h1', (el) =>
              el.textContent?.trim() ?? ""
            )
            .catch(() => "");

          const company = await page
            .$eval(
              '[data-testid="employer-name"], .employer-name, [class*="employer"]',
              (el) => el.textContent?.trim() ?? ""
            )
            .catch(() => "");

          const location = await page
            .$eval(
              '[data-testid="posting-location"], [class*="location"]',
              (el) => el.textContent?.trim() ?? ""
            )
            .catch(() => "");

          const description = await page
            .$eval(
              '[data-testid="posting-description"], [class*="description"], .posting-description',
              (el) => el.textContent?.trim() ?? ""
            )
            .catch(() => "");

          if (!jobTitle) continue;
          if (isTitleAvoided(jobTitle, avoidKeywords)) continue;

          const countryResolved = resolveCountry(location);
          const isUs = isUsLocation(location) || !location; // Handshake defaults to US
          const status = isUs ? "queued" : "filtered_non_us";
          if (!isUs) filteredNonUs++;

          try {
            await db.insert(jobsTable).values({
              platform: "handshake",
              jobTitle,
              company: company || "Unknown Employer",
              location: location || null,
              remote: location.toLowerCase().includes("remote"),
              jobDescription: description || null,
              applyUrl: jobUrl,
              status,
              countryResolved,
            });
            scraped++;
          } catch {
            // Duplicate — ignore
          }
        } catch (err) {
          await addLog("warn", `Handshake: failed to extract job at ${jobUrl}: ${err}`, "handshake");
        }
      }

      await page.waitForTimeout(2000 + Math.random() * 2000);
    }

    await addLog(
      "info",
      `Handshake: scraped ${scraped} jobs, filtered ${filteredNonUs} non-US`,
      "handshake"
    );
  } catch (err) {
    await addLog("error", `Handshake scraper error: ${err}`, "handshake");
    throw err;
  } finally {
    await page.close();
    await ctx.close();
  }

  return { scraped, filteredNonUs };
}
