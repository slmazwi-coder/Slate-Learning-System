import { and, eq } from "drizzle-orm";
import {
  assignmentSessionsTable,
  assignmentsTable,
  classesTable,
  db,
  remarkQueueTable,
  submissionsTable,
} from "@workspace/db";
import {
  GeminiUnavailableError,
  markAgainstMemo,
  markAssignment,
  type GeneratedQuestion,
  type MarkingResult,
} from "./ai";
import { assessmentGuideForClass } from "./presets";
import { insertMarkingResults, loadMemo, normalizeQuestions, questionNumberFor } from "./memos";

// Re-marking, in one place.
//
// Two things re-mark a paper: a memo or marks revision after the first
// submission, and the recovery of a submission whose first marking attempt
// failed. Both go through `remarkSubmissionInPlace` so the two paths cannot
// drift apart — a re-marked paper is marked exactly like a freshly submitted one.

type StoredMark = {
  questionId: string;
  verdict: string;
  explanation: string;
  score: number | null;
  gap: string | null;
  questionNumber?: string;
  awardedMarks?: number | null;
  maxMarks?: number | null;
};

function clampScore(value: number | null) {
  return value === null ? null : Math.max(0, Math.min(100, Math.round(value)));
}

function verdictForRatio(ratio: number) {
  return ratio >= 0.8 ? "CORRECT" : ratio >= 0.4 ? "PARTIALLY_CORRECT" : "INCORRECT";
}

export type RemarkOutcome = "REMARKED" | "SKIPPED" | "FAILED";

// Re-marks one submission in place, leaving the learner's answers untouched.
export async function remarkSubmissionInPlace(submissionId: string): Promise<RemarkOutcome> {
  const [submission] = await db.select().from(submissionsTable).where(eq(submissionsTable.id, submissionId)).limit(1);
  if (!submission) return "SKIPPED";
  const [assignment] = await db.select().from(assignmentsTable).where(eq(assignmentsTable.id, submission.assignmentId)).limit(1);
  if (!assignment) return "SKIPPED";
  const [classRow] = assignment.classId
    ? await db.select().from(classesTable).where(eq(classesTable.id, assignment.classId)).limit(1)
    : [];
  const questions = await loadSessionQuestions(submission.sessionId);
  if (!questions.length) return "SKIPPED";
  const answers = (submission.answers as Array<{ questionId: string; answer: string }>) ?? [];
  const numbered = normalizeQuestions(questions);
  const memo = await loadMemo(assignment.id);
  const assessmentGuide = await assessmentGuideForClass(classRow ?? null);

  try {
    if (memo && memo.memo.status === "confirmed") {
      const itemByNumber = new Map(memo.items.map((item) => [item.questionNumber, item]));
      const marking = await markAgainstMemo({
        subject: assignment.subject,
        topic: assignment.topic,
        grade: classRow?.grade ?? 0,
        items: numbered.map((question) => ({
          questionNumber: question.questionNumber,
          modelAnswer: itemByNumber.get(question.questionNumber)?.modelAnswer ?? "",
          markingGuide: itemByNumber.get(question.questionNumber)?.markingGuide ?? "",
          acceptableAlternatives: itemByNumber.get(question.questionNumber)?.acceptableAlternatives ?? [],
          maxMarks: question.marks,
          variantQuestion: question.prompt,
          learnerAnswer: answers.find((entry) => entry.questionId === question.id)?.answer ?? "",
        })),
        assessmentGuide,
      });
      const resultByNumber = new Map(marking.marks.map((mark) => [mark.questionNumber, mark]));
      const marks: StoredMark[] = numbered.map((question) => {
        const item = resultByNumber.get(question.questionNumber);
        const awarded = Math.max(0, Math.min(question.marks, Math.round(item?.awardedMarks ?? 0)));
        return {
          questionId: question.id,
          verdict: verdictForRatio(question.marks ? awarded / question.marks : 0),
          explanation: item?.reason ?? "",
          score: question.marks ? Math.round((awarded / question.marks) * 100) : 0,
          gap: item?.gap ?? null,
          questionNumber: question.questionNumber,
          awardedMarks: awarded,
          maxMarks: question.marks,
        };
      });
      const totalAwarded = marks.reduce((total, mark) => total + (mark.awardedMarks ?? 0), 0);
      const totalMax = numbered.reduce((total, question) => total + question.marks, 0);
      await db.update(submissionsTable).set({
        marks,
        score: totalMax ? Math.round((totalAwarded / totalMax) * 100) : 0,
        overallVerdict: marking.overallVerdict,
        feedback: marking.overallFeedback,
        markingStatus: "MARKED",
      }).where(eq(submissionsTable.id, submission.id));
      await insertMarkingResults(submission.id, numbered.map((question) => {
        const item = resultByNumber.get(question.questionNumber);
        return {
          questionNumber: question.questionNumber,
          questionId: question.id,
          awardedMarks: Math.max(0, Math.min(question.marks, Math.round(item?.awardedMarks ?? 0))),
          maxMarks: question.marks,
          derivedExpectedAnswer: item?.derivedExpectedAnswer ?? "",
          reason: item?.reason ?? "",
          needsTeacherReview: Boolean(item?.needsTeacherReview),
          markedBy: "AI",
        };
      }));
      return "REMARKED";
    }
    // No confirmed memo: fall back to the legacy percentage marking.
    const marking: MarkingResult = await markAssignment({
      subject: assignment.subject,
      topic: assignment.topic,
      questions: numbered,
      answers,
      assessmentGuide,
    });
    const marks: StoredMark[] = marking.marks.slice(0, numbered.length).map((mark, index) => ({
      ...mark,
      gap: mark.gap ?? null,
      score: clampScore(mark.score),
      questionNumber: numbered[index]?.questionNumber ?? questionNumberFor(index),
      maxMarks: numbered[index]?.marks ?? null,
      awardedMarks: null,
    }));
    await db.update(submissionsTable).set({
      marks,
      score: Math.max(0, Math.min(100, Math.round(marking.score))),
      overallVerdict: marking.overallVerdict,
      feedback: marking.feedback,
      markingStatus: "MARKED",
    }).where(eq(submissionsTable.id, submission.id));
    return "REMARKED";
  } catch (error) {
    if (error instanceof GeminiUnavailableError) return "FAILED";
    throw error;
  }
}

export async function loadSessionQuestions(sessionId: string): Promise<GeneratedQuestion[]> {
  const [session] = await db.select({ questions: assignmentSessionsTable.questions })
    .from(assignmentSessionsTable)
    .where(eq(assignmentSessionsTable.id, sessionId))
    .limit(1);
  const questions = session?.questions;
  return Array.isArray(questions) ? (questions as GeneratedQuestion[]) : [];
}

// Queues every submission for an assignment so a memo or marks revision re-marks
// them off the request path. A submission already queued is left alone.
export async function queueRemarkForAssignment(assignmentId: string, reason: string): Promise<number> {
  const rows = await db.select({ id: submissionsTable.id }).from(submissionsTable).where(eq(submissionsTable.assignmentId, assignmentId));
  let queued = 0;
  for (const row of rows) {
    const [existing] = await db.select({ id: remarkQueueTable.id })
      .from(remarkQueueTable)
      .where(and(eq(remarkQueueTable.submissionId, row.id), eq(remarkQueueTable.status, "PENDING")))
      .limit(1);
    if (existing) continue;
    await db.insert(remarkQueueTable).values({ submissionId: row.id, assignmentId, reason });
    queued += 1;
  }
  return queued;
}

// Drains the queue, bounded so a bad Gemini day cannot stall a request. Returns
// how many papers were re-marked.
export async function processRemarkQueue(limit = 20): Promise<number> {
  const pending = await db.select().from(remarkQueueTable)
    .where(eq(remarkQueueTable.status, "PENDING"))
    .limit(limit);
  let remarked = 0;
  for (const row of pending) {
    const outcome = await remarkSubmissionInPlace(row.submissionId);
    if (outcome === "FAILED") {
      await db.update(remarkQueueTable).set({ attempts: row.attempts + 1, lastError: "Gemini unavailable" }).where(eq(remarkQueueTable.id, row.id));
      continue;
    }
    if (outcome === "REMARKED") remarked += 1;
    await db.update(remarkQueueTable).set({ status: "DONE", processedAt: new Date(), attempts: row.attempts + 1 }).where(eq(remarkQueueTable.id, row.id));
  }
  return remarked;
}

export async function pendingRemarkCount(): Promise<number> {
  const rows = await db.select({ id: remarkQueueTable.id }).from(remarkQueueTable).where(eq(remarkQueueTable.status, "PENDING"));
  return rows.length;
}
