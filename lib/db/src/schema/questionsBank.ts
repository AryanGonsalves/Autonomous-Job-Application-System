import { sqliteTable, integer, text, real } from "drizzle-orm/sqlite-core";
import { jobsTable } from "./jobs";

const answerSourceValues = ["resume", "ai", "user", "saved"] as const;

/**
 * questionsBank — stores ATS screening questions encountered during applications.
 *
 * Flow:
 *   1. AI tries to answer from resume (source = "resume").
 *   2. If confidence < 0.7, AI falls back to GPT (source = "ai") and
 *      saves the question here with needsReview = 1.
 *   3. User reviews in the dashboard and provides a canonical answer (source = "user").
 *   4. Next time the same question is seen (fuzzy match), the saved answer is used
 *      without AI (source = "saved") — faster + more accurate.
 */
export const questionsBankTable = sqliteTable("questions_bank", {
  id: integer("id").primaryKey({ autoIncrement: true }),

  /** The question text exactly as it appears in the ATS form. */
  question: text("question").notNull(),

  /** Normalised version for matching (lowercase, punctuation stripped). */
  questionNorm: text("question_norm").notNull(),

  /**
   * The answer used / saved. Null when we need user review.
   * For Yes/No questions this is "Yes" or "No".
   */
  answer: text("answer"),

  /** Where this answer came from. */
  source: text("source", { enum: answerSourceValues }).notNull().default("ai"),

  /** 0–1. Low confidence flags the question for user review. */
  confidence: real("confidence").notNull().default(0),

  /** True when no confident answer exists and user review is needed. */
  needsReview: integer("needs_review", { mode: "boolean" }).notNull().default(true),

  /** Optional user-written note or override. */
  userNote: text("user_note"),

  /** Job context — helps user know which application triggered this. */
  jobId: integer("job_id").references(() => jobsTable.id),
  company: text("company"),
  jobTitle: text("job_title"),
  platform: text("platform"),

  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().defaultNow(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().defaultNow(),
});

export type QuestionBank = typeof questionsBankTable.$inferSelect;
export type InsertQuestionBank = typeof questionsBankTable.$inferInsert;
