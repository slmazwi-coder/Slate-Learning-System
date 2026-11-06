import { and, eq, inArray } from "drizzle-orm";
import { db, submissionsTable } from "@workspace/db";
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
  // Delegates to the shared re-marker so a recovered paper is marked exactly
  // like a fresh one (memo-aware when the assignment has a confirmed memo).
  return (await remarkSubmissionInPlace(submissionId)) === "REMARKED";
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
