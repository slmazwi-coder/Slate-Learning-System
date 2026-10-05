import { eq } from "drizzle-orm";
import { assignmentsTable, assignmentSessionsTable, db, learnersTable, submissionsTable } from "@workspace/db";

export async function buildMarkedScript(submissionId: string) {
  const [submission] = await db
    .select()
    .from(submissionsTable)
    .where(eq(submissionsTable.id, submissionId))
    .limit(1);
  if (!submission) return null;

  const [[assignment], [learner], [session]] = await Promise.all([
    db.select().from(assignmentsTable).where(eq(assignmentsTable.id, submission.assignmentId)).limit(1),
    db.select().from(learnersTable).where(eq(learnersTable.id, submission.learnerId)).limit(1),
    db.select().from(assignmentSessionsTable).where(eq(assignmentSessionsTable.id, submission.sessionId)).limit(1),
  ]);
  if (!assignment || !learner || !session) return null;

  const questions = (session.questions as Array<{
    id: string;
    prompt: string;
    type?: string;
    options?: string[];
    concept?: string;
    answer?: string;
  }> | undefined) ?? [];
  const answers = submission.answers ?? [];
  const marks = (submission.marks as Array<{
    questionId: string;
    verdict: string;
    explanation: string;
    score: number | null;
    gap: string | null;
  }>) ?? [];
  const released = submission.markingStatus === "MARKED" && (
    assignment.resultReleasePolicy !== "after_close" || new Date() >= assignment.closeAt
  );

  return {
    submission: {
      id: submission.id,
      submittedAt: submission.submittedAt.toISOString(),
      score: submission.score,
      overallVerdict: submission.overallVerdict,
      feedback: submission.feedback,
      markingStatus: submission.markingStatus,
      released,
    },
    assignment: {
      id: assignment.id,
      title: assignment.title,
      subject: assignment.subject,
      topic: assignment.topic,
      closeAt: assignment.closeAt.toISOString(),
    },
    learner: {
      id: learner.id,
      fullName: learner.fullName,
      username: learner.username,
    },
    questions: questions.map((question, index) => {
      const mark = marks.find((entry) => entry.questionId === question.id);
      return {
        index,
        questionId: question.id,
        prompt: question.prompt,
        type: question.type ?? "text",
        options: question.options ?? [],
        concept: question.concept ?? assignment.topic,
        learnerAnswer: answers.find((entry) => entry.questionId === question.id)?.answer ?? "",
        verdict: mark?.verdict ?? null,
        score: mark?.score ?? null,
        correctAnswer: question.answer ?? "",
        explanation: mark?.explanation ?? "",
        gap: mark?.gap ?? null,
      };
    }),
  };
}