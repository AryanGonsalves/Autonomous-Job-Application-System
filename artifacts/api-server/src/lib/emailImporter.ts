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
  confirmed: number;
  details: Array<{ company: string; oldStatus: string; newStatus: string }>;
  confirmations: Array<{ company: string; jobTitle: string; emailDate: string }>;
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

function buildImapClient(host: string, email: string, password: string): ImapFlow {
  const client = new ImapFlow({
    host,
    port: 993,
    secure: true,
    auth: { user: email, pass: password },
    logger: false,
    // Prevent connection from hanging indefinitely
    socketTimeout: 30000,
    greetingTimeout: 15000,
    // Don't hold an IDLE channel — Yahoo aggressively drops idle sockets,
    // which surfaced as "Connection not available" on the next command.
    disableAutoIdle: true,
    // Keep-alive to stop Yahoo from dropping idle connections
    tls: { rejectUnauthorized: false },
  });
  // Swallow async socket errors so a mid-stream drop can't crash the process;
  // the usability check below turns it into a clean per-account failure instead.
  client.on("error", () => { /* handled via client.usable checks */ });
  return client;
}

async function connectImap(host: string, email: string, password: string): Promise<ImapFlow> {
  // Yahoo intermittently resets the first connection; retry once on failure.
  let lastErr: unknown = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const client = buildImapClient(host, email, password);
    try {
      await Promise.race([
        client.connect(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("IMAP connect timeout after 30s")), 30000)
        ),
      ]);
      // ImapFlow can resolve connect() yet immediately mark the connection
      // unusable (Yahoo policy/auth). Verify before handing it back.
      if (!(client as unknown as { usable?: boolean }).usable) {
        throw new Error("connection closed immediately after connect (usable=false)");
      }
      return client;
    } catch (err) {
      lastErr = err;
      await safeLogout(client);
      if (attempt < 2) await new Promise((r) => setTimeout(r, 2000));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

async function safeLogout(client: ImapFlow | null): Promise<void> {
  if (!client) return;
  try { await client.logout(); } catch { /* ignore */ }
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

  const result: ImportResult = { imported: 0, updated: 0, confirmed: 0, details: [], confirmations: [] };

  // Whether to import manually-applied jobs found in the Sent folder as
  // application records. OFF by default so the bot's own applications are
  // never conflated with jobs the user applied to by hand.
  const importManualFromSent = raw.importManualFromSent === "true";

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
      appliedAt: applicationsTable.appliedAt,
      notes: applicationsTable.notes,
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

      // Fetch inbox emails for status updates (last 14 days — keeps it fast)
      const inboxEmails = await fetchRecentEmails(client, "INBOX", 14);
      await addLog("info", `Email import: fetched ${inboxEmails.length} inbox emails`, "email");

      // Part B: update statuses from existing applications
      for (const app of existingApps) {
        const companyLower = app.company.toLowerCase();

        // Use word-boundary regex so short names like "pipe" don't match
        // random occurrences of that word in unrelated email bodies.
        // For companies with < 5 chars, require the match to be in the
        // From address or Subject only — body matches are too noisy.
        const companyRegex = new RegExp(`\\b${companyLower.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
        const isShortName = companyLower.length < 5;

        const relevant = inboxEmails.filter((e) => {
          const subjectLower = e.subject.toLowerCase();
          const fromLower = e.from.toLowerCase();
          const bodySnippet = e.body.slice(0, 400).toLowerCase();

          const inSubject = companyRegex.test(subjectLower);
          const inFrom = companyRegex.test(fromLower);
          const inBody = !isShortName && companyRegex.test(bodySnippet);

          return inSubject || inFrom || inBody;
        });

        // Confirmation verification: a confirmation email that arrived at or
        // after the bot submitted this application proves the bot's apply
        // landed. Emails dated BEFORE appliedAt belong to an earlier manual
        // application for the same company and are deliberately ignored.
        const appliedAtMs = app.appliedAt ? new Date(app.appliedAt).getTime() : 0;
        const alreadyConfirmed = (app.notes ?? "").includes("[confirmed]");
        if (!alreadyConfirmed) {
          const confirmEmail = relevant.find(
            (e) =>
              isConfirmationEmail(e.subject, e.body) &&
              e.date.getTime() >= appliedAtMs - 5 * 60 * 1000 // 5-min clock skew grace
          );
          if (confirmEmail) {
            const note = `[confirmed] ${confirmEmail.date.toISOString()} — ${(
              app.notes ?? ""
            ).replace(/^\[confirmed\][^\n]*\n?/, "")}`.slice(0, 500);
            await db
              .update(applicationsTable)
              .set({ notes: note })
              .where(eq(applicationsTable.id, app.id));
            app.notes = note;
            result.confirmed++;
            result.confirmations.push({
              company: app.company,
              jobTitle: app.jobTitle,
              emailDate: confirmEmail.date.toISOString(),
            });
          }
        }

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

      // Part A: import new applications from sent folder (last 90 days).
      // Disabled by default — importing manually-applied jobs here conflates
      // the user's hand-submitted applications with the bot's. Enable only via
      // the importManualFromSent setting.
      if (!importManualFromSent) {
        await addLog(
          "info",
          "Email import: skipping Sent-folder manual import (importManualFromSent is off)",
          "email"
        );
        await safeLogout(client);
        client = null;
        await new Promise((r) => setTimeout(r, 2000));
        continue;
      }
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

      await safeLogout(client);
      client = null;
    } catch (err) {
      await addLog("error", `Email import error for ${cfg.host}: ${err}`, "email");
    } finally {
      await safeLogout(client);
      client = null;
    }
    // Brief pause between accounts to avoid rate limiting
    await new Promise(r => setTimeout(r, 2000));
  }

  await addLog(
    "info",
    `Email import complete: imported ${result.imported} new, updated ${result.updated} statuses, ${result.confirmed} confirmations matched`,
    "email"
  );
  return result;
}

/**
 * Fetch the one-time "security code" Greenhouse emails after the first submit
 * on the newer job-boards.greenhouse.io UI. Email shape (verified live):
 *   From: Greenhouse — Subject: "Security code for your application to {Company}"
 *   Body: "...paste this code into the security code field on your
 *          application: {8-char alphanumeric} After you enter the code,
 *          resubmit your application."
 * Returns the newest matching code received at/after `since`, or null.
 */
export async function fetchGreenhouseSecurityCode(
  company: string,
  since: Date
): Promise<string | null> {
  const raw = await getAllSettings();
  const configs: Array<{ host: string; email: string; password: string }> = [];
  // Yahoo first — it is the application contact address, so the code lands there.
  if (raw.imapYahooEmail && raw.imapYahooAppPassword) {
    configs.push({ host: "imap.mail.yahoo.com", email: raw.imapYahooEmail, password: raw.imapYahooAppPassword });
  }
  if (raw.imapGmailEmail && raw.imapGmailAppPassword) {
    configs.push({ host: "imap.gmail.com", email: raw.imapGmailEmail, password: raw.imapGmailAppPassword });
  }

  // IMAP SINCE is date-granular; filter precisely on parsed Date below.
  const sinceFloor = new Date(since.getTime() - 5 * 60 * 1000);
  const companyLc = (company || "").toLowerCase();
  let best: { code: string; date: Date } | null = null;

  for (const cfg of configs) {
    let client: ImapFlow | null = null;
    try {
      client = await connectImap(cfg.host, cfg.email, cfg.password);
      const lock = await client.getMailboxLock("INBOX");
      try {
        for await (const msg of client.fetch(
          { since: sinceFloor, subject: "Security code" },
          { source: true, envelope: true }
        )) {
          try {
            if (!msg.source) continue;
            const parsed = await simpleParser(msg.source as Buffer);
            const subject: string = parsed.subject || "";
            if (!/security code/i.test(subject)) continue;
            // Prefer the email for THIS company when the subject names one.
            if (companyLc && /application to/i.test(subject) && !subject.toLowerCase().includes(companyLc.slice(0, 12))) continue;
            const date: Date = parsed.date ?? new Date(0);
            if (date.getTime() < sinceFloor.getTime()) continue;
            const body: string =
              parsed.text ||
              (typeof parsed.html === "string" ? (parsed.html as string).replace(/<[^>]+>/g, " ") : "") ||
              "";
            const m =
              body.match(/security code field on your application:?\s*([A-Za-z0-9]{6,12})/i) ||
              body.match(/code\s*:?\s*([A-Za-z0-9]{6,12})\b[\s\S]{0,80}resubmit/i);
            if (!m?.[1]) continue;
            if (!best || date.getTime() > best.date.getTime()) best = { code: m[1], date };
          } catch {
            // ignore individual parse errors
          }
        }
      } finally {
        lock.release();
      }
      await safeLogout(client);
      client = null;
      if (best) break; // found in the primary mailbox — skip the second account
    } catch (err) {
      await addLog("warn", `Security-code fetch error for ${cfg.host}: ${err}`, "email");
    } finally {
      await safeLogout(client);
      client = null;
    }
  }
  return best?.code ?? null;
}
