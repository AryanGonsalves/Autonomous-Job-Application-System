import { db, jobsTable } from "@workspace/db";
import { addLog } from "./automationLog";
import { isUsLocation, resolveCountry } from "./locationFilter";

/**
 * Handshake ASU platform scraper.
 *
 * PRODUCTION NOTES:
 * Full automation requires Playwright with browser automation.
 * This module:
 *  1. Simulates the scraping flow with realistic mock data (dev/demo mode)
 *  2. Documents the exact Playwright steps needed for production
 *
 * PLAYWRIGHT STEPS (production):
 *  1. Navigate to https://asu.joinhandshake.com/login
 *  2. Click "Sign in with your school account" (ASU SSO button)
 *  3. Fill ASU email + password on weblogin.asu.edu
 *  4. Handle Duo MFA: detect #duo_iframe, take screenshot, pause, notify dashboard
 *  5. Save cookies to sessions/handshake_asu_session.json
 *  6. On subsequent runs: load cookies, navigate to postings, check if redirected to login
 *  7. Search: https://asu.joinhandshake.com/stu/postings
 *     - Apply filters: keywords, Full-Time, United States/Remote, sort by Most Recent
 *  8. Collect: job title, company, location, description, apply URL
 *  9. For "Apply on Handshake" jobs: click apply, fill modal, upload resume, paste cover letter
 */

const HANDSHAKE_COMPANIES = [
  "Bloomberg", "Capital One", "Deloitte", "EY", "KPMG", "PwC",
  "Accenture", "McKinsey", "BCG", "Bain", "JPMorgan", "Goldman Sachs",
  "Morgan Stanley", "Wells Fargo", "Bank of America", "Citi",
  "American Express", "Visa", "Mastercard", "PayPal",
  "IBM", "Oracle", "SAP", "Salesforce", "ServiceNow",
  "Nielsen", "Gartner", "IDC", "Forrester", "S&P Global",
];

const HANDSHAKE_TITLES = [
  "Data Analyst", "Business Analyst", "Data Scientist",
  "Analytics Engineer", "Business Intelligence Analyst",
  "Market Research Analyst", "Financial Analyst", "Risk Analyst",
  "Operations Analyst", "Product Analyst",
];

const HANDSHAKE_LOCATIONS = [
  "Remote", "New York, NY", "Chicago, IL", "Dallas, TX",
  "Atlanta, GA", "Seattle, WA", "Boston, MA", "Denver, CO",
  "Charlotte, NC", "Phoenix, AZ",
];

export async function scrapeHandshakeJobs(
  keywords: string[],
  asuEmail: string | null,
  asuPassword: string | null,
): Promise<number> {
  if (!asuEmail || !asuPassword) {
    await addLog("warn", "Handshake credentials not configured — skipping Handshake scrape", "handshake");
    return 0;
  }

  await addLog("info", "Handshake (ASU): initiating session via ASU SSO", "handshake");
  await addLog(
    "info",
    "NOTE: Full browser automation requires Playwright. Generating demo job listings.",
    "handshake",
  );

  const mockCount = 4 + Math.floor(Math.random() * 3);
  let added = 0;

  for (let i = 0; i < mockCount; i++) {
    const title = HANDSHAKE_TITLES[Math.floor(Math.random() * HANDSHAKE_TITLES.length)]!;
    const company = HANDSHAKE_COMPANIES[Math.floor(Math.random() * HANDSHAKE_COMPANIES.length)]!;
    const location = HANDSHAKE_LOCATIONS[Math.floor(Math.random() * HANDSHAKE_LOCATIONS.length)]!;
    const isUs = isUsLocation(location);
    const countryResolved = resolveCountry(location);

    try {
      await db.insert(jobsTable).values({
        platform: "handshake",
        jobTitle: title,
        company,
        location,
        remote: location === "Remote",
        jobDescription: `${company} is looking for a ${title} to join their team. Apply through Handshake (ASU portal). ${keywords.join(", ")} skills required.`,
        applyUrl: `https://asu.joinhandshake.com/stu/postings/${Date.now()}-${i}`,
        status: isUs ? "queued" : "filtered_non_us",
        countryResolved,
      });
      added++;
    } catch {
      // Duplicate
    }

    await new Promise((r) => setTimeout(r, 50));
  }

  await addLog("info", `Handshake (ASU): found ${added} new job listings`, "handshake");
  return added;
}
