import { and, asc, eq, inArray, isNull, lt, or } from "drizzle-orm";
import { assignmentsTable, db, submissionsTable } from "@workspace/db";
import { remarkSubmissionInPlace } from "./remark";

// Marking reliability: when Gemini cannot mark a submission after every retry,
// the work is saved with markingStatus "MARKING_FAILED" rather than lost. This
// module re-marks those submissions from a background sweep or the next time a
// teacher opens the class, so the learner eventually gets a result.

// Re-run marking for one submission. Returns true when the submission was
// successfully marked. Never throws for an upstream Gemini failure — the caller
// (a background sweep) must keep going — so failures are reported as false.
export async function retrySubmissionMarking(submissionId: string): Promise<boolean> {
  const [submission] = await db.select().from(submissionsTable).where(eq(submissionsTable.id, submissionId)).limit(1);
  if (!submission || submission.markingStatus !== "MARKING_FAILED") return false;
  const [assignment] = await db.select({ markingMode: assignmentsTable.markingMode }).from(assignmentsTable).where(eq(assignmentsTable.id, submission.assignmentId)).limit(1);
  if (!assignment) return false;
  // Legacy failures from selective papers must never be retried as fully AI
  // marked work. Leave their pending questions for the teacher.
  if ((assignment.markingMode ?? "auto") !== "auto") {
    await db.update(submissionsTable).set({ markingStatus: "PENDING_TEACHER_REVIEW", markingLeaseUntil: null })
      .where(and(eq(submissionsTable.id, submissionId), eq(submissionsTable.markingStatus, "MARKING_FAILED"), or(isNull(submissionsTable.markingLeaseUntil), lt(submissionsTable.markingLeaseUntil, new Date()))));
    return false;
  }
  const [claimed] = await db.update(submissionsTable).set({ markingLeaseUntil: new Date(Date.now() + 120_000) })
    .where(and(eq(submissionsTable.id, submissionId), eq(submissionsTable.markingStatus, "MARKING_FAILED"), or(isNull(submissionsTable.markingLeaseUntil), lt(submissionsTable.markingLeaseUntil, new Date())))).returning({ id: submissionsTable.id });
  if (!claimed) return false;
  // Delegates to the shared re-marker so a recovered paper is marked exactly
  // like a fresh one (memo-aware when the assignment has a confirmed memo).
  try { return (await remarkSubmissionInPlace(submissionId)) === "REMARKED"; }
  finally { await db.update(submissionsTable).set({ markingLeaseUntil: null }).where(eq(submissionsTable.id, submissionId)); }
}

// Retry one paper per class view so provider delays stay within the function budget.
export async function retryFailedMarkingForLearners(learnerIds: string[]): Promise<number> {
  if (!learnerIds.length) return 0;
  const failed = await db
    .select({ id: submissionsTable.id })
    .from(submissionsTable)
    .where(and(inArray(submissionsTable.learnerId, learnerIds), eq(submissionsTable.markingStatus, "MARKING_FAILED"), or(isNull(submissionsTable.markingLeaseUntil), lt(submissionsTable.markingLeaseUntil, new Date()))))
    .orderBy(asc(submissionsTable.submittedAt))
    .limit(1);
  let marked = 0;
  for (const row of failed) {
    if (await retrySubmissionMarking(row.id)) marked += 1;
  }
  return marked;
}
