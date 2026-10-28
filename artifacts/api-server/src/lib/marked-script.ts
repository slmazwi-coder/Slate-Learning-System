import { and, desc, eq } from "drizzle-orm";
import {
  assignmentSessionsTable,
  assignmentsTable,
  classLearnersTable,
  classesTable,
  db,
  learnersTable,
  markingResultsTable,
  submissionsTable,
} from "@workspace/db";
import type { GeneratedQuestion } from "./ai";
import { gradeName } from "./presets";

type Mark = {
  questionId: string;
  verdict: string;
  explanation: string;
  score: number | null;
  gap: string | null;
  questionNumber?: string;
  awardedMarks?: number | null;
  maxMarks?: number | null;
};

function classLabel(row: Pick<typeof classesTable.$inferSelect, "grade" | "section" | "subject">) {
  return `${gradeName(row.grade)}${row.section} · ${row.subject}`;
}

// Builds the full, read-only marked script for one submission: the question as
// it was uniquely presented to that learner, their answer, the verdict, the
// correct answer, the score and the marking comment/AI feedback. Shared by the
// learner review, the teacher submission list and the parent child view.
export async function buildMarkedScript(submission: typeof submissionsTable.$inferSelect, options: { editable?: boolean } = {}) {
  const [assignment] = await db.select().from(assignmentsTable).where(eq(assignmentsTable.id, submission.assignmentId)).limit(1);
  if (!assignment) return null;
  const [learner] = await db.select().from(learnersTable).where(eq(learnersTable.id, submission.learnerId)).limit(1);
  if (!learner) return null;
  const [session] = await db.select().from(assignmentSessionsTable).where(eq(assignmentSessionsTable.id, submission.sessionId)).limit(1);
  const questions = (session?.questions as GeneratedQuestion[] | undefined) ?? [];
  const marks = (submission.marks as Mark[]) ?? [];
  const answers = submission.answers ?? [];
  // Per-question marking detail: the marks out of max, the derived expected
  // answer and the reason. The derived answer and reason are teacher-only, so
  // the caller decides whether to pass them on.
  const markingRows = await db.select().from(markingResultsTable).where(eq(markingResultsTable.submissionId, submission.id));
  const markingByNumber = new Map(markingRows.map((row) => [row.questionNumber, row]));

  let classRow: typeof classesTable.$inferSelect | null = null;
  if (assignment.classId) {
    const [row] = await db.select().from(classesTable).where(eq(classesTable.id, assignment.classId)).limit(1);
    classRow = row ?? null;
  }

  // How the paper was marked, for the print footer: "AI" against the teacher's
  // memo, "TEACHER" by hand, or "MIXED".
  const markedByValues = [...new Set(markingRows.map((row) => row.markedBy))];
  const markedBy = markingRows.length === 0
    ? "AI"
    : markedByValues.length > 1
      ? "MIXED"
      : markedByValues[0];

  return {
    submissionId: submission.id,
    assignment: {
      id: assignment.id,
      title: assignment.title,
      subject: assignment.subject,
      topic: assignment.topic,
      questionCount: assignment.questionCount,
      schoolName: classRow?.schoolName ?? null,
    },
    learner: {
      id: learner.id,
      fullName: learner.fullName,
      username: learner.username,
      grade: learner.grade,
      slateId: learner.slateId,
    },
    class: classRow ? { id: classRow.id, label: classLabel(classRow), schoolName: classRow.schoolName } : null,
    score: submission.score,
    overallVerdict: submission.overallVerdict,
    feedback: submission.feedback,
    markingStatus: submission.markingStatus,
    submittedAt: submission.submittedAt.toISOString(),
    // Papers the learner did not get to finish normally: focus-mode auto-submits
    // and teacher reopenings are called out on the printed script.
    autoSubmitted: submission.autoSubmitted,
    reopenedAt: submission.reopenedAt ? submission.reopenedAt.toISOString() : null,
    resultsHeldForReview: Boolean(submission.resultsHeldForReview),
    markedBy,
    totalAwarded: marks.reduce((total, mark) => total + (mark.awardedMarks ?? 0), 0),
    totalMarks: marks.reduce((total, mark) => total + (mark.maxMarks ?? 0), 0),
    editable: Boolean(options.editable),
    questions: questions.map((question, index) => {
      const mark = marks.find((entry) => entry.questionId === question.id);
      const learnerAnswer = answers.find((entry) => entry.questionId === question.id)?.answer ?? null;
      const questionNumber = question.questionNumber?.trim() || mark?.questionNumber?.trim() || `${index + 1}`;
      const marking = markingByNumber.get(questionNumber);
      const maxMarks = question.marks ?? mark?.maxMarks ?? null;
      return {
        questionId: question.id,
        questionNumber,
        prompt: question.prompt,
        type: question.type,
        options: question.options ?? [],
        concept: question.concept,
        marks: maxMarks,
        learnerAnswer,
        verdict: mark?.verdict ?? null,
        score: mark?.score ?? null,
        awardedMarks: mark?.awardedMarks ?? null,
        correctAnswer: question.answer,
        explanation: mark?.explanation ?? "",
        gap: mark?.gap ?? null,
        // Teacher-only: what the marker expected for this learner's variant and
        // why it awarded what it did.
        derivedExpectedAnswer: marking?.derivedExpectedAnswer ?? "",
        reason: marking?.reason ?? "",
        needsTeacherReview: marking?.needsTeacherReview ?? false,
        markedBy: marking?.markedBy ?? null,
      };
    }),
  };
}

export type MarkedScript = NonNullable<Awaited<ReturnType<typeof buildMarkedScript>>>;

// The learner's most recent submission for an assignment (used by review).
export async function submissionForLearner(assignmentId: string, learnerId: string) {
  const [submission] = await db
    .select()
    .from(submissionsTable)
    .where(and(eq(submissionsTable.assignmentId, assignmentId), eq(submissionsTable.learnerId, learnerId)))
    .orderBy(desc(submissionsTable.submittedAt))
    .limit(1);
  return submission ?? null;
}

// A teacher may only review submissions for classes they own.
export async function teacherOwnsSubmission(teacherId: string, submission: typeof submissionsTable.$inferSelect) {
  const [assignment] = await db.select({ classId: assignmentsTable.classId }).from(assignmentsTable).where(eq(assignmentsTable.id, submission.assignmentId)).limit(1);
  if (!assignment?.classId) return false;
  const [row] = await db
    .select({ id: classesTable.id })
    .from(classesTable)
    .where(and(eq(classesTable.id, assignment.classId), eq(classesTable.teacherId, teacherId)))
    .limit(1);
  return Boolean(row);
}

// A teacher may only review learners enrolled in one of their own classes.
export async function teacherTeachesLearner(teacherId: string, learnerId: string) {
  const [row] = await db
    .select({ id: classLearnersTable.id })
    .from(classLearnersTable)
    .innerJoin(classesTable, eq(classesTable.id, classLearnersTable.classId))
    .where(and(eq(classLearnersTable.learnerId, learnerId), eq(classesTable.teacherId, teacherId)))
    .limit(1);
  return Boolean(row);
}

export async function submissionById(submissionId: string) {
  const [submission] = await db.select().from(submissionsTable).where(eq(submissionsTable.id, submissionId)).limit(1);
  return submission ?? null;
}
