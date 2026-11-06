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
// session row and the claim/lease SQL are the real thing.

vi.mock("../lib/submission-pipeline", () => ({
  markAndPersistSubmission: vi.fn(),
}));

const { markAndPersistSubmission } = await import("../lib/submission-pipeline");
const { autoSubmitAttempt, focusAutoSubmitStateOf, autoSubmitDue, FOCUS_AUTO_SUBMIT_MAX_ATTEMPTS } = await import("../lib/focus-mode");

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

  it("moves the attempt to FAILED with a retryable error code when nothing was persisted", async () => {
    const { session, assignment, classRow } = await attempt();
    vi.mocked(markAndPersistSubmission).mockRejectedValue(new Error("insert blew up"));

    const result = await autoSubmitAttempt({ learnerId: session.learnerId, session, assignment, classRow, reason: "FOCUS_EXIT_LIMIT" });

    expect(result).toEqual({
      outcome: "FAILED",
      error: "insert blew up",
      errorCode: "PERSIST_FAILED",
      attempts: 1,
      retryable: true,
      submissionId: null,
    });
    // The attempt is recoverable: FAILED, no paper, still due, tries remaining.
    const after = await reload(session.id);
    expect(focusAutoSubmitStateOf(after)).toBe("FAILED");
    expect(after.focusSubmissionId).toBeNull();
    expect(after.focusAutoSubmitLastError).toBe("PERSIST_FAILED");
    expect(after.focusAutoSubmitLeaseUntil).toBeNull();
    expect(autoSubmitDue(after).due).toBe(true);
  });

  it("keeps the deadline on failure so the sweep still retries it", async () => {
    const { session, assignment, classRow } = await attempt();
    const deadline = new Date(Date.now() - 60_000);
    await db.update(assignmentSessionsTable).set({ focusDeadlineAt: deadline }).where(eq(assignmentSessionsTable.id, session.id));
    const refreshed = await reload(session.id);
    vi.mocked(markAndPersistSubmission).mockRejectedValue(new Error("insert blew up"));

    await autoSubmitAttempt({ learnerId: session.learnerId, session: refreshed, assignment, classRow, reason: "FOCUS_AWAY_TIMEOUT" });

    const after = await reload(session.id);
    expect(after.focusDeadlineAt?.getTime()).toBe(deadline.getTime());
  });

  it("reports SUBMITTED and marks the attempt DONE when the pipeline saved the paper", async () => {
    const { session, assignment, classRow } = await attempt();
    // The pipeline persisted a row and then a later step threw. The learner's
    // work is safe, so the attempt is done rather than retried.
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
    expect(focusAutoSubmitStateOf(after)).toBe("DONE");
    expect(after.focusSubmissionId).toBeTruthy();
  });

  it("treats a stranded attempt (timestamp but no paper) as retryable, not submitted", async () => {
    const { session, assignment, classRow } = await attempt();
    // The exact state the old claim could leave behind: focusAutoSubmittedAt set
    // with no submission row anywhere.
    await db.update(assignmentSessionsTable).set({ focusAutoSubmittedAt: new Date() }).where(eq(assignmentSessionsTable.id, session.id));
    const stranded = await reload(session.id);
    expect(focusAutoSubmitStateOf(stranded)).toBe("FAILED");
    expect(autoSubmitDue(stranded).due).toBe(true);

    vi.mocked(markAndPersistSubmission).mockResolvedValue({
      submissionId: "11111111-1111-1111-1111-111111111111",
      score: null, overallVerdict: null, feedback: null, marks: [], markingStatus: "MARKING_FAILED", released: false, remediation: null,
    } as never);
    const result = await autoSubmitAttempt({ learnerId: session.learnerId, session: stranded, assignment, classRow, reason: "FOCUS_EXIT_LIMIT" });

    expect(result.outcome).toBe("SUBMITTED");
    expect(markAndPersistSubmission).toHaveBeenCalledTimes(1);
    const after = await reload(session.id);
    expect(after.focusSubmissionId).toBe("11111111-1111-1111-1111-111111111111");
  });

  it("stops retrying once the attempt limit is reached and reports a non-retryable failure", async () => {
    const { session, assignment, classRow } = await attempt();
    await db.update(assignmentSessionsTable)
      .set({ focusAutoSubmitState: "FAILED", focusAutoSubmitAttempts: FOCUS_AUTO_SUBMIT_MAX_ATTEMPTS, focusAutoSubmitLastError: "GEMINI_UNAVAILABLE" })
      .where(eq(assignmentSessionsTable.id, session.id));
    const exhausted = await reload(session.id);

    const result = await autoSubmitAttempt({ learnerId: session.learnerId, session: exhausted, assignment, classRow, reason: "FOCUS_EXIT_LIMIT" });

    expect(result.outcome).toBe("FAILED");
    if (result.outcome === "FAILED") {
      expect(result.retryable).toBe(false);
      expect(result.errorCode).toBe("GEMINI_UNAVAILABLE");
    }
    // No further pipeline call is made once the limit is reached.
    expect(markAndPersistSubmission).not.toHaveBeenCalled();
  });

  it("does not start a second attempt while a live lease is held", async () => {
    const { session, assignment, classRow } = await attempt();
    await db.update(assignmentSessionsTable).set({
      focusAutoSubmitState: "PROCESSING",
      focusAutoSubmitLeaseUntil: new Date(Date.now() + 60_000),
      focusAutoSubmitAttempts: 1,
    }).where(eq(assignmentSessionsTable.id, session.id));
    const processing = await reload(session.id);

    const result = await autoSubmitAttempt({ learnerId: session.learnerId, session: processing, assignment, classRow, reason: "FOCUS_EXIT_LIMIT" });

    expect(result.outcome).toBe("PROCESSING");
    expect(markAndPersistSubmission).not.toHaveBeenCalled();
  });
});
