import * as fs from "fs";
import * as path from "path";
import { db, jobsTable } from "@workspace/db";
import { addLog } from "../automationLog";
import { isUsLocation, resolveCountry, isTitleAvoided } from "../locationFilter";
import { type parseSettings } from "../settings";
import type { ScrapeResult } from "./linkedin";

interface LeverCompany {
  slug: string;
  name: string;
}

interface LeverPosting {
  id: string;
  text: string;
  categories: {
    location?: string;
    team?: string;
    commitment?: string;
  };
  descriptionPlain?: string;
  description?: string;
  applyUrl?: string;
  hostedUrl?: string;
}

const SEED_FILE = path.join(__dirname, "../data/lever_companies.json");

// Inline fallback in case the JSON file isn't accessible from the build directory
const FALLBACK_COMPANIES: LeverCompany[] = [
  { slug: "netflix", name: "Netflix" },
  { slug: "reddit", name: "Reddit" },
  { slug: "lyft", name: "Lyft" },
  { slug: "gusto", name: "Gusto" },
  { slug: "intercom", name: "Intercom" },
  { slug: "zapier", name: "Zapier" },
  { slug: "toast", name: "Toast" },
  { slug: "scale-ai", name: "Scale AI" },
  { slug: "plaid", name: "Plaid" },
  { slug: "attentive", name: "Attentive" },
  { slug: "front", name: "Front" },
  { slug: "mercury", name: "Mercury" },
  { slug: "navan", name: "Navan" },
  { slug: "benchling", name: "Benchling" },
  { slug: "verkada", name: "Verkada" },
  { slug: "rippling", name: "Rippling" },
  { slug: "carta", name: "Carta" },
  { slug: "samsara", name: "Samsara" },
  // Additional high-volume Lever companies
  { slug: "figma", name: "Figma" },
  { slug: "canva", name: "Canva" },
  { slug: "notion", name: "Notion" },
  { slug: "airtable", name: "Airtable" },
  { slug: "asana", name: "Asana" },
  { slug: "brex", name: "Brex" },
  { slug: "klaviyo", name: "Klaviyo" },
  { slug: "segment", name: "Segment" },
  { slug: "amplitude", name: "Amplitude" },
  { slug: "mixpanel", name: "Mixpanel" },
  { slug: "looker", name: "Looker" },
  { slug: "mode-analytics", name: "Mode Analytics" },
  { slug: "dbt-labs", name: "dbt Labs" },
  { slug: "fivetran", name: "Fivetran" },
  { slug: "census", name: "Census" },
  { slug: "hightouch", name: "Hightouch" },
  { slug: "workato", name: "Workato" },
  { slug: "hunter-douglas", name: "Hunter Douglas" },
  { slug: "angi", name: "Angi" },
  { slug: "thumbtack", name: "Thumbtack" },
  { slug: "faire", name: "Faire" },
  { slug: "marqeta", name: "Marqeta" },
  { slug: "chime", name: "Chime" },
  { slug: "robinhood", name: "Robinhood" },
  { slug: "coinbase", name: "Coinbase" },
  { slug: "consensys", name: "Consensys" },
  { slug: "wealthsimple", name: "Wealthsimple" },
  { slug: "checkr", name: "Checkr" },
  { slug: "benchmarks", name: "Benchmarks" },
  { slug: "gem", name: "Gem" },
  { slug: "lattice", name: "Lattice" },
  { slug: "leapsome", name: "Leapsome" },
  { slug: "betterworks", name: "BetterWorks" },
  { slug: "medallia", name: "Medallia" },
  { slug: "qualtrics", name: "Qualtrics" },
  { slug: "momentive", name: "Momentive" },
  { slug: "drift", name: "Drift" },
  { slug: "gong", name: "Gong" },
  { slug: "outreach", name: "Outreach" },
  { slug: "salesloft", name: "Salesloft" },
  { slug: "zendesk", name: "Zendesk" },
  { slug: "freshworks", name: "Freshworks" },
  { slug: "hubspot", name: "HubSpot" },
  { slug: "yelp", name: "Yelp" },
  { slug: "doordash", name: "DoorDash" },
  { slug: "instacart", name: "Instacart" },
  { slug: "grubhub", name: "Grubhub" },
  { slug: "wolt", name: "Wolt" },
  { slug: "careem", name: "Careem" },
  { slug: "veeva", name: "Veeva" },
  { slug: "palantir", name: "Palantir" },
  { slug: "c3.ai", name: "C3.ai" },
  { slug: "dataiku", name: "Dataiku" },
  { slug: "databricks", name: "Databricks" },
  { slug: "snowflake", name: "Snowflake" },
  { slug: "dremio", name: "Dremio" },
  { slug: "imply", name: "Imply" },
  { slug: "starburst", name: "Starburst" },
  { slug: "astronomer", name: "Astronomer" },
  { slug: "prefect", name: "Prefect" },
  { slug: "airbyte", name: "Airbyte" },
  { slug: "getcensus", name: "Census" },
  { slug: "anomalo", name: "Anomalo" },
  { slug: "montecarlo", name: "Monte Carlo" },
  { slug: "acceldata", name: "Acceldata" },
];

const ANALYST_KEYWORDS = [
  "analyst", "data scientist", "analytics", "business intelligence",
  "data science", "machine learning", "data engineer", "analytics engineer",
  "reporting", "insights", "business analyst", "product analyst",
  "quantitative", "statistician", "sql", "python developer",
  "bi engineer", "bi developer", "dashboard", "visualization",
  "data architect", "data modeler", "etl", "dbt", "airflow",
];

function getLeverCompanies(): LeverCompany[] {
  try {
    const data = JSON.parse(fs.readFileSync(SEED_FILE, "utf-8")) as { companies: LeverCompany[] };
    return data.companies;
  } catch {
    return FALLBACK_COMPANIES;
  }
}

export async function scrapeLever(
  settings: ReturnType<typeof parseSettings>
): Promise<ScrapeResult> {
  const companies = getLeverCompanies();
  let scraped = 0;
  let filteredNonUs = 0;

  await addLog("info", `Lever: checking ${companies.length} companies via public API`, "lever");

  for (const company of companies) {
    try {
      const url = `https://api.lever.co/v0/postings/${company.slug}?mode=json`;
      const response = await fetch(url, {
        headers: { "User-Agent": "JobBot/1.0" },
        signal: AbortSignal.timeout(8000),
      });

      if (!response.ok) continue;

      const postings = (await response.json()) as LeverPosting[];

      for (const posting of postings) {
        const titleLower = (posting.text ?? "").toLowerCase();
        const isRelevant =
          ANALYST_KEYWORDS.some((kw) => titleLower.includes(kw)) ||
          settings.keywords.some((kw) => titleLower.includes(kw.toLowerCase()));

        if (!isRelevant) continue;
        if (isTitleAvoided(posting.text ?? "", settings.avoidKeywords)) continue;

        const location = posting.categories?.location ?? "";
        const countryResolved = resolveCountry(location);
        const isUs = isUsLocation(location);
        const status = isUs ? "queued" : "filtered_non_us";
        if (!isUs) filteredNonUs++;

        // Prefer the posting's own applyUrl, otherwise construct it
        const applyUrl =
          posting.applyUrl ??
          `https://jobs.lever.co/${company.slug}/${posting.id}/apply`;

        const description =
          posting.descriptionPlain ??
          posting.description?.replace(/<[^>]+>/g, " ").trim() ??
          "";

        try {
          await db.insert(jobsTable).values({
            platform: "lever",
            jobTitle: posting.text ?? "Unknown Role",
            company: company.name,
            location: location || null,
            remote: location.toLowerCase().includes("remote"),
            jobDescription: description || null,
            applyUrl,
            status,
            countryResolved,
          });
          scraped++;
        } catch {
          // Duplicate — ignore
        }
      }
    } catch {
      // Network error — skip this company
    }

    await new Promise((r) => setTimeout(r, 200));
  }

  await addLog(
    "info",
    `Lever: added ${scraped} new jobs from ${companies.length} companies, filtered ${filteredNonUs} non-US`,
    "lever"
  );

  return { scraped, filteredNonUs };
}
