import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { db } from "@workspace/db";
import { assignmentsTable, assignmentSessionsTable, classesTable, submissionsTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { ensureSchemaReady, resetDatabase, startTestServer, stopTestServer } from "./harness";
import { createPublishedAssignment, joinClass, registerLearner, registerTeacher } from "./fixtures";

// The other half of the auto-submit fix: when PERSISTENCE itself fails, the
// attempt must not stay claimed. Before the fix the session kept
// focusAutoSubmittedAt while no submission existed, so the learner saw
// "auto-submitted" with no paper and could never hand one in.
//
// The pipeline is mocked here so a failure can be forced deterministically; the
// session row and the claim/release SQL are the real thing.

vi.mock("../lib/submission-pipeline", () => ({
  markAndPersistSubmission: vi.fn(),
}));

const { markAndPersistSubmission } = await import("../lib/submission-pipeline");
const { autoSubmitAttempt } = await import("../lib/focus-mode");

describe("focus auto-submit failure handling", () => {
  beforeAll(async () => {
    await startTestServer();
    await ensureSchemaReady();
  });
  afterAll(async () => { await stopTestServer(); });
  beforeEach(async () => {
    await resetDatabase();
    vi.mocked(markAndPersistSubmission).mockReset();
  });

  async function attempt() {
    const teacher = await registerTeacher();
    const learner = await registerLearner();
    await joinClass(learner.client, teacher.classes[0].joinCode);
    const { assignmentId } = await createPublishedAssignment(teacher.client, teacher.classes[0].id);
    const opened = await learner.client.post(`/api/assignments/${assignmentId}/open`, {});
    const [session] = await db.select().from(assignmentSessionsTable).where(eq(assignmentSessionsTable.id, opened.body.sessionId));
    const [assignment] = await db.select().from(assignmentsTable).where(eq(assignmentsTable.id, assignmentId));
    const [classRow] = await db.select().from(classesTable).where(eq(classesTable.id, assignment.classId!));
    return { learner, session, assignment, classRow };
  }

  const reload = (id: string) =>
    db.select().from(assignmentSessionsTable).where(eq(assignmentSessionsTable.id, id)).then((rows) => rows[0]);

  it("releases the claim and reports FAILED when nothing was persisted", async () => {
    const { session, assignment, classRow } = await attempt();
    vi.mocked(markAndPersistSubmission).mockRejectedValue(new Error("insert blew up"));

    const result = await autoSubmitAttempt({ learnerId: session.learnerId, session, assignment, classRow, reason: "FOCUS_EXIT_LIMIT" });

    expect(result).toEqual({ outcome: "FAILED", error: "insert blew up", submissionId: null });
    // The attempt is open again: a later retry can still save the paper.
    const after = await reload(session.id);
    expect(after.focusAutoSubmittedAt).toBeNull();
  });

  it("reports SUBMITTED and keeps the claim when the pipeline saved the paper", async () => {
    const { session, assignment, classRow } = await attempt();
    // The pipeline persisted a row and then a later step threw. The learner's
    // work is safe, so the claim must stay.
    vi.mocked(markAndPersistSubmission).mockImplementation(async () => {
      await db.insert(submissionsTable).values({
        assignmentId: assignment.id,
        learnerId: session.learnerId,
        sessionId: session.id,
        score: 0,
        overallVerdict: "PENDING_REVIEW",
        feedback: "",
        marks: [],
        answers: [],
        markingStatus: "MARKING_FAILED",
      }).returning();
      throw new Error("failed after insert");
    });

    const result = await autoSubmitAttempt({ learnerId: session.learnerId, session, assignment, classRow, reason: "FOCUS_EXIT_LIMIT" });

    expect(result.outcome).toBe("SUBMITTED");
    const after = await reload(session.id);
    expect(after.focusAutoSubmittedAt).not.toBeNull();
  });

  it("is a no-op when the attempt is already submitted", async () => {
    const { session, assignment, classRow } = await attempt();
    const claimed = await reload(session.id);
    await db.update(assignmentSessionsTable).set({ focusAutoSubmittedAt: new Date() }).where(eq(assignmentSessionsTable.id, session.id));
    const result = await autoSubmitAttempt({ learnerId: claimed.learnerId, session: { ...claimed, focusAutoSubmittedAt: new Date() }, assignment, classRow, reason: "FOCUS_EXIT_LIMIT" });
    expect(result).toEqual({ outcome: "ALREADY_SUBMITTED", submissionId: null });
    expect(markAndPersistSubmission).not.toHaveBeenCalled();
  });
});
