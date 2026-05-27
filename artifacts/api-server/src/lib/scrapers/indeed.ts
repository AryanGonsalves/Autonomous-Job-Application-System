import { type Page } from "playwright";
import { getContextWithSession, getHeadedBrowser, saveSession } from "../browser";
import { db, jobsTable } from "@workspace/db";
import { addLog } from "../automationLog";
import { isUsLocation, resolveCountry, isTitleAvoided } from "../locationFilter";
import { type parseSettings } from "../settings";
import type { ScrapeResult } from "./linkedin";

const SESSION_FILE = "indeed_session.json";

async function isLoggedIn(page: Page): Promise<boolean> {
  try {
    await page.goto("https://www.indeed.com/", { waitUntil: "domcontentloaded", timeout: 20000 });
    const url = page.url();
    if (url.includes("/login") || url.includes("/auth") || url.includes("/account/login")) return false;
    // Check for the presence of the user menu / profile icon which only appears when logged in
    const loggedInIndicator = await page.$('[data-testid="header-user-menu-trigger"], [aria-label="Profile"], #indeed-ia-header-user-avatar').catch(() => null);
    return loggedInIndicator !== null;
  } catch {
    return false;
  }
}

/**
 * Opens a visible browser window so the user can log in manually (passkey, MFA, etc.).
 * Pre-fills the email if provided, then waits up to 3 minutes for the user to finish.
 * Saves cookies on success.
 */
async function loginManual(email: string | null): Promise<void> {
  await addLog("info", "Indeed: opening browser for manual login (passkey/MFA) — complete login in the browser window", "indeed");

  const headedBrowser = await getHeadedBrowser();
  const ctx = await headedBrowser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    viewport: { width: 1280, height: 800 },
  });
  const page = await ctx.newPage();

  try {
    await page.goto("https://secure.indeed.com/account/login", {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });

    // Pre-fill email if provided so user just needs to hit Continue + passkey
    if (email) {
      const emailInput = await page.$('input[type="email"], input[name="__email"]').catch(() => null);
      if (emailInput) {
        await emailInput.fill(email);
        await page.waitForTimeout(400);
        const continueBtn = await page.$('button[type="submit"]').catch(() => null);
        if (continueBtn) await continueBtn.click();
      }
    }

    await addLog("info", "Indeed: waiting up to 3 minutes for you to complete login in the browser window…", "indeed");

    // Wait until the URL leaves /login — user completes passkey/MFA in the visible window
    await page.waitForURL(
      (url) => !url.toString().includes("/login") && !url.toString().includes("/auth"),
      { timeout: 180_000 }
    );

    await saveSession(ctx, SESSION_FILE);
    await addLog("info", "Indeed: manual login successful — session saved", "indeed");
  } finally {
    await page.close();
    await ctx.close();
    await headedBrowser.close();
  }
}

async function scrapeJobsForKeyword(
  page: Page,
  keyword: string
): Promise<Array<{ url: string; title: string; company: string; location: string; description: string }>> {
  const searchUrl =
    `https://www.indeed.com/jobs?q=${encodeURIComponent(keyword)}` +
    `&l=United+States&fromage=1&remotejobs=1&sort=date`;

  await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(1500 + Math.random() * 1000);

  // Scroll to load results
  for (let i = 0; i < 3; i++) {
    await page.evaluate(() => window.scrollBy(0, 600));
    await page.waitForTimeout(600 + Math.random() * 400);
  }

  // Collect all job cards info from the list (without navigating away)
  const cardInfos = await page
    .$$eval(
      '[data-testid="jobCard"], .jobCard, .job_seen_beacon, [class*="job_seen_beacon"]',
      (cards: any[]) =>
        cards.map((card: any) => {
          const titleLink = card.querySelector(
            '[data-testid="job-title"] a, h2.jobTitle a, h2 a[id*="job_"]'
          );
          // Keep the full URL but strip tracking params — keep jk= (job key) for uniqueness
          const rawHref = titleLink?.href ?? '';
          const jkMatch = rawHref.match(/[?&](jk=[a-z0-9]+)/i);
          const url = jkMatch
            ? `https://www.indeed.com/viewjob?${jkMatch[1]}`
            : rawHref.split('?')[0];
          const title = titleLink?.textContent?.trim() ?? '';
          const company =
            card.querySelector(
              '[data-testid="company-name"], .companyName, [class*="companyName"]'
            )?.textContent?.trim() ?? '';
          const location =
            card.querySelector(
              '[data-testid="text-location"], .companyLocation, [class*="companyLocation"]'
            )?.textContent?.trim() ?? '';
          const hasEasyApply = card.textContent?.toLowerCase().includes('easily apply') ?? false;
          return { url, title, company, location, hasEasyApply };
        })
    )
    .catch(() => [] as Array<{ url: string; title: string; company: string; location: string; hasEasyApply: boolean }>);

  const validCards = cardInfos.filter(
    (j) => j.hasEasyApply && j.url && j.title
  ).slice(0, 20);

  await addLog(
    "info",
    `Indeed: found ${validCards.length} "Easily apply" listings for "${keyword}"`,
    "indeed"
  );

  const results: Array<{ url: string; title: string; company: string; location: string; description: string }> = [];

  // Click each card to load the right-side detail panel; extract description from there
  const cardElements = await page.$$(
    '[data-testid="jobCard"], .jobCard, .job_seen_beacon, [class*="job_seen_beacon"]'
  );

  for (let i = 0; i < Math.min(cardElements.length, 20); i++) {
    const cardEl = cardElements[i];
    const info = cardInfos[i];
    if (!info?.hasEasyApply || !info.title || !info.url) continue;

    try {
      // Click the card title link to load the detail panel (stays on same page)
      const titleLink = await cardEl.$('[data-testid="job-title"] a, h2.jobTitle a, h2 a[id*="job_"]');
      if (titleLink) {
        await titleLink.click();
      } else {
        await cardEl.click();
      }
      await page.waitForTimeout(1500 + Math.random() * 800);

      // Extract description from the right-side detail panel
      const description = await page
        .$eval(
          '#jobDescriptionText, [data-testid="jobDescriptionText"], .jobsearch-jobDescriptionText, [id*="jobDescription"]',
          (el: any) => el.textContent?.trim() ?? ''
        )
        .catch(() => '');

      // Try to get title/company/location from detail panel if missing from card
      const detailTitle = info.title || await page
        .$eval(
          'h1[data-testid="jobsearch-JobInfoHeader-title"], h2[data-testid="jobsearch-JobInfoHeader-title"], .jobsearch-JobInfoHeader-title',
          (el: any) => el.textContent?.trim() ?? ''
        )
        .catch(() => '');

      const detailCompany = info.company || await page
        .$eval(
          '[data-testid="inlineHeader-companyName"] a, [data-testid="inlineHeader-companyName"]',
          (el: any) => el.textContent?.trim() ?? ''
        )
        .catch(() => '');

      const detailLocation = info.location || await page
        .$eval(
          '[data-testid="job-location"], [data-testid="inlineHeader-companyLocation"]',
          (el: any) => el.textContent?.trim() ?? ''
        )
        .catch(() => '');

      results.push({
        url: info.url,
        title: detailTitle || info.title,
        company: detailCompany || info.company,
        location: detailLocation || info.location,
        description,
      });
    } catch (err) {
      await addLog("warn", `Indeed: failed to extract details for "${info.title}": ${err}`, "indeed");
      // Still add with card data if we have enough
      if (info.title && info.company) {
        results.push({ url: info.url, title: info.title, company: info.company, location: info.location, description: '' });
      }
    }

    await page.waitForTimeout(800 + Math.random() * 600);
  }

  return results;
}

export async function scrapeIndeed(
  settings: ReturnType<typeof parseSettings>
): Promise<ScrapeResult> {
  if (!settings.indeedEmail) {
    await addLog("warn", "Indeed email not configured — skipping", "indeed");
    return { scraped: 0, filteredNonUs: 0 };
  }

  let scraped = 0;
  let filteredNonUs = 0;

  const ctx = await getContextWithSession(SESSION_FILE);
  const page = await ctx.newPage();

  try {
    const loggedIn = await isLoggedIn(page);
    if (!loggedIn) {
      // Close the headless context before opening the headed one
      await page.close();
      await ctx.close();
      await loginManual(settings.indeedEmail);
      // Re-open headless context with the newly saved session
      const freshCtx = await getContextWithSession(SESSION_FILE);
      const freshPage = await freshCtx.newPage();
      return await _scrapeWithPage(freshPage, freshCtx, settings);
    } else {
      await addLog("info", "Indeed: using saved session", "indeed");
    }

    return await _scrapeWithPage(page, ctx, settings);
  } catch (err) {
    await addLog("error", `Indeed scraper error: ${err}`, "indeed");
    await page.close();
    await ctx.close();
    throw err;
  }
}

async function _scrapeWithPage(
  page: Page,
  ctx: Awaited<ReturnType<typeof getContextWithSession>>,
  settings: ReturnType<typeof parseSettings>
): Promise<ScrapeResult> {
  let scraped = 0;
  let filteredNonUs = 0;

  try {
    for (const keyword of settings.keywords) {
      await addLog("info", `Indeed: scraping keyword "${keyword}"`, "indeed");
      const jobs = await scrapeJobsForKeyword(page, keyword);

      for (const job of jobs) {
        if (isTitleAvoided(job.title, settings.avoidKeywords)) {
          await addLog("info", `Indeed: skipping avoided title "${job.title}"`, "indeed");
          continue;
        }
        const countryResolved = resolveCountry(job.location);
        const isUs = isUsLocation(job.location);
        const status = isUs ? "queued" : "filtered_non_us";
        if (!isUs) filteredNonUs++;

        try {
          await db.insert(jobsTable).values({
            platform: "indeed",
            jobTitle: job.title,
            company: job.company,
            location: job.location || null,
            remote: job.location.toLowerCase().includes("remote"),
            jobDescription: job.description || null,
            applyUrl: job.url,
            status,
            countryResolved,
          });
          scraped++;
        } catch {
          // Duplicate — ignore
        }
      }

      await page.waitForTimeout(2000 + Math.random() * 2000);
    }

    await addLog("info", `Indeed: scraped ${scraped} jobs, filtered ${filteredNonUs} non-US`, "indeed");
  } finally {
    await page.close();
    await ctx.close();
  }

  return { scraped, filteredNonUs };
}
