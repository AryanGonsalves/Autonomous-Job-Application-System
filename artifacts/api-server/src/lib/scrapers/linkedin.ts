import { type Page } from "playwright";
import { getContextWithSession, saveSession } from "../browser";
import { db, jobsTable } from "@workspace/db";
import { addLog } from "../automationLog";
import { isUsLocation, resolveCountry, isTitleAvoided } from "../locationFilter";
import { type parseSettings } from "../settings";

const SESSION_FILE = "linkedin_session.json";

export interface ScrapeResult {
  scraped: number;
  filteredNonUs: number;
}

async function isLoggedIn(page: Page): Promise<boolean> {
  try {
    await page.goto("https://www.linkedin.com/feed/", {
      waitUntil: "domcontentloaded",
      timeout: 20000,
    });
    const url = page.url();
    return !url.includes("/login") && !url.includes("/authwall") && !url.includes("/checkpoint");
  } catch {
    return false;
  }
}

async function login(page: Page, email: string, password: string): Promise<void> {
  await addLog("info", "LinkedIn: logging in with credentials", "linkedin");
  await page.goto("https://www.linkedin.com/login", { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForSelector("#username", { timeout: 10000 });
  await page.fill("#username", email);
  await page.waitForTimeout(300 + Math.random() * 300);
  await page.fill("#password", password);
  await page.waitForTimeout(200 + Math.random() * 200);
  await page.click('button[type="submit"]');
  await page.waitForURL(
    (url) => !url.toString().includes("/login") && !url.toString().includes("/checkpoint"),
    { timeout: 30000 }
  );
  await saveSession(await page.context(), SESSION_FILE);
  await addLog("info", "LinkedIn: login successful", "linkedin");
}

async function scrapeJobsForKeyword(
  page: Page,
  keyword: string
): Promise<Array<{ url: string; title: string; company: string; location: string; description: string }>> {
  const searchUrl =
    `https://www.linkedin.com/jobs/search/?keywords=${encodeURIComponent(keyword)}` +
    `&geoId=103644278&f_AL=true&f_TPR=r86400&sortBy=DD`;

  await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(2000 + Math.random() * 1000);

  // Scroll to load job cards
  for (let i = 0; i < 4; i++) {
    await page.evaluate(() => window.scrollBy(0, 600));
    await page.waitForTimeout(500 + Math.random() * 400);
  }

  // Collect job cards — extract URL, title, company, location directly from list
  const jobCards = await page.$$eval(
    '.job-card-container, .jobs-search-results__list-item, [data-occludable-job-id]',
    (cards: any[]) => cards.map((card: any) => {
      const link = card.querySelector('a[href*="/jobs/view/"]');
      const url = link?.href?.split('?')[0] ?? '';
      // LinkedIn repeats title for screen readers — first non-empty line is the clean title
      const rawTitle = card.querySelector(
        '.job-card-list__title, .job-card-container__link, a[data-control-name="job_card_title"]'
      )?.textContent ?? '';
      let title = rawTitle.split(/\r?\n/).map((s: string) => s.trim()).find((s: string) => s.length > 0) ?? '';
      // Dedup: LinkedIn sometimes concatenates two copies of the title without separator
      if (title.length % 2 === 0) {
        const half = title.slice(0, title.length / 2);
        if (half === title.slice(title.length / 2)) title = half;
      }
      const company = card.querySelector(
        '.job-card-container__primary-description, .artdeco-entity-lockup__subtitle span'
      )?.textContent?.trim() ?? '';
      const location = card.querySelector(
        '.job-card-container__metadata-wrapper li, .artdeco-entity-lockup__caption li'
      )?.textContent?.trim() ?? '';
      return { url, title, company, location };
    })
  ).catch(() => [] as Array<{ url: string; title: string; company: string; location: string }>);

  const validCards = jobCards.filter(j => j.url.includes('/jobs/view/') && j.title);

  await addLog(
    "info",
    `LinkedIn: found ${validCards.length} job cards for "${keyword}"`,
    "linkedin"
  );

  const results: Array<{ url: string; title: string; company: string; location: string; description: string }> = [];

  // Click each card to load the side panel and extract description
  const cardElements = await page.$$('.job-card-container, .jobs-search-results__list-item, [data-occludable-job-id]');

  for (let i = 0; i < Math.min(cardElements.length, 25); i++) {
    const card = cardElements[i];
    const info = validCards[i];
    if (!info?.url || !info.title) continue;

    try {
      // Click the card to load details in the side panel
      await card.click();
      await page.waitForTimeout(1500 + Math.random() * 800);

      // Try to expand description
      const seeMoreBtn = await page.$('button[aria-label*="more description"], button.jobs-description__footer-button');
      if (seeMoreBtn) {
        await seeMoreBtn.click();
        await page.waitForTimeout(500);
      }

      // Extract description from the side panel
      const description = await page.$eval(
        '#job-details, .jobs-description__content, .jobs-box__html-content, .jobs-description-content__text',
        (el: any) => el.textContent?.trim() ?? ''
      ).catch(() => '');

      // If company/location empty from card, try getting from side panel
      const company = info.company || await page.$eval(
        '.jobs-unified-top-card__company-name, .job-details-jobs-unified-top-card__company-name',
        (el: any) => el.textContent?.trim() ?? ''
      ).catch(() => '');

      const location = info.location || await page.$eval(
        '.jobs-unified-top-card__bullet, .job-details-jobs-unified-top-card__bullet',
        (el: any) => el.textContent?.trim() ?? ''
      ).catch(() => '');

      results.push({ url: info.url, title: info.title, company, location, description });
    } catch (err) {
      await addLog("warn", `LinkedIn: failed to extract details for "${info.title}": ${err}`, "linkedin");
      // Still add the job with what we have from the card
      if (info.title && info.company) {
        results.push({ url: info.url, title: info.title, company: info.company, location: info.location, description: '' });
      }
    }

    await page.waitForTimeout(800 + Math.random() * 600);
  }

  return results;
}

export async function scrapeLinkedIn(
  settings: ReturnType<typeof parseSettings>
): Promise<ScrapeResult> {
  if (!settings.linkedinEmail || !settings.linkedinPassword) {
    await addLog("warn", "LinkedIn credentials not configured — skipping", "linkedin");
    return { scraped: 0, filteredNonUs: 0 };
  }

  let scraped = 0;
  let filteredNonUs = 0;

  const ctx = await getContextWithSession(SESSION_FILE);
  const page = await ctx.newPage();

  try {
    const loggedIn = await isLoggedIn(page);
    if (!loggedIn) {
      await login(page, settings.linkedinEmail, settings.linkedinPassword);
    } else {
      await addLog("info", "LinkedIn: using saved session", "linkedin");
    }

    for (const keyword of settings.keywords) {
      await addLog("info", `LinkedIn: scraping keyword "${keyword}"`, "linkedin");
      const jobs = await scrapeJobsForKeyword(page, keyword);

      for (const job of jobs) {
        if (isTitleAvoided(job.title, settings.avoidKeywords)) {
          await addLog("info", `LinkedIn: skipping avoided title "${job.title}"`, "linkedin");
          continue;
        }
        const countryResolved = resolveCountry(job.location);
        const isUs = isUsLocation(job.location);
        const status = isUs ? "queued" : "filtered_non_us";
        if (!isUs) filteredNonUs++;

        try {
          await db.insert(jobsTable).values({
            platform: "linkedin",
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

      await page.waitForTimeout(3000 + Math.random() * 2000);
    }

    await addLog("info", `LinkedIn: scraped ${scraped} jobs, filtered ${filteredNonUs} non-US`, "linkedin");
  } catch (err) {
    await addLog("error", `LinkedIn scraper error: ${err}`, "linkedin");
    throw err;
  } finally {
    await page.close();
    await ctx.close();
  }

  return { scraped, filteredNonUs };
}
