import OpenAI from "openai";
import { getSetting } from "./settings";
import { db, jobsTable, questionsBankTable } from "@workspace/db";
import { eq, like, desc } from "drizzle-orm";
import { addLog } from "./automationLog";
import type { ParsedResume } from "./resumeParser";

export async function getOpenAIClient(): Promise<OpenAI | null> {
  const key = await getSetting("openaiApiKey");
  if (!key) return null;
  return new OpenAI({ apiKey: key });
}

export async function generateCoverLetter(
  jobId: number,
  resumeJson: Record<string, unknown>,
  jobDescription: string,
  jobTitle: string,
  company: string
): Promise<string> {
  // Check if we already have a cached cover letter
  const [job] = await db.select().from(jobsTable).where(eq(jobsTable.id, jobId));
  if (job?.coverLetterText) {
    return job.coverLetterText;
  }

  const ai = await getOpenAIClient();
  if (!ai) {
    throw new Error("OpenAI API key not configured. Please add it in Settings.");
  }

  await addLog("info", `Generating cover letter for ${jobTitle} at ${company}`);

  const resumeText = JSON.stringify(resumeJson, null, 2);

  const response = await ai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      {
        role: "system",
        content:
          "You are a professional career coach writing cover letters for a data analyst / data scientist candidate. Write concise, compelling cover letter bodies — no address blocks, no placeholders, no sign-offs. Output only the paragraphs themselves, starting with the salutation.",
      },
      {
        role: "user",
        content: `Write a 3-paragraph cover letter body (under 300 words) for this position.

Job Title: ${jobTitle}
Company: ${company}
Job Description:
${jobDescription}

Candidate Resume:
${resumeText}

Rules:
- Output ONLY the letter body — start directly with "Dear Hiring Manager," or "Dear [Team] Team,"
- Do NOT include any address block, date, sender address, or placeholder text like [Your Address], [City], [Email], [Phone], [Date]
- Do NOT include a sign-off or signature line
- Paragraph 1: Strong opening hook that mentions the role and shows genuine interest
- Paragraph 2: 2-3 specific achievements from the resume matched to JD keywords
- Paragraph 3: Closing sentence expressing enthusiasm to discuss further
- Under 300 words. Be specific, not generic. No fluff. No placeholders.`,
      },
    ],
    max_tokens: 600,
    temperature: 0.7,
  });

  const coverLetter = response.choices[0]?.message?.content ?? "";

  // Cache the cover letter on the job
  await db.update(jobsTable).set({ coverLetterText: coverLetter }).where(eq(jobsTable.id, jobId));

  return coverLetter;
}

// ─── Question Bank helpers ────────────────────────────────────────────────────

/** Normalise a question for fuzzy matching: lowercase, strip punctuation, collapse whitespace. */
function normaliseQuestion(q: string): string {
  return q.toLowerCase().replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, " ").trim();
}

/**
 * Look up a previously-saved answer for this question.
 * Uses exact normalised match first, then prefix match (first 60 chars).
 */
async function lookupSavedAnswer(question: string): Promise<string | null> {
  const norm = normaliseQuestion(question);

  // Exact normalised match
  const [exact] = await db
    .select()
    .from(questionsBankTable)
    .where(eq(questionsBankTable.questionNorm, norm))
    .limit(1);
  if (exact?.answer && !exact.needsReview) return exact.answer;

  // Prefix match (first 60 chars) — handles minor wording differences
  const prefix = norm.slice(0, 60);
  if (prefix.length > 20) {
    const [fuzzy] = await db
      .select()
      .from(questionsBankTable)
      .where(like(questionsBankTable.questionNorm, `${prefix}%`))
      .limit(1);
    if (fuzzy?.answer && !fuzzy.needsReview) return fuzzy.answer;
  }

  return null;
}

/**
 * Save a question to the bank. If a record with the same normalised question
 * already exists, update it (avoid duplicates). If answer is null, mark it
 * as needsReview so the user is prompted to provide an answer.
 */
async function saveToQuestionBank(opts: {
  question: string;
  answer: string | null;
  source: "resume" | "ai" | "user" | "saved";
  confidence: number;
  jobId?: number;
  company?: string;
  jobTitle?: string;
  platform?: string;
}): Promise<void> {
  const norm = normaliseQuestion(opts.question);
  const needsReview = opts.answer === null || opts.confidence < 0.6;

  try {
    // Check if already exists
    const [existing] = await db
      .select()
      .from(questionsBankTable)
      .where(eq(questionsBankTable.questionNorm, norm))
      .limit(1);

    if (existing) {
      // Only overwrite if we have a better answer
      if (opts.answer && (existing.needsReview || opts.confidence > (existing.confidence ?? 0))) {
        await db
          .update(questionsBankTable)
          .set({
            answer: opts.answer,
            source: opts.source,
            confidence: opts.confidence,
            needsReview,
            updatedAt: new Date(),
          })
          .where(eq(questionsBankTable.id, existing.id));
      }
    } else {
      await db.insert(questionsBankTable).values({
        question: opts.question.slice(0, 500),
        questionNorm: norm.slice(0, 500),
        answer: opts.answer,
        source: opts.source,
        confidence: opts.confidence,
        needsReview,
        jobId: opts.jobId,
        company: opts.company,
        jobTitle: opts.jobTitle,
        platform: opts.platform,
      });
    }
  } catch {
    // Non-critical — ignore DB errors here
  }
}

/**
 * Try to infer an answer directly from the resume JSON without calling AI.
 * Returns the answer + confidence (0–1), or null if not inferable.
 *
 * Handles common ATS question patterns:
 *   - Years of experience ("how many years of X experience")
 *   - Authorisation ("authorized to work", "require sponsorship")
 *   - Education level ("bachelor's", "master's")
 *   - Skill presence ("experience with X")
 */
function inferFromResume(
  question: string,
  resume: ParsedResume
): { answer: string; confidence: number } | null {
  const q = question.toLowerCase();
  const resumeText = JSON.stringify(resume).toLowerCase();

  // ── Profile facts (authoritative) ──────────────────────────────────────────
  // Aryan Gonsalves — F-1 student, currently work-authorized on OPT/STEM-OPT, but
  // WILL require visa sponsorship (H-1B) in the future. These deterministic answers
  // stop the AI from guessing on high-stakes legal/EEO questions (the AI previously
  // answered "No" to future-sponsorship, which is incorrect and risky).
  // NOTE: for the multi-user cloud version, replace these constants with a per-user
  // profile object loaded from settings/DB.

  // Authorized to work NOW (on OPT) — but NOT "without sponsorship".
  if (
    (q.includes("authorized to work") || q.includes("authorised to work") ||
      q.includes("legally authorized") || q.includes("legally allowed to work") ||
      q.includes("eligible to work") || q.includes("work in the united states")) &&
    !q.includes("without") && !q.includes("sponsorship")
  ) {
    return { answer: "Yes", confidence: 0.97 };
  }
  // "Authorized to work WITHOUT sponsorship / restriction" → No (needs future sponsorship).
  if (
    (q.includes("authorized to work") || q.includes("authorised to work") || q.includes("work in the u")) &&
    (q.includes("without sponsorship") || q.includes("without restriction") ||
      q.includes("without requiring") || q.includes("without need") || q.includes("on an ongoing basis"))
  ) {
    return { answer: "No. Authorized now on F-1 OPT, but will require visa sponsorship in the future.", confidence: 0.95 };
  }
  // Any sponsorship / visa question (now or in the future) → Yes.
  if (q.includes("sponsor") || q.includes("visa") || q.includes("work permit")) {
    return { answer: "Yes", confidence: 0.95 };
  }
  // US citizen / permanent resident / green card → No (international student).
  if (
    q.includes("u.s. citizen") || q.includes("us citizen") || q.includes("u.s citizen") ||
    q.includes("citizen of the united states") || q.includes("permanent resident") || q.includes("green card")
  ) {
    return { answer: "No", confidence: 0.95 };
  }
  // Security clearance → No.
  if (q.includes("security clearance") || q.includes("clearance level") || q.includes("active clearance")) {
    return { answer: "No", confidence: 0.9 };
  }
  // Age 18+ → Yes.
  if (q.includes("at least 18") || q.includes("18 years") || q.includes("over 18") || q.includes("of legal working age")) {
    return { answer: "Yes", confidence: 0.97 };
  }
  // Felony / criminal background → No.
  if (q.includes("felony") || q.includes("convicted") || q.includes("criminal record") || q.includes("criminal history")) {
    return { answer: "No", confidence: 0.9 };
  }
  // Willing to complete a background check / drug screen → Yes.
  if (q.includes("background check") || q.includes("drug screen") || q.includes("drug test")) {
    return { answer: "Yes", confidence: 0.9 };
  }
  // EEO / voluntary self-identification → decline, NEVER fabricate.
  if (/\b(gender|race|ethnicity|hispanic or latino|are you hispanic|veteran status|protected veteran|self-identif|self identif|disability status|do you have a disability)\b/.test(q)) {
    return { answer: "I prefer not to disclose", confidence: 0.9 };
  }
  // GPA.
  if (q.includes("gpa") || q.includes("grade point")) {
    return { answer: "3.8", confidence: 0.95 };
  }

  // ── Degree / education ─────────────────────────────────────────────────────
  if (q.includes("bachelor") || q.includes("bs degree") || q.includes("undergraduate degree")) {
    const hasBachelor =
      resumeText.includes("bachelor") ||
      resumeText.includes(" b.s.") ||
      resumeText.includes(" b.a.") ||
      resumeText.includes("bachelor of");
    if (hasBachelor) return { answer: "Yes", confidence: 0.92 };
  }
  if (q.includes("master") || q.includes("graduate degree") || q.includes("ms degree") || q.includes("mba")) {
    const hasMaster =
      resumeText.includes("master") ||
      resumeText.includes(" m.s.") ||
      resumeText.includes(" m.b.a.") ||
      resumeText.includes("master of");
    if (hasMaster) return { answer: "Yes", confidence: 0.92 };
  }

  // ── Years of experience ────────────────────────────────────────────────────
  const yearsMatch = q.match(/(\d+)\+?\s*years?\s+(?:of\s+)?(?:experience\s+)?(?:with\s+)?([a-z\s]+?)(?:\?|$|experience)/);
  if (yearsMatch) {
    const required = parseInt(yearsMatch[1] ?? "0", 10);
    const skill = (yearsMatch[2] ?? "").trim();
    // Rough heuristic: if skill mentioned in resume, assume qualification
    if (skill && resumeText.includes(skill.slice(0, 6))) {
      // Check if resume mentions years of experience
      const expMatch = resumeText.match(/(\d+)\+?\s*years?\s+(?:of\s+)?experience/);
      const resumeYears = expMatch ? parseInt(expMatch[1] ?? "0", 10) : 2;
      if (resumeYears >= required) {
        return { answer: "Yes", confidence: 0.75 };
      }
    }
  }

  // ── Skill presence ─────────────────────────────────────────────────────────
  const skillPatterns = [
    /experience (?:with|using|in) ([a-z\s]+?)(?:\?|$)/,
    /proficient (?:with|in) ([a-z\s]+?)(?:\?|$)/,
    /knowledge of ([a-z\s]+?)(?:\?|$)/,
    /familiar with ([a-z\s]+?)(?:\?|$)/,
  ];
  for (const pat of skillPatterns) {
    const m = q.match(pat);
    if (m?.[1]) {
      const skill = m[1].trim().slice(0, 20);
      if (skill.length > 2 && resumeText.includes(skill)) {
        return { answer: "Yes", confidence: 0.7 };
      }
    }
  }

  // ── Remote / hybrid ────────────────────────────────────────────────────────
  if (q.includes("open to remote") || q.includes("work remotely") || q.includes("remote work")) {
    return { answer: "Yes", confidence: 0.95 };
  }
  if (q.includes("willing to relocate") || q.includes("open to relocation")) {
    return { answer: "No", confidence: 0.7 };
  }

  return null;
}

/**
 * For Yes/No radio questions — returns true for Yes, false for No.
 * Priority: saved answer → resume inference → AI.
 * Low-confidence answers are saved to the question bank for user review.
 */
export async function generateYesNoAnswer(
  question: string,
  job: { jobTitle: string; company: string; jobDescription: string; id?: number; platform?: string },
  resume: ParsedResume
): Promise<boolean> {
  // 1. Check question bank for a saved user-verified answer
  const saved = await lookupSavedAnswer(question);
  if (saved !== null) {
    const answer = saved.toLowerCase().startsWith("y");
    return answer;
  }

  // 2. Try resume inference
  const inferred = inferFromResume(question, resume);
  if (inferred && inferred.confidence >= 0.8) {
    await saveToQuestionBank({
      question,
      answer: inferred.answer,
      source: "resume",
      confidence: inferred.confidence,
      jobId: job.id,
      company: job.company,
      jobTitle: job.jobTitle,
      platform: job.platform,
    });
    return inferred.answer.toLowerCase().startsWith("y");
  }

  // 3. AI fallback
  const ai = await getOpenAIClient();
  if (!ai) {
    // No AI key — use resume inference result if any, else conservative Yes
    if (inferred) return inferred.answer.toLowerCase().startsWith("y");
    return true;
  }

  const resumeText = JSON.stringify(resume, null, 2);

  const response = await ai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      {
        role: "system",
        content:
          "You are evaluating whether a job applicant honestly qualifies to answer 'Yes' to a screening question. " +
          "Be accurate — do not say Yes if the candidate clearly does not meet the requirement. " +
          "Reply with exactly two fields on separate lines:\nANSWER: Yes or No\nCONFIDENCE: a number 0.0-1.0",
      },
      {
        role: "user",
        content: `Screening question: "${question}"

Candidate resume:
${resumeText}

Based strictly on the resume above, should the candidate answer Yes or No?
Include a confidence score (0.0 = completely uncertain, 1.0 = completely certain).`,
      },
    ],
    max_tokens: 20,
    temperature: 0,
  });

  const raw = response.choices[0]?.message?.content?.trim() ?? "ANSWER: Yes\nCONFIDENCE: 0.5";
  const answerLine = raw.match(/ANSWER:\s*(Yes|No)/i);
  const confLine = raw.match(/CONFIDENCE:\s*([\d.]+)/i);

  const answer = answerLine?.[1] ?? "Yes";
  const confidence = parseFloat(confLine?.[1] ?? "0.5");

  // Save to question bank — flag for review if low confidence
  await saveToQuestionBank({
    question,
    answer: confidence >= 0.6 ? answer : null,
    source: "ai",
    confidence,
    jobId: job.id,
    company: job.company,
    jobTitle: job.jobTitle,
    platform: job.platform,
  });

  if (confidence < 0.6) {
    await addLog(
      "warn",
      `Low-confidence Yes/No answer (${confidence.toFixed(2)}) for: "${question.slice(0, 80)}" — saved to question bank for review`
    );
  }

  return answer.toLowerCase().startsWith("y");
}

export async function generateAtsAnswer(
  question: string,
  job: { jobTitle: string; company: string; jobDescription: string; id?: number; platform?: string },
  resume: ParsedResume,
  maxChars?: number
): Promise<string> {
  // Helper: truncate a string to maxChars at a word boundary
  function truncateToLimit(text: string, limit: number): string {
    if (text.length <= limit) return text;
    // Try to break at a word boundary
    const cut = text.slice(0, limit);
    const lastSpace = cut.lastIndexOf(" ");
    return (lastSpace > limit * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd();
  }

  // Coerce numeric-style questions (years / salary / notice / 1-10 rating) to a bare
  // number so the bank stores clean values that pass "enter a number" validation.
  // (#3) Applied at every return path below.
  function coerceNumeric(ans: string): string {
    const ql = question.toLowerCase();
    const numeric =
      ql.includes("how many year") ||
      ql.startsWith("number of years") || ql.startsWith("# of years") ||
      ql.includes("years of experience do you have") ||
      ql.includes("salary") || ql.includes("compensation") || ql.includes("ctc") ||
      ql.includes("notice period") || ql.includes("what is your notice") ||
      /on a scale of 1\s*[-to ]+\s*10/.test(ql) ||
      /rate (your|yourself)[^?]*\b(10|ten)\b/.test(ql);
    if (!numeric) return ans;
    if (ql.includes("current") && (ql.includes("salary") || ql.includes("ctc"))) return "0";
    if ((ql.includes("expected") || ql.includes("desired")) && (ql.includes("salary") || ql.includes("compensation"))) return "85000";
    if (ql.includes("notice")) return "0";
    const m = ans.match(/\b(\d+)\b/);
    if (m) return m[1] ?? "1";
    if (/less than|under|no experience|none/i.test(ans)) return "0";
    return "1";
  }

  // 1. Check question bank for a saved user-verified answer
  const saved = await lookupSavedAnswer(question);
  if (saved !== null) {
    const out = coerceNumeric(saved);
    return maxChars ? truncateToLimit(out, maxChars) : out;
  }

  // 2. Try resume inference for common question types
  const inferred = inferFromResume(question, resume);
  if (inferred && inferred.confidence >= 0.8) {
    const coerced = coerceNumeric(inferred.answer);
    const answer = maxChars ? truncateToLimit(coerced, maxChars) : coerced;
    await saveToQuestionBank({
      question,
      answer,
      source: "resume",
      confidence: inferred.confidence,
      jobId: job.id,
      company: job.company,
      jobTitle: job.jobTitle,
      platform: job.platform,
    });
    return answer;
  }

  // 3. AI fallback
  const ai = await getOpenAIClient();
  if (!ai) {
    if (inferred) return maxChars ? truncateToLimit(inferred.answer, maxChars) : inferred.answer;
    return "Yes";
  }

  const resumeText = JSON.stringify(resume, null, 2);

  // If there's a character limit, instruct the AI to stay within it.
  // LinkedIn commonly uses 200-char limits; keep answers short and direct.
  const charInstruction = maxChars
    ? `\n\nCRITICAL: Your entire answer must be ${maxChars} characters or fewer (including spaces). Count carefully before responding. Be very concise — a single short sentence is ideal.`
    : " Keep it concise (1-3 sentences max).";

  const response = await ai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      {
        role: "user",
        content: `Answer this job application question for a ${job.jobTitle} role at ${job.company}.${charInstruction}

Question: "${question}"

Candidate resume:
${resumeText}

Be honest and specific to the candidate's actual background.`,
      },
    ],
    // Limit tokens proportionally — 200 chars ≈ 50 tokens; full is 150
    max_tokens: maxChars ? Math.min(150, Math.ceil(maxChars / 3.5)) : 150,
  });

  let answer = response.choices[0]?.message?.content?.trim() ?? "Yes";

  // (#3) Coerce numeric questions to a bare number before saving/returning.
  answer = coerceNumeric(answer);

  // Hard-truncate as safety net even if AI tried to comply
  if (maxChars) answer = truncateToLimit(answer, maxChars);

  // Save AI-generated answers to the bank with moderate confidence
  // (open-ended questions are harder to auto-verify, so always save for potential review)
  await saveToQuestionBank({
    question,
    answer,
    source: "ai",
    confidence: 0.65,
    jobId: job.id,
    company: job.company,
    jobTitle: job.jobTitle,
    platform: job.platform,
  });

  return answer;
}
