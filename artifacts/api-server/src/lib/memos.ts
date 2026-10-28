import { and, eq } from "drizzle-orm";
import {
  assignmentsTable,
  db,
  markingResultsTable,
  memoItemsTable,
  memosTable,
  submissionsTable,
  type Memo,
  type MemoItem,
} from "@workspace/db";
import type { GeneratedQuestion } from "./ai";

// Marks per question and the memorandum.
//
// Two invariants hold the whole feature together:
//
//  1. Numbering is fixed. A learner's answer N always maps to memo item N, no
//     matter how the per-learner variant reworded the question, and the order is
//     never shuffled. `normalizeQuestions` derives the numbers from position, so
//     every variant of the same assignment gets the identical sequence.
//  2. Marks are whole positive numbers, and the assignment total is the sum.
//     Nothing stores the total; it is always recomputed.

export type NumberedQuestion = GeneratedQuestion & { questionNumber: string; marks: number };

export function questionNumberFor(index: number): string {
  return `${index + 1}`;
}

// Applies the fixed numbering and a positive whole-number mark to every
// question, in order. When `numbering` is supplied (an approved blueprint or a
// stored question set), those numbers win, which is what keeps a learner's
// variant aligned with the memo.
export function normalizeQuestions(questions: GeneratedQuestion[], numbering?: string[]): NumberedQuestion[] {
  return questions.map((question, index) => {
    const explicit = question.questionNumber?.trim();
    const marks = Number.isFinite(question.marks) ? Math.max(1, Math.round(question.marks as number)) : 1;
    return {
      ...question,
      questionNumber: numbering?.[index] ?? (explicit || questionNumberFor(index)),
      marks,
    };
  });
}

export function totalMarks(questions: Array<{ marks?: number }>): number {
  return questions.reduce((total, question) => total + (Number.isFinite(question.marks) ? Math.max(0, Math.round(question.marks as number)) : 0), 0);
}

export type MemoWithItems = { memo: Memo; items: MemoItem[] };

export async function loadMemo(assignmentId: string): Promise<MemoWithItems | null> {
  const [memo] = await db.select().from(memosTable).where(eq(memosTable.assignmentId, assignmentId)).limit(1);
  if (!memo) return null;
  const items = await db.select().from(memoItemsTable).where(eq(memoItemsTable.memoId, memo.id));
  return { memo, items: orderItems(items) };
}

// Memo items are ordered by their question number so the numbering, not the
// insertion order, drives everything downstream.
export function orderItems(items: MemoItem[]): MemoItem[] {
  return [...items].sort((a, b) => compareQuestionNumbers(a.questionNumber, b.questionNumber));
}

export function compareQuestionNumbers(a: string, b: string): number {
  const parse = (value: string) => value.split(".").map((part) => Number.parseInt(part, 10)).filter((part) => Number.isFinite(part));
  const left = parse(a);
  const right = parse(b);
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return a.localeCompare(b);
}

export type MemoReadiness = {
  ok: boolean;
  missingMarks: string[];
  missingItems: string[];
  memoStatus: string | null;
  confirmed: boolean;
};

// What still stands between this assignment and publishing. `requireConfirmed`
// is false for Independent mode, where the AI's own answer key (source
// AI_AUTO) is the memo and there is no teacher gate.
export async function memoReadiness(assignmentId: string, options: { requireConfirmed?: boolean } = {}): Promise<MemoReadiness> {
  const requireConfirmed = options.requireConfirmed ?? true;
  const [assignment] = await db.select().from(assignmentsTable).where(eq(assignmentsTable.id, assignmentId)).limit(1);
  const blueprint = Array.isArray(assignment?.questionBlueprint) ? (assignment!.questionBlueprint as GeneratedQuestion[]) : [];
  const missingMarks = blueprint
    .map((question, index) => ({ number: question.questionNumber?.trim() || questionNumberFor(index), marks: question.marks }))
    .filter((entry) => !Number.isInteger(entry.marks) || (entry.marks as number) < 1)
    .map((entry) => entry.number);
  const loaded = await loadMemo(assignmentId);
  const memoStatus = loaded?.memo.status ?? null;
  const confirmed = Boolean(loaded && loaded.memo.status === "confirmed");
  const itemByNumber = new Map((loaded?.items ?? []).map((item) => [item.questionNumber, item]));
  const missingItems = blueprint
    .map((question, index) => question.questionNumber?.trim() || questionNumberFor(index))
    .filter((number) => {
      const item = itemByNumber.get(number);
      return !item || !item.modelAnswer.trim();
    });
  const ok = missingMarks.length === 0 && missingItems.length === 0 && (!requireConfirmed || confirmed);
  return { ok, missingMarks, missingItems, memoStatus, confirmed };
}

export type MemoItemInput = {
  questionNumber: string;
  modelAnswer: string;
  markingGuide?: string;
  acceptableAlternatives?: string[];
};

// Writes (or replaces) the memo and its items. Saving always drops the memo back
// to draft: a memo is only "confirmed" once the teacher has explicitly confirmed
// it after seeing the variant preview.
export async function saveMemo(
  assignmentId: string,
  items: MemoItemInput[],
  options: { source: string; teacherUserId?: string | null; status?: string; samplesChecked?: boolean },
): Promise<MemoWithItems> {
  const [existing] = await db.select().from(memosTable).where(eq(memosTable.assignmentId, assignmentId)).limit(1);
  const status = options.status ?? "draft";
  let memo: Memo;
  if (existing) {
    const [updated] = await db.update(memosTable).set({
      status,
      source: options.source,
      version: existing.version + 1,
      confirmedBy: status === "confirmed" ? options.teacherUserId ?? null : null,
      confirmedAt: status === "confirmed" ? new Date() : null,
      samplesChecked: Boolean(options.samplesChecked),
    }).where(eq(memosTable.id, existing.id)).returning();
    memo = updated;
  } else {
    const [created] = await db.insert(memosTable).values({
      assignmentId,
      status,
      source: options.source,
      version: 1,
      confirmedBy: status === "confirmed" ? options.teacherUserId ?? null : null,
      confirmedAt: status === "confirmed" ? new Date() : null,
      samplesChecked: Boolean(options.samplesChecked),
    }).returning();
    memo = created;
  }
  // Replace the item set wholesale so a removed question cannot leave a stale
  // memo item behind.
  await db.delete(memoItemsTable).where(eq(memoItemsTable.memoId, memo.id));
  const ordered = orderItems(items as unknown as MemoItem[]);
  if (ordered.length) {
    await db.insert(memoItemsTable).values(ordered.map((item) => ({
      memoId: memo.id,
      questionNumber: item.questionNumber,
      modelAnswer: item.modelAnswer ?? "",
      markingGuide: item.markingGuide ?? "",
      acceptableAlternatives: Array.isArray(item.acceptableAlternatives) ? item.acceptableAlternatives : [],
    })));
  }
  return (await loadMemo(assignmentId))!;
}

// Stores the AI's own answer key as the memo. Used for Independent-mode
// assignments (source AI_AUTO, already "confirmed" because no teacher gate
// applies) and as the starting draft for a Teacher-Dependent AI assignment
// (source AI_DRAFT_CONFIRMED, left in draft until the teacher confirms).
export async function storeMemoFromAnswerKey(
  assignmentId: string,
  questions: NumberedQuestion[],
  options: { source: "AI_AUTO" | "AI_DRAFT_CONFIRMED"; autoConfirm: boolean },
): Promise<MemoWithItems> {
  const items: MemoItemInput[] = questions.map((question) => ({
    questionNumber: question.questionNumber,
    modelAnswer: question.answer,
    markingGuide: `Full marks (${question.marks}) for a correct answer.`,
    acceptableAlternatives: [],
  }));
  return saveMemo(assignmentId, items, {
    source: options.source,
    status: options.autoConfirm ? "confirmed" : "draft",
    samplesChecked: false,
  });
}

export async function insertMarkingResults(
  submissionId: string,
  rows: Array<{ questionNumber: string; questionId: string; awardedMarks: number; maxMarks: number; derivedExpectedAnswer: string; reason: string; needsTeacherReview: boolean; markedBy: string }>,
): Promise<void> {
  await db.delete(markingResultsTable).where(eq(markingResultsTable.submissionId, submissionId));
  if (!rows.length) return;
  await db.insert(markingResultsTable).values(rows.map((row) => ({
    submissionId,
    questionNumber: row.questionNumber,
    questionId: row.questionId,
    // Clamp here as the last line of defence: marks are whole, never negative,
    // and never above what the question is worth.
    awardedMarks: Math.max(0, Math.min(row.maxMarks, Math.round(row.awardedMarks))),
    maxMarks: Math.max(0, Math.round(row.maxMarks)),
    derivedExpectedAnswer: row.derivedExpectedAnswer,
    reason: row.reason,
    needsTeacherReview: row.needsTeacherReview,
    markedBy: row.markedBy,
  })));
}

export async function loadMarkingResults(submissionId: string) {
  const rows = await db.select().from(markingResultsTable).where(eq(markingResultsTable.submissionId, submissionId));
  return rows.sort((a, b) => compareQuestionNumbers(a.questionNumber, b.questionNumber));
}

// A submission with any question flagged for review is held back from the
// learner and the parent until a teacher resolves it.
export async function submissionNeedsTeacherReview(submissionId: string): Promise<boolean> {
  const rows = await db
    .select({ flagged: markingResultsTable.needsTeacherReview })
    .from(markingResultsTable)
    .where(and(eq(markingResultsTable.submissionId, submissionId), eq(markingResultsTable.needsTeacherReview, true)))
    .limit(1);
  return rows.length > 0;
}

export async function submissionForAssignmentAndLearner(assignmentId: string, learnerId: string) {
  const [submission] = await db
    .select()
    .from(submissionsTable)
    .where(and(eq(submissionsTable.assignmentId, assignmentId), eq(submissionsTable.learnerId, learnerId)))
    .limit(1);
  return submission ?? null;
}
