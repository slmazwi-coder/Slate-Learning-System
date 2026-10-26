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
  markAssignment,
  type GeneratedQuestion,
  type MarkingResult,
} from "./ai";
import { assessmentGuideForClass } from "./presets";
import { updateLearningSignal } from "./learning-profile";
import { resultsReleased } from "./result-release";
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
  marks: Array<{ questionId: string; verdict: string; explanation: string; score: number | null; gap: string | null }>;
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

export class MarkingFailedError extends Error {
  constructor() {
    super("Marking could not be completed.");
    this.name = "MarkingFailedError";
  }
}

export async function markAndPersistSubmission(input: PipelineInput): Promise<SubmitOutcome> {
  const { assignment, classRow, learnerId, sessionId, questions, answers } = input;
  const markingMode = assignment.markingMode ?? "auto";
  const clampScore = (value: number | null) => (value === null ? null : Math.max(0, Math.min(100, Math.round(value))));

  // AUTO: Gemini marks every question immediately (existing behaviour).
  // SELECTIVE: indices in autoMarkQuestions go to Gemini; the rest are held
  // for the teacher. MANUAL: everything is held for the teacher.
  let marks: Array<{ questionId: string; verdict: string; explanation: string; score: number | null; gap: string | null }>;
  let markingStatus: string = "MARKED";
  let score = 0;
  let overallVerdict = "PENDING_REVIEW";
  let feedback = "Held for teacher review.";
  let remediation: NonNullable<MarkingResult["remediation"]> | null = null;

  const assessmentGuide = await assessmentGuideForClass(classRow);
  try {
    if (markingMode === "auto") {
      const marking = await markAssignment({ subject: assignment.subject, topic: assignment.topic, questions, answers, assessmentGuide });
      marks = marking.marks.slice(0, questions.length).map((mark) => ({ ...mark, gap: mark.gap ?? null, score: Math.max(0, Math.min(100, Math.round(mark.score))) }));
      score = Math.max(0, Math.min(100, Math.round(marking.score)));
      overallVerdict = marking.overallVerdict;
      feedback = marking.feedback;
      remediation = marking.remediation;
    } else {
      const autoSet = new Set(markingMode === "manual" ? [] : (assignment.autoMarkQuestions ?? []));
      const heldForTeacher = questions.map((question, index) => ({ question, index })).filter((entry) => !autoSet.has(entry.index));
      const autoSubset = questions.filter((_, index) => autoSet.has(index));
      let autoMarking: MarkingResult | null = null;
      if (autoSubset.length) {
        const autoAnswers = autoSubset.map((question) => answers.find((entry) => entry.questionId === question.id) ?? { questionId: question.id, answer: "" });
        autoMarking = await markAssignment({ subject: assignment.subject, topic: assignment.topic, questions: autoSubset, answers: autoAnswers, assessmentGuide });
      }
      marks = questions.map((question, index) => {
        if (heldForTeacher.some((entry) => entry.question.id === question.id)) {
          return { questionId: question.id, verdict: "PENDING_TEACHER_REVIEW", explanation: "Held for teacher marking.", score: null, gap: null };
        }
        const entry = autoMarking?.marks.find((mark) => mark.questionId === question.id);
        return {
          questionId: question.id,
          verdict: entry?.verdict ?? "PENDING_TEACHER_REVIEW",
          explanation: entry?.explanation ?? "",
          score: entry ? clampScore(entry.score) : null,
          gap: entry?.gap ?? null,
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
    marks = questions.map((question) => ({
      questionId: question.id,
      verdict: "PENDING_TEACHER_REVIEW",
      explanation: "Marking is delayed. Your answers are saved and will be marked automatically.",
      score: null,
      gap: null,
    }));
    score = 0;
    overallVerdict = "PENDING_REVIEW";
    feedback = "Marking is delayed. Your answers are saved and will be marked automatically.";
    remediation = null;
  }

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
  }).returning();

  const heldForReview = Boolean(input.autoSubmitted);
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
    const statusMessage = heldForReview
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
