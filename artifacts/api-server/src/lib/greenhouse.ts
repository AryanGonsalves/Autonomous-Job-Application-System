import * as fs from "fs";
import * as path from "path";
import { db, jobsTable, settingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { addLog } from "./automationLog";
import { isUsLocation, resolveCountry, isTitleAvoided } from "./locationFilter";
import { getSetting } from "./settings";

export interface GreenhouseCompany {
  slug: string;
  name: string;
}

const SETTINGS_KEY = "greenhouseCompanies";

// Candidate paths for the seed file — works whether running from src or compiled dist
const SEED_FILE_CANDIDATES = [
  path.join(process.cwd(), "src/data/greenhouse_companies.json"),
  path.join(__dirname, "../data/greenhouse_companies.json"),
  path.join(__dirname, "../../src/data/greenhouse_companies.json"),
];

function loadSeedFile(): GreenhouseCompany[] {
  for (const candidate of SEED_FILE_CANDIDATES) {
    try {
      const data = JSON.parse(fs.readFileSync(candidate, "utf-8")) as { companies: GreenhouseCompany[] };
      if (Array.isArray(data.companies) && data.companies.length > 0) return data.companies;
    } catch {
      // try next candidate
    }
  }
  return [];
}

export async function getGreenhouseCompanies(): Promise<GreenhouseCompany[]> {
  // Check settings DB first (user-customized list)
  const raw = await getSetting(SETTINGS_KEY);
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as GreenhouseCompany[];
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    } catch {
      // fall through to seed file
    }
  }

  // Fall back to seed file (tries multiple paths for compiled vs dev)
  return loadSeedFile();
}

export async function saveGreenhouseCompanies(companies: GreenhouseCompany[]): Promise<void> {
  await db
    .insert(settingsTable)
    .values({ key: SETTINGS_KEY, value: JSON.stringify(companies) })
    .onConflictDoUpdate({ target: settingsTable.key, set: { value: JSON.stringify(companies) } });
}

const ANALYST_KEYWORDS = [
  "analyst", "data scientist", "analytics", "business intelligence",
  "data science", "machine learning", "data engineer", "analytics engineer",
  "reporting", "insights", "business analyst", "product analyst",
  "quantitative", "statistician", "sql", "bi engineer", "bi developer",
  "dashboard", "visualization", "data architect", "etl", "dbt",
];

export async function scrapeGreenhouseJobs(keywords: string[], avoidKeywords: string[] = []): Promise<number> {
  const companies = await getGreenhouseCompanies();
  let totalNew = 0;

  await addLog("info", `Greenhouse: checking ${companies.length} companies via public API`, "greenhouse");

  for (const company of companies) {
    try {
      const url = `https://boards-api.greenhouse.io/v1/boards/${company.slug}/jobs?content=true`;
      const response = await fetch(url, {
        headers: { "User-Agent": "JobBot/1.0" },
        signal: AbortSignal.timeout(8000),
      });

      if (!response.ok) continue;

      const data = await response.json() as { jobs?: GreenhouseJob[] };
      const jobs = data.jobs ?? [];

      for (const job of jobs) {
        // Filter for analyst/data roles
        const titleLower = (job.title ?? "").toLowerCase();
        const isRelevant = ANALYST_KEYWORDS.some((kw) => titleLower.includes(kw.toLowerCase())) ||
          keywords.some((kw) => titleLower.includes(kw.toLowerCase()));

        if (!isRelevant) continue;
        if (isTitleAvoided(job.title ?? "", avoidKeywords)) continue;

        // US location filter
        const location = job.location?.name ?? "";
        const countryResolved = resolveCountry(location);
        const isUs = isUsLocation(location);
        const status = isUs ? "queued" : "filtered_non_us";

        // Use absolute_url — the company's own careers page
        const applyUrl = job.absolute_url ?? `https://boards.greenhouse.io/${company.slug}/jobs/${job.id}`;

        try {
          await db.insert(jobsTable).values({
            platform: "greenhouse",
            jobTitle: job.title ?? "Unknown Role",
            company: company.name,
            location: location || null,
            remote: location.toLowerCase().includes("remote"),
            jobDescription: job.content ?? null,
            applyUrl,
            status,
            countryResolved,
          });
          totalNew++;
        } catch {
          // Duplicate — skip
        }
      }
    } catch (err) {
      // Network error for this company — skip
    }

    // Small delay between companies to avoid rate limiting
    await new Promise((r) => setTimeout(r, 150));
  }

  await addLog("info", `Greenhouse: added ${totalNew} new jobs from ${companies.length} companies`, "greenhouse");
  return totalNew;
}

interface GreenhouseJob {
  id: number;
  title: string;
  absolute_url: string;
  location: { name: string };
  content: string;
  updated_at: string;
}
