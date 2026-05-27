import { ImapFlow } from "imapflow";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const mailparser = require("mailparser") as { simpleParser: (source: Buffer) => Promise<Record<string, any>> };
const simpleParser = mailparser.simpleParser;
import { db, applicationsTable, jobsTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { addLog } from "./automationLog";
import { getAllSettings } from "./settings";
import { getOpenAIClient } from "./aiClient";

export interface ImportResult {
  imported: number;
  updated: number;
  details: Array<{ company: string; oldStatus: string; newStatus: string }>;
}

const STATUS_PRIORITY: Record<string, number> = {
  applied: 1,
  rejected: 0,
  interview: 2,
  offer: 3,
};

// Keywords that suggest a job application confirmation email
const CONFIRMATION_SUBJECTS = [
  "application received",
  "thank you for applying",
  "thank you for your application",
  "we received your application",
  "application submitted",
  "successfully applied",
  "application confirmation",
  "your application to",
  "applied to",
];

async function classifyStatus(
  subject: string,
  body: string,
  company: string
): Promise<"rejected" | "interview" | "offer" | null> {
  const ai = await getOpenAIClient();
  if (!ai) return null;

  try {
    const response = await ai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "user",
          content: `Classify this email related to a job application at ${company}.
Subject: "${subject}"
Body (first 600 chars): "${body.slice(0, 600)}"

Reply with exactly one word:
- "rejected" if they're declining/rejecting the application
- "interview" if they want to schedule an interview or phone screen
- "offer" if they're offering a job
- "unknown" if it's a confirmation, update, or unclear

Reply with only one word.`,
        },
      ],
      max_tokens: 10,
    });

    const word = response.choices[0]?.message?.content?.trim().toLowerCase();
    if (word === "rejected" || word === "interview" || word === "offer") {
      return word;
    }
    return null;
  } catch {
    return null;
  }
}

function isConfirmationEmail(subject: string, body: string): boolean {
  const subjectLower = subject.toLowerCase();
  const bodyLower = body.slice(0, 300).toLowerCase();
  return CONFIRMATION_SUBJECTS.some(
    (kw) => subjectLower.includes(kw) || bodyLower.includes(kw)
  );
}

function extractCompanyFromSubject(subject: string): string | null {
  // "Thank you for applying to Stripe" → "Stripe"
  // "Your application to Google has been received" → "Google"
  const patterns = [
    /(?:applying to|applied to|application to|application at|at )\s+([A-Z][A-Za-z0-9\s&.,'-]+?)(?:\s*[–\-!,.]|$)/,
  ];
  for (const pattern of patterns) {
    const match = subject.match(pattern);
    if (match?.[1]) return match[1].trim();
  }
  return null;
}

async function connectImap(host: string, email: string, password: string): Promise<ImapFlow> {
  const client = new ImapFlow({
    host,
    port: 993,
    secure: true,
    auth: { user: email, pass: password },
    logger: false,
  });
  await client.connect();
  return client;
}

interface ParsedEmail {
  subject: string;
  body: string;
  from: string;
  date: Date;
}

async function fetchRecentEmails(client: ImapFlow, mailbox: string, daysBack = 90): Promise<ParsedEmail[]> {
  const emails: ParsedEmail[] = [];
  const since = new Date();
  since.setDate(since.getDate() - daysBack);

  const lock = await client.getMailboxLock(mailbox);
  try {
    for await (const msg of client.fetch({ since }, { source: true, envelope: true })) {
      try {
        if (!msg.source) continue;
        const parsed = await simpleParser(msg.source as Buffer);
        emails.push({
          subject: parsed.subject || "",
          body: parsed.text || (typeof parsed.html === "string" ? (parsed.html as string).replace(/<[^>]+>/g, " ") : "") || "",
          from: parsed.from?.text || "",
          date: parsed.date ?? new Date(),
        });
      } catch {
        // ignore individual parse errors
      }
    }
  } finally {
    lock.release();
  }
  return emails;
}

export async function runEmailImport(): Promise<ImportResult> {
  const raw = await getAllSettings();
  const configs: Array<{ host: string; email: string; password: string }> = [];

  if (raw.imapGmailEmail && raw.imapGmailAppPassword) {
    configs.push({ host: "imap.gmail.com", email: raw.imapGmailEmail, password: raw.imapGmailAppPassword });
  }
  if (raw.imapYahooEmail && raw.imapYahooAppPassword) {
    configs.push({ host: "imap.mail.yahoo.com", email: raw.imapYahooEmail, password: raw.imapYahooAppPassword });
  }

  const result: ImportResult = { imported: 0, updated: 0, details: [] };

  if (configs.length === 0) {
    await addLog("warn", "Email import: no IMAP credentials configured — skipping", "email");
    return result;
  }

  // Load all existing applications with job data
  const existingApps = await db
    .select({
      id: applicationsTable.id,
      jobId: applicationsTable.jobId,
      status: applicationsTable.status,
      company: jobsTable.company,
      jobTitle: jobsTable.jobTitle,
      applyUrl: jobsTable.applyUrl,
    })
    .from(applicationsTable)
    .innerJoin(jobsTable, eq(applicationsTable.jobId, jobsTable.id));

  const existingApplyUrls = new Set(existingApps.map((a) => a.applyUrl));

  for (const cfg of configs) {
    let client: ImapFlow | null = null;
    try {
      await addLog("info", `Email import: connecting to ${cfg.host}`, "email");
      client = await connectImap(cfg.host, cfg.email, cfg.password);

      // Fetch inbox emails for status updates (last 30 days)
      const inboxEmails = await fetchRecentEmails(client, "INBOX", 30);
      await addLog("info", `Email import: fetched ${inboxEmails.length} inbox emails`, "email");

      // Part B: update statuses from existing applications
      for (const app of existingApps) {
        const companyLower = app.company.toLowerCase();

        const relevant = inboxEmails.filter((e) => {
          const subjectLower = e.subject.toLowerCase();
          const fromLower = e.from.toLowerCase();
          const bodySnippet = e.body.slice(0, 400).toLowerCase();
          return (
            subjectLower.includes(companyLower) ||
            fromLower.includes(companyLower) ||
            bodySnippet.includes(companyLower)
          );
        });

        for (const email of relevant) {
          const newStatus = await classifyStatus(email.subject, email.body, app.company);
          if (!newStatus) continue;

          const currentPriority = STATUS_PRIORITY[app.status] ?? 1;
          const newPriority = STATUS_PRIORITY[newStatus] ?? 0;

          if (newPriority > currentPriority) {
            await db
              .update(applicationsTable)
              .set({ status: newStatus })
              .where(eq(applicationsTable.id, app.id));

            result.updated++;
            result.details.push({
              company: app.company,
              oldStatus: app.status,
              newStatus,
            });

            // Update the local copy so we don't double-process
            app.status = newStatus as typeof app.status;

            await addLog(
              "info",
              `Email import: ${app.company} (${app.jobTitle}) — ${newStatus}`,
              "email"
            );
            break;
          }
        }
      }

      // Part A: import new applications from sent folder (last 90 days)
      const sentFolders = ["[Gmail]/Sent Mail", "Sent", "Sent Items", "INBOX.Sent"];
      let sentEmails: ParsedEmail[] = [];
      for (const folder of sentFolders) {
        try {
          sentEmails = await fetchRecentEmails(client, folder, 90);
          if (sentEmails.length > 0) break;
        } catch {
          // try next folder name
        }
      }
      await addLog("info", `Email import: fetched ${sentEmails.length} sent emails for import scan`, "email");

      for (const email of sentEmails) {
        if (!isConfirmationEmail(email.subject, email.body)) continue;

        const company = extractCompanyFromSubject(email.subject) || "Unknown Company";
        const syntheticUrl = `email-import://${company.toLowerCase().replace(/\s+/g, "-")}/${email.date.getTime()}`;

        if (existingApplyUrls.has(syntheticUrl)) continue;

        try {
          // Insert a job record for the manually-applied job
          const [job] = await db
            .insert(jobsTable)
            .values({
              platform: "manual",
              jobTitle: email.subject.slice(0, 120),
              company,
              applyUrl: syntheticUrl,
              status: "applied",
            })
            .returning();

          if (job) {
            await db.insert(applicationsTable).values({
              jobId: job.id,
              status: "applied",
              source: "imported",
              appliedAt: email.date,
            });
            existingApplyUrls.add(syntheticUrl);
            result.imported++;
          }
        } catch {
          // duplicate or insert error — skip
        }
      }

      await client.logout();
      client = null;
    } catch (err) {
      await addLog("error", `Email import error for ${cfg.host}: ${err}`, "email");
    } finally {
      if (client) {
        try {
          await client.logout();
        } catch {
          // ignore logout errors
        }
      }
    }
  }

  await addLog(
    "info",
    `Email import complete: imported ${result.imported} new, updated ${result.updated} statuses`,
    "email"
  );
  return result;
}
