import { eq } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  assignmentsTable,
  classesTable,
  learningActivitiesTable,
  remediationActivitiesTable,
  submissionsTable,
} from "@workspace/db/schema";
import {
  GeminiUnavailableError,
  markAgainstMemo,
  markAssignment,
  type GeneratedQuestion,
  type MarkingResult,
  type MemoMarkingResult,
} from "./ai";
import { assessmentGuideForClass } from "./presets";
import { updateLearningSignal } from "./learning-profile";
import { resultsReleased } from "./result-release";
import { insertMarkingResults, loadMemo, normalizeQuestions, questionNumberFor, submissionNeedsTeacherReview, totalMarks, type NumberedQuestion } from "./memos";
import type { Logger } from "pino";

// The single marking-and-persisting pipeline shared by the learner's manual
// submit and by focus-mode auto-submit. Keeping one implementation means an
// auto-submitted paper is marked exactly like a hand-submitted one, and the
// learner's saved answers are never lost.

const REMEDIATION_FORMATS = ["QUIZ", "GAME", "PUZZLE", "CASE_STUDY", "ASSESSMENT"] as const;

type Assignment = typeof assignmentsTable.$inferSelect;
type ClassRow = typeof classesTable.$inferSelect;

export type SubmitOutcome = {
  submissionId: string;
  score: number | null;
  overallVerdict: string | null;
  feedback: string | null;
  marks: StoredMark[];
  markingStatus: string;
  released: boolean;
  statusMessage?: string;
  remediation: {
    id: string;
    format: string;
    title: string;
    concept: string;
    prompt: string;
    options: string[];
    instruction: string;
  } | null;
};

export type PipelineInput = {
  assignment: Assignment;
  classRow: ClassRow | null;
  learnerId: string;
  sessionId: string;
  questions: GeneratedQuestion[];
  answers: Array<{ questionId: string; answer: string }>;
  autoSubmitted?: boolean;
  autoSubmitReason?: "FOCUS_EXIT_LIMIT" | "FOCUS_AWAY_TIMEOUT" | null;
  logger?: Pick<Logger, "error" | "warn">;
};

// How marks were produced, which the print footer reports: "AI" (the model
// marked against the teacher's memo), "TEACHER" (every question marked by hand)
// or "MIXED".
export type MarkedByMode = "AI" | "TEACHER" | "MIXED";

export class MarkingFailedError extends Error {
  constructor() {
    super("Marking could not be completed.");
    this.name = "MarkingFailedError";
  }
}

// The per-question mark shape stored on the submission. It keeps the legacy
// percentage fields so existing learners, parents and dashboards keep working,
// and adds the marks-out-of-max fields the new memo marking produces.
export type StoredMark = {
  questionId: string;
  verdict: string;
  explanation: string;
  score: number | null;
  gap: string | null;
  questionNumber?: string;
  awardedMarks?: number | null;
  maxMarks?: number | null;
};

// A submission whose answers fall outside the memo, or that the marker was
// unsure about, is held back from the learner and parent until a teacher looks
// at it. This is separate from focus mode's hold.
function verdictForRatio(ratio: number) {
  return ratio >= 0.8 ? "CORRECT" : ratio >= 0.4 ? "PARTIALLY_CORRECT" : "INCORRECT";
}

// Marks every question against the memo. `heldIndices` are the questions this
// mode leaves for the teacher (selective/manual); everything else is marked by
// the model against the memo item with the same number.
async function markAgainstMemoItems(
  input: PipelineInput,
  numbered: NumberedQuestion[],
  memo: NonNullable<Awaited<ReturnType<typeof loadMemo>>>,
  heldIndices: Set<number>,
  assessmentGuide: string | undefined,
): Promise<{
  marks: StoredMark[];
  markingResults: Array<{ questionNumber: string; questionId: string; awardedMarks: number; maxMarks: number; derivedExpectedAnswer: string; reason: string; needsTeacherReview: boolean; markedBy: string }>;
  score: number;
  overallVerdict: string;
  feedback: string;
  remediation: MarkingResult["remediation"];
  markedBy: MarkedByMode;
}> {
  const itemByNumber = new Map(memo.items.map((item) => [item.questionNumber, item]));
  const toMark = numbered.map((question, index) => ({ question, index })).filter((entry) => !heldIndices.has(entry.index));
  const markingItems = toMark.map(({ question }) => {
    const item = itemByNumber.get(question.questionNumber);
    return {
      questionNumber: question.questionNumber,
      modelAnswer: item?.modelAnswer ?? "",
      markingGuide: item?.markingGuide ?? "",
      acceptableAlternatives: item?.acceptableAlternatives ?? [],
      maxMarks: question.marks,
      variantQuestion: question.prompt,
      learnerAnswer: input.answers.find((entry) => entry.questionId === question.id)?.answer ?? "",
    };
  });

  let marking: MemoMarkingResult | null = null;
  if (markingItems.length) {
    marking = await markAgainstMemo({
      subject: input.assignment.subject,
      topic: input.assignment.topic,
      grade: input.classRow?.grade ?? 0,
      items: markingItems,
      assessmentGuide,
    });
  }
  const resultByNumber = new Map((marking?.marks ?? []).map((mark) => [mark.questionNumber, mark]));

  const marks: StoredMark[] = numbered.map((question, index) => {
    const maxMarks = question.marks;
    if (heldIndices.has(index)) {
      return {
        questionId: question.id,
        verdict: "PENDING_TEACHER_REVIEW",
        explanation: "Held for teacher marking.",
        score: null,
        gap: null,
        questionNumber: question.questionNumber,
        awardedMarks: null,
        maxMarks,
      };
    }
    const item = resultByNumber.get(question.questionNumber);
    const awarded = Math.max(0, Math.min(maxMarks, Math.round(item?.awardedMarks ?? 0)));
    return {
      questionId: question.id,
      verdict: verdictForRatio(maxMarks ? awarded / maxMarks : 0),
      explanation: item?.reason ?? "",
      score: maxMarks ? Math.round((awarded / maxMarks) * 100) : 0,
      gap: item?.gap ?? null,
      questionNumber: question.questionNumber,
      awardedMarks: awarded,
      maxMarks,
    };
  });

  const markingResults = numbered.map((question, index) => {
    const held = heldIndices.has(index);
    const item = resultByNumber.get(question.questionNumber);
    const stored = marks[index];
    return {
      questionNumber: question.questionNumber,
      questionId: question.id,
      awardedMarks: held ? 0 : (stored.awardedMarks ?? 0),
      maxMarks: question.marks,
      derivedExpectedAnswer: item?.derivedExpectedAnswer ?? "",
      reason: held ? "Held for teacher marking." : (item?.reason ?? ""),
      needsTeacherReview: held ? true : Boolean(item?.needsTeacherReview),
      markedBy: held ? "TEACHER" : "AI",
    };
  });

  const markedTotals = numbered.reduce(
    (totals, question, index) => (heldIndices.has(index) ? totals : {
      awarded: totals.awarded + (marks[index].awardedMarks ?? 0),
      max: totals.max + question.marks,
    }),
    { awarded: 0, max: 0 },
  );
  const score = markedTotals.max ? Math.round((markedTotals.awarded / markedTotals.max) * 100) : 0;
  const heldCount = heldIndices.size;
  const markedBy: MarkedByMode = heldCount === numbered.length ? "TEACHER" : heldCount > 0 ? "MIXED" : "AI";
  return {
    marks,
    markingResults,
    score,
    overallVerdict: marking?.overallVerdict ?? (heldCount === numbered.length ? "PENDING_REVIEW" : "PARTIALLY_CORRECT"),
    feedback: marking?.overallFeedback ?? (heldCount === numbered.length ? "Held for teacher review." : ""),
    remediation: marking?.remediation ?? null,
    markedBy,
  };
}

export async function markAndPersistSubmission(input: PipelineInput): Promise<SubmitOutcome> {
  const { assignment, classRow, learnerId, sessionId, questions, answers } = input;
  const markingMode = assignment.markingMode ?? "auto";
  const clampScore = (value: number | null) => (value === null ? null : Math.max(0, Math.min(100, Math.round(value))));

  const numbered = normalizeQuestions(questions);
  const memo = await loadMemo(assignment.id);
  const assessmentGuide = await assessmentGuideForClass(classRow);

  // AUTO: the model marks every question against the memo immediately.
  // SELECTIVE: only the indices in autoMarkQuestions go to the model; the rest
  // are held for the teacher. MANUAL: everything is held for the teacher.
  const autoSet = new Set(markingMode === "selective" ? (assignment.autoMarkQuestions ?? []) : []);
  const heldIndices = new Set(
    markingMode === "auto"
      ? []
      : numbered.map((_, index) => index).filter((index) => !autoSet.has(index)),
  );

  let marks: StoredMark[];
  let markingStatus: string = "MARKED";
  let score = 0;
  let overallVerdict = "PENDING_REVIEW";
  let feedback = "Held for teacher review.";
  let remediation: NonNullable<MarkingResult["remediation"]> | null = null;
  let markingResults: Array<{ questionNumber: string; questionId: string; awardedMarks: number; maxMarks: number; derivedExpectedAnswer: string; reason: string; needsTeacherReview: boolean; markedBy: string }> = [];
  let markedBy: MarkedByMode = "AI";

  if (memo && memo.memo.status === "confirmed") {
    // The teacher's memo drives marking. This is the normal path.
    try {
      const result = await markAgainstMemoItems(input, numbered, memo, heldIndices, assessmentGuide);
      marks = result.marks;
      markingResults = result.markingResults;
      score = result.score;
      overallVerdict = result.overallVerdict;
      feedback = result.feedback;
      remediation = result.remediation;
      markedBy = result.markedBy;
      if (heldIndices.size > 0) markingStatus = "PENDING_TEACHER_REVIEW";
    } catch (error) {
      if (!(error instanceof GeminiUnavailableError)) throw error;
      input.logger?.warn({ assignmentId: assignment.id, learnerId }, "memo marking failed after retries; saved as MARKING_FAILED");
      markingStatus = "MARKING_FAILED";
      marks = numbered.map((question) => ({
        questionId: question.id,
        verdict: "PENDING_TEACHER_REVIEW",
        explanation: "Marking is delayed. Your answers are saved and will be marked automatically.",
        score: null,
        gap: null,
        questionNumber: question.questionNumber,
        awardedMarks: null,
        maxMarks: question.marks,
      }));
      markingResults = numbered.map((question) => ({
        questionNumber: question.questionNumber,
        questionId: question.id,
        awardedMarks: 0,
        maxMarks: question.marks,
        derivedExpectedAnswer: "",
        reason: "Marking is delayed; this paper will be marked automatically.",
        needsTeacherReview: false,
        markedBy: "AI",
      }));
      score = 0;
      overallVerdict = "PENDING_REVIEW";
      feedback = "Marking is delayed. Your answers are saved and will be marked automatically.";
      remediation = null;
    }
  } else {
    // No confirmed memo (an older assignment, or Independent mode before the
    // answer-key memo was written): fall back to the legacy percentage marking
    // so nothing that used to work stops working.
    try {
      if (markingMode === "auto") {
        const marking = await markAssignment({ subject: assignment.subject, topic: assignment.topic, questions: numbered, answers, assessmentGuide });
        marks = marking.marks.slice(0, numbered.length).map((mark, index) => ({ ...mark, gap: mark.gap ?? null, score: clampScore(mark.score), questionNumber: numbered[index]?.questionNumber, maxMarks: numbered[index]?.marks ?? null, awardedMarks: null }));
        score = Math.max(0, Math.min(100, Math.round(marking.score)));
        overallVerdict = marking.overallVerdict;
        feedback = marking.feedback;
        remediation = marking.remediation;
      } else {
        const heldForTeacher = numbered.map((question, index) => ({ question, index })).filter((entry) => heldIndices.has(entry.index));
        const autoSubset = numbered.filter((_, index) => !heldIndices.has(index));
        let autoMarking: MarkingResult | null = null;
        if (autoSubset.length) {
          const autoAnswers = autoSubset.map((question) => answers.find((entry) => entry.questionId === question.id) ?? { questionId: question.id, answer: "" });
          autoMarking = await markAssignment({ subject: assignment.subject, topic: assignment.topic, questions: autoSubset, answers: autoAnswers, assessmentGuide });
        }
        marks = numbered.map((question, index) => {
          if (heldIndices.has(index)) {
            return { questionId: question.id, verdict: "PENDING_TEACHER_REVIEW", explanation: "Held for teacher marking.", score: null, gap: null, questionNumber: question.questionNumber, awardedMarks: null, maxMarks: question.marks };
          }
          const entry = autoMarking?.marks.find((mark) => mark.questionId === question.id);
          return {
            questionId: question.id,
            verdict: entry?.verdict ?? "PENDING_TEACHER_REVIEW",
            explanation: entry?.explanation ?? "",
            score: entry ? clampScore(entry.score) : null,
            gap: entry?.gap ?? null,
            questionNumber: question.questionNumber,
            awardedMarks: null,
            maxMarks: question.marks,
          };
        });
        const autoScores = marks.filter((mark) => mark.score !== null).map((mark) => mark.score as number);
        score = autoScores.length ? Math.max(0, Math.min(100, Math.round(autoScores.reduce((total, value) => total + value, 0) / autoScores.length))) : 0;
        if (autoMarking) {
          overallVerdict = autoMarking.overallVerdict;
          feedback = autoMarking.feedback;
          remediation = autoMarking.remediation;
        }
        if (heldForTeacher.length > 0) markingStatus = "PENDING_TEACHER_REVIEW";
      }
    } catch (error) {
      if (!(error instanceof GeminiUnavailableError)) throw error;
      // Marking did not succeed after every retry. The learner's work must not be
      // lost, so the submission is saved with MARKING_FAILED and retried from a
      // background job or when the teacher next opens the submission.
      input.logger?.warn({ assignmentId: assignment.id, learnerId }, "marking failed after retries; saved as MARKING_FAILED");
      markingStatus = "MARKING_FAILED";
      marks = numbered.map((question) => ({
        questionId: question.id,
        verdict: "PENDING_TEACHER_REVIEW",
        explanation: "Marking is delayed. Your answers are saved and will be marked automatically.",
        score: null,
        gap: null,
        questionNumber: question.questionNumber,
        awardedMarks: null,
        maxMarks: question.marks,
      }));
      score = 0;
      overallVerdict = "PENDING_REVIEW";
      feedback = "Marking is delayed. Your answers are saved and will be marked automatically.";
      remediation = null;
    }
  }

  // One paper per attempt. A concurrent auto-submit may have persisted the same
  // session a moment ago, so the insert is made idempotent: the existing row is
  // returned instead of a second one being written (the unique index on
  // session_id is the backstop if two writers still race).
  const [submission] = await db.insert(submissionsTable).values({
    assignmentId: assignment.id,
    learnerId,
    sessionId,
    score,
    overallVerdict,
    feedback,
    marks,
    answers,
    markingStatus,
    autoSubmitted: input.autoSubmitted ?? false,
    autoSubmitReason: input.autoSubmitReason ?? null,
    // Focus mode never reveals a result the learner did not get to earn: an
    // auto-submitted paper is held until the teacher releases it.
    resultsHeldForReview: Boolean(input.autoSubmitted),
  }).onConflictDoNothing({ target: submissionsTable.sessionId }).returning();
  if (!submission) {
    const [existing] = await db.select().from(submissionsTable).where(eq(submissionsTable.sessionId, sessionId)).limit(1);
    if (!existing) throw new Error("The submission could not be saved.");
    // Another writer won the race. Its paper stands; this attempt adds nothing.
    return {
      submissionId: existing.id,
      score: null,
      overallVerdict: null,
      feedback: null,
      marks: [],
      markingStatus: existing.markingStatus,
      released: false,
      statusMessage: "Your answers are saved.",
      remediation: null,
    };
  }

  // The per-question marking detail is written alongside, and is what the
  // teacher's override and the review queue read.
  if (markingResults.length) {
    await insertMarkingResults(submission.id, markingResults);
  }
  // A paper the marker was unsure about is held back from the learner and parent
  // until a teacher resolves it. An already-held paper (focus mode) stays held.
  const flaggedForReview = markingResults.some((row) => row.needsTeacherReview && row.markedBy === "AI");
  const heldForReview = Boolean(input.autoSubmitted) || flaggedForReview;
  if (heldForReview) {
    await db.update(submissionsTable).set({ resultsHeldForReview: true }).where(eq(submissionsTable.id, submission.id));
  }
  const released = markingStatus === "MARKED" && resultsReleased(assignment) && !heldForReview;
  const publicRemediation = !heldForReview && remediation && (REMEDIATION_FORMATS as readonly string[]).includes(remediation.format) ? remediation : null;
  let publicRemediationPayload: SubmitOutcome["remediation"] = null;
  if (publicRemediation) {
    const [created] = await db.insert(remediationActivitiesTable).values({
      learnerId,
      assignmentId: assignment.id,
      format: publicRemediation.format,
      title: publicRemediation.title,
      concept: publicRemediation.concept,
      prompt: publicRemediation.prompt,
      options: publicRemediation.options ?? [],
      instruction: publicRemediation.instruction,
      expectedAnswer: publicRemediation.expectedAnswer,
    }).returning();
    publicRemediationPayload = {
      id: created.id,
      format: created.format,
      title: created.title,
      concept: created.concept,
      prompt: created.prompt,
      options: created.options,
      instruction: created.instruction,
    };
    const firstGap = marks.find((mark) => mark.gap)?.gap;
    await updateLearningSignal(learnerId, publicRemediation.format, score, firstGap);
  }
  if (released) {
    await db.insert(learningActivitiesTable).values({
      learnerId,
      label: `Completed ${assignment.title}`,
      subject: assignment.subject,
      score,
      detail: feedback,
    });
  }
  if (!released) {
    const statusMessage = flaggedForReview
      ? "Submitted. Some answers need your teacher to look at them before the result is released."
      : heldForReview
        ? "Submitted by focus mode. Your answers are saved. Your teacher will release the result."
        : markingStatus === "MARKING_FAILED"
          ? "Submitted. Your answers are saved and will be marked automatically."
          : assignment.resultReleasePolicy === "after_close"
            ? "Submitted. Your result will be available after the assignment closes."
            : "Submitted. Your result will be available once every question is marked.";
    return {
      submissionId: submission.id,
      score: null,
      overallVerdict: null,
      feedback: null,
      marks: [],
      markingStatus,
      released: false,
      statusMessage,
      remediation: null,
    };
  }
  return {
    submissionId: submission.id,
    score,
    overallVerdict,
    feedback,
    marks,
    markingStatus,
    released: true,
    remediation: publicRemediationPayload,
  };
}
