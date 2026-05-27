import { logger } from "./logger";
import { addLog } from "./automationLog";
import { parseSettings, getAllSettings, setSetting } from "./settings";
import { db, jobsTable, applicationsTable, runHistoryTable, resumeTable } from "@workspace/db";
import { eq, gte, count, desc, and, isNull } from "drizzle-orm";
import { scrapeGreenhouseJobs } from "./greenhouse";
import { scrapeLinkedIn } from "./scrapers/linkedin";
import { scrapeIndeed } from "./scrapers/indeed";
import { scrapeLever } from "./scrapers/lever";
import { scrapeHandshakeJobs } from "./scrapers/handshake";
import { generateCoverLetter } from "./aiClient";
import { submitApplication } from "./submitter";
import { runEmailImport } from "./emailImporter";
import type { ParsedResume } from "./resumeParser";

export interface SchedulerState {
  running: boolean;
  scheduledTime: string | null;
  lastRun: string | null;
  nextRun: string | null;
  currentPhase: string | null;
  applicationsToday: number;
  cronJobs: ReturnType<typeof setTimeout>[];
  isRunningPipeline: boolean;
  currentRunStartedAt: string | null;
  slots: string[];
  stopRequested: boolean;
}

const state: SchedulerState = {
  running: false,
  scheduledTime: null,
  lastRun: null,
  nextRun: null,
  currentPhase: null,
  applicationsToday: 0,
  cronJobs: [],
  isRunningPipeline: false,
  currentRunStartedAt: null,
  slots: [],
  stopRequested: false,
};

function computeNextRunMs(timeStr: string): { next: Date; ms: number } {
  const [hours, minutes] = timeStr.split(":").map(Number);
  const now = new Date();
  const next = new Date();
  next.setHours(hours!, minutes!, 0, 0);
  if (next <= now) {
    next.setDate(next.getDate() + 1);
  }
  return { next, ms: next.getTime() - now.getTime() };
}

function getEarliestNextRun(slots: string[]): Date | null {
  if (!slots.length) return null;
  const candidates = slots.map((s) => computeNextRunMs(s).next);
  return candidates.reduce((a, b) => (a < b ? a : b));
}

export function getSchedulerState() {
  const nextRun = state.nextRun ? new Date(state.nextRun) : null;
  const nextRunIn = nextRun ? Math.max(0, Math.floor((nextRun.getTime() - Date.now()) / 1000)) : null;
  return {
    running: state.running,
    scheduledTime: state.scheduledTime,
    lastRun: state.lastRun,
    nextRun: state.nextRun,
    nextRunIn,
    currentPhase: state.currentPhase,
    applicationsToday: state.applicationsToday,
    slots: state.slots,
    currentRunStartedAt: state.currentRunStartedAt,
  };
}

function clearAllCronJobs(): void {
  for (const job of state.cronJobs) clearTimeout(job);
  state.cronJobs = [];
}

function scheduleSlots(slots: string[]): void {
  clearAllCronJobs();
  if (!slots.length) return;

  state.slots = slots;

  for (const slot of slots) {
    const { next, ms } = computeNextRunMs(slot);
    const tid = setTimeout(async () => {
      if (!state.running) return;
      await runPipeline("scheduled");
      // Re-schedule this slot for tomorrow
      if (state.running) {
        scheduleSlots(state.slots);
      }
    }, ms);
    state.cronJobs.push(tid);
    logger.info({ slot, next: next.toISOString() }, "Scheduled slot");
  }

  const earliest = getEarliestNextRun(slots);
  state.nextRun = earliest?.toISOString() ?? null;
}

export async function startScheduler(): Promise<void> {
  if (state.running) return;

  const raw = await getAllSettings();
  const settings = parseSettings(raw);

  const activeSlots: string[] = [settings.schedulerSlot1];
  if (settings.schedulerSlot2) activeSlots.push(settings.schedulerSlot2);
  if (settings.schedulerSlot3) activeSlots.push(settings.schedulerSlot3);

  state.running = true;
  state.scheduledTime = activeSlots[0]!;
  state.stopRequested = false;

  scheduleSlots(activeSlots);

  await addLog("info", `Scheduler started. Slots: ${activeSlots.join(", ")}`);
  logger.info({ activeSlots }, "Scheduler started");
}

export async function stopScheduler(): Promise<void> {
  state.running = false;
  state.stopRequested = true;
  state.currentPhase = null;
  clearAllCronJobs();
  state.nextRun = null;
  await addLog("info", "Scheduler stopped");
  logger.info("Scheduler stopped");
}

export async function requestStopCurrentRun(): Promise<void> {
  state.stopRequested = true;
  await addLog("info", "Stop requested — will halt after current step completes");
}

export async function updateSchedulerSlots(slots: string[]): Promise<void> {
  const cleaned = slots.filter(Boolean).slice(0, 3);
  await setSetting("schedulerSlot1", cleaned[0] ?? "08:00");
  await setSetting("schedulerSlot2", cleaned[1] ?? "");
  await setSetting("schedulerSlot3", cleaned[2] ?? "");

  if (state.running) {
    scheduleSlots(cleaned);
    await addLog("info", `Scheduler slots updated to: ${cleaned.join(", ")}`);
  }
}

export async function getRunHistory(limit = 30) {
  return db
    .select()
    .from(runHistoryTable)
    .orderBy(desc(runHistoryTable.startedAt))
    .limit(limit);
}

export async function runPipeline(triggeredBy: "scheduled" | "manual" = "manual"): Promise<void> {
  if (state.isRunningPipeline) {
    await addLog("warn", "Pipeline already running, skipping this trigger");
    return;
  }

  const pipelineStart = Date.now();
  state.isRunningPipeline = true;
  state.stopRequested = false;
  state.lastRun = new Date().toISOString();
  state.currentRunStartedAt = state.lastRun;

  let jobsScraped = 0;
  let jobsApplied = 0;
  let jobsFailed = 0;
  let jobsFilteredNonUs = 0;

  // Create a run history record
  const [runRecord] = await db.insert(runHistoryTable).values({
    triggeredBy,
    startedAt: new Date(),   // explicit — avoids defaultNow() storing ms instead of seconds
    jobsScraped: 0,
    jobsApplied: 0,
    jobsFailed: 0,
    jobsFilteredNonUs: 0,
  }).returning();

  const runId = runRecord?.id;

  try {
    const settings = parseSettings(await getAllSettings());

    await addLog("info", `=== Automation pipeline started (${triggeredBy}) ===`);

    // Phase 1: Scrape
    state.currentPhase = "scraping";
    await addLog("info", "Phase 1: Scraping jobs from enabled platforms");

    if (settings.enableLinkedin && !state.stopRequested) {
      try {
        const c = await scrapeLinkedIn(settings);
        jobsScraped += c.scraped;
        jobsFilteredNonUs += c.filteredNonUs;
      } catch (err) {
        await addLog("error", `LinkedIn scraper failed: ${err}`, "linkedin");
      }
    }
    if (settings.enableIndeed && !state.stopRequested) {
      try {
        const c = await scrapeIndeed(settings);
        jobsScraped += c.scraped;
        jobsFilteredNonUs += c.filteredNonUs;
      } catch (err) {
        await addLog("error", `Indeed scraper failed: ${err}`, "indeed");
      }
    }
    if (settings.enableGreenhouse && !state.stopRequested) {
      try {
        const c = await scrapeGreenhouseJobs(settings.keywords, settings.avoidKeywords);
        jobsScraped += c;
      } catch (err) {
        await addLog("error", `Greenhouse scraper failed: ${err}`, "greenhouse");
      }
    }
    if (settings.enableLever && !state.stopRequested) {
      try {
        const c = await scrapeLever(settings);
        jobsScraped += c.scraped;
        jobsFilteredNonUs += c.filteredNonUs;
      } catch (err) {
        await addLog("error", `Lever scraper failed: ${err}`, "lever");
      }
    }
    if (settings.enableHandshake && !state.stopRequested) {
      try {
        const c = await scrapeHandshakeJobs(
          settings.keywords,
          settings.handshakeAsuEmail,
          settings.handshakeAsuPassword,
          settings.avoidKeywords
        );
        jobsScraped += c.scraped;
        jobsFilteredNonUs += c.filteredNonUs;
      } catch (err) {
        await addLog("error", `Handshake scraper failed: ${err}`, "handshake");
      }
    }

    if (state.stopRequested) {
      await addLog("warn", "Stop requested — pipeline halted after scraping phase");
    } else {
      await addLog(
        "info",
        `Scraped ${jobsScraped} new jobs across all platforms. Filtered ${jobsFilteredNonUs} non-US jobs.`
      );

      // Phase 2: Generate cover letters for queued jobs without one
      state.currentPhase = "generating";
      await addLog("info", "Phase 2: Generating AI cover letters for queued jobs");

      const [latestResume] = await db
        .select()
        .from(resumeTable)
        .orderBy(desc(resumeTable.uploadedAt))
        .limit(1);

      const queuedForCoverLetter = await db
        .select()
        .from(jobsTable)
        .where(and(eq(jobsTable.status, "queued"), isNull(jobsTable.coverLetterText)))
        .limit(settings.dailyLimit);

      if (latestResume && settings.openaiApiKey) {
        const resumeJson = latestResume.parsedJson as Record<string, unknown>;
        for (const job of queuedForCoverLetter) {
          if (state.stopRequested) break;
          try {
            await generateCoverLetter(
              job.id,
              resumeJson,
              job.jobDescription ?? "",
              job.jobTitle,
              job.company
            );
          } catch (err) {
            await addLog("warn", `Cover letter generation failed for job ${job.id}: ${err}`);
          }
        }
        await addLog("info", `Generated cover letters for up to ${queuedForCoverLetter.length} jobs`);
      } else if (!settings.openaiApiKey) {
        await addLog("warn", "OpenAI API key not configured — skipping cover letter generation");
      }

      // Phase 3: Submit applications
      state.currentPhase = "applying";
      await addLog("info", `Phase 3: Submitting applications (daily limit: ${settings.dailyLimit})`);

      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);

      const [todayCount] = await db
        .select({ count: count() })
        .from(applicationsTable)
        .where(gte(applicationsTable.appliedAt, todayStart));

      const appliedToday = todayCount?.count ?? 0;
      state.applicationsToday = appliedToday;

      if (appliedToday >= settings.dailyLimit) {
        await addLog("info", `Daily limit of ${settings.dailyLimit} reached. Stopping.`);
      } else {
        const remaining = settings.dailyLimit - appliedToday;
        await addLog("info", `Can apply to ${remaining} more jobs today`);

        const jobsToApply = await db
          .select()
          .from(jobsTable)
          .where(eq(jobsTable.status, "queued"))
          .limit(remaining);

        const resume = latestResume
          ? (latestResume.parsedJson as unknown as ParsedResume)
          : null;

        if (!resume) {
          await addLog("warn", "No resume uploaded — skipping application submission");
        } else {
          for (const job of jobsToApply) {
            if (state.stopRequested) break;

            try {
              // Hard 4-minute timeout per job — prevents Playwright CDP hangs from
              // blocking the entire pipeline when a browser page freezes.
              await Promise.race([
                submitApplication(job, resume),
                new Promise<never>((_, reject) =>
                  setTimeout(
                    () => reject(new Error(`JOB_TIMEOUT: submission exceeded 4 minutes (${job.jobTitle} @ ${job.company})`)),
                    4 * 60 * 1000
                  )
                ),
              ]);
              await db
                .update(jobsTable)
                .set({ status: "applied" })
                .where(eq(jobsTable.id, job.id));
              await db.insert(applicationsTable).values({
                jobId: job.id,
                status: "applied",
                coverLetterText: job.coverLetterText,
              });
              jobsApplied++;
            } catch (err) {
              const errMsg = err instanceof Error ? err.message : String(err);
              // Session-expired or platform-blocked errors are retryable — mark skipped not failed
              const isRetryable =
                errMsg.includes("SESSION_EXPIRED") ||
                errMsg.includes("Easy Apply button not found") ||
                errMsg.includes("authwall") ||
                errMsg.includes("ERR_ABORTED") ||
                errMsg.includes("Target closed") ||
                errMsg.includes("JOB_TIMEOUT");
              await db
                .update(jobsTable)
                .set({ status: isRetryable ? "skipped" : "failed" })
                .where(eq(jobsTable.id, job.id));
              if (isRetryable) {
                await addLog(
                  "warn",
                  `Skipped (retryable) job ${job.id} (${job.jobTitle} @ ${job.company}): ${errMsg}`,
                  job.platform
                );
              } else {
                jobsFailed++;
                await addLog(
                  "error",
                  `Application failed for job ${job.id} (${job.jobTitle} @ ${job.company}): ${errMsg}`,
                  job.platform
                );
              }
            }

            // Randomized rate-limit delay between applications
            const delay = 3000 + Math.random() * 9000;
            await new Promise((r) => setTimeout(r, delay));
          }

          await addLog(
            "info",
            `Phase 3 complete: submitted ${jobsApplied} applications, ${jobsFailed} failed`
          );
        }
      }
    }

    // Phase 4: Email status sync
    if (!state.stopRequested) {
      state.currentPhase = "email-sync";
      await addLog("info", "Phase 4: Syncing application statuses from email");
      try {
        const emailResult = await runEmailImport();
        if (emailResult.updated > 0 || emailResult.imported > 0) {
          await addLog(
            "info",
            `Email sync: imported ${emailResult.imported} new, updated ${emailResult.updated} statuses`
          );
        }
      } catch (err) {
        await addLog("warn", `Email sync failed (non-critical): ${err}`);
      }
    }

    state.currentPhase = "complete";
    await addLog("info", "=== Pipeline complete ===");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await addLog("error", `Pipeline error: ${message}`);
    logger.error({ err }, "Pipeline error");
    jobsFailed++;
  } finally {
    const durationMs = Date.now() - pipelineStart;
    state.isRunningPipeline = false;
    state.currentPhase = null;
    state.currentRunStartedAt = null;
    state.stopRequested = false;

    // Update run history record
    if (runId) {
      await db
        .update(runHistoryTable)
        .set({
          finishedAt: new Date(),
          jobsScraped,
          jobsApplied,
          jobsFailed,
          jobsFilteredNonUs,
          durationMs,
        })
        .where(eq(runHistoryTable.id, runId));
    }
  }
}

