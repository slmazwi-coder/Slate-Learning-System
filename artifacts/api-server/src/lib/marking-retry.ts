import { and, eq, inArray } from "drizzle-orm";
import {
  assignmentSessionsTable,
  assignmentsTable,
  db,
  remediationActivitiesTable,
  submissionsTable,
} from "@workspace/db";
import { GeminiUnavailableError, markAssignment, type GeneratedQuestion, type MarkingResult } from "./ai";
import { assessmentGuideForClass } from "./presets";

// Marking reliability: when Gemini cannot mark a submission after every retry,
// the work is saved with markingStatus "MARKING_FAILED" rather than lost. This
// module re-marks those submissions from a background sweep or the next time a
// teacher opens the class, so the learner eventually gets a result.

type Mark = { questionId: string; verdict: string; explanation: string; score: number | null; gap: string | null };

function clampScore(value: number | null) {
  return value === null ? null : Math.max(0, Math.min(100, Math.round(value)));
}

// Re-run marking for one submission. Returns true when the submission was
// successfully marked. Never throws for an upstream Gemini failure — the caller
// (a background sweep) must keep going — so failures are reported as false.
export async function retrySubmissionMarking(submissionId: string): Promise<boolean> {
  const [submission] = await db.select().from(submissionsTable).where(eq(submissionsTable.id, submissionId)).limit(1);
  if (!submission || submission.markingStatus !== "MARKING_FAILED") return false;
  const [assignment] = await db.select().from(assignmentsTable).where(eq(assignmentsTable.id, submission.assignmentId)).limit(1);
  if (!assignment) return false;
  const [session] = await db.select({ questions: assignmentSessionsTable.questions })
    .from(assignmentSessionsTable)
    .where(eq(assignmentSessionsTable.id, submission.sessionId))
    .limit(1);
  const questions = (session?.questions as GeneratedQuestion[] | undefined) ?? [];
  if (!questions.length) return false;
  const answers = (submission.answers as Array<{ questionId: string; answer: string }>) ?? [];
  try {
    const guide = await assessmentGuideForClass(null);
    const marking: MarkingResult = await markAssignment({
      subject: assignment.subject,
      topic: assignment.topic,
      questions,
      answers,
      assessmentGuide: guide,
    });
    const marks: Mark[] = marking.marks.slice(0, questions.length).map((mark) => ({
      ...mark,
      gap: mark.gap ?? null,
      score: clampScore(mark.score),
    }));
    const score = Math.max(0, Math.min(100, Math.round(marking.score)));
    await db.update(submissionsTable).set({
      marks,
      score,
      overallVerdict: marking.overallVerdict,
      feedback: marking.feedback,
      markingStatus: "MARKED",
    }).where(eq(submissionsTable.id, submission.id));
    if (marking.remediation) {
      const [existing] = await db.select({ id: remediationActivitiesTable.id })
        .from(remediationActivitiesTable)
        .where(and(
          eq(remediationActivitiesTable.assignmentId, assignment.id),
          eq(remediationActivitiesTable.learnerId, submission.learnerId),
        ))
        .limit(1);
      if (!existing) {
        await db.insert(remediationActivitiesTable).values({
          learnerId: submission.learnerId,
          assignmentId: assignment.id,
          format: marking.remediation.format,
          title: marking.remediation.title,
          concept: marking.remediation.concept,
          prompt: marking.remediation.prompt,
          options: marking.remediation.options ?? [],
          instruction: marking.remediation.instruction,
          expectedAnswer: marking.remediation.expectedAnswer,
        });
      }
    }
    return true;
  } catch (error) {
    if (error instanceof GeminiUnavailableError) return false;
    throw error;
  }
}

// Retry every failed submission for a set of learners (used when a teacher
// opens a class). Bounded so a bad Gemini day cannot stall the request.
export async function retryFailedMarkingForLearners(learnerIds: string[]): Promise<number> {
  if (!learnerIds.length) return 0;
  const failed = await db
    .select({ id: submissionsTable.id })
    .from(submissionsTable)
    .where(and(inArray(submissionsTable.learnerId, learnerIds), eq(submissionsTable.markingStatus, "MARKING_FAILED")))
    .limit(20);
  let marked = 0;
  for (const row of failed) {
    if (await retrySubmissionMarking(row.id)) marked += 1;
  }
  return marked;
}
