import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { db, pool } from "@workspace/db";
import { focusEventsTable, assignmentSessionsTable, submissionsTable } from "@workspace/db/schema";
import { and, eq } from "drizzle-orm";
import { ensureSchemaReady, resetDatabase, startTestServer, stopTestServer, sweepCron } from "./harness";
import { createPublishedAssignment, joinClass, memoAwareMarkingModel, registerLearner, registerTeacher } from "./fixtures";
import { setGeminiModelForTesting } from "../lib/ai";
import { FOCUS_MAX_WARNINGS } from "../lib/focus-mode";

// Focus-mode auto-submission reliability.
//
// The bug this pins: auto-submit claimed the attempt (set focusAutoSubmittedAt)
// BEFORE it persisted the paper, and swallowed any error. A marking failure that
// was not a GeminiUnavailableError — for example a malformed model response —
// therefore reported "submitted", created no submission, and left the attempt
// permanently claimed: the learner's work was lost and the manual submit route
// refused the paper as "already submitted".
//
// The fix has two halves, both covered here and in focus-auto-submit-failure:
//   1. the AI layer reports an unusable marking response as a retryable marking
//      failure, so the paper is persisted as MARKING_FAILED (never discarded);
//   2. if persistence itself still fails, the claim is released so the attempt
//      stays open and is retried.

const MARKING_PROMPT = "Mark this learner's answers";

// A model whose marking reply is unusable JSON. With the AI-layer fix this
// surfaces as GeminiUnavailableError, so the pipeline saves the work as
// MARKING_FAILED instead of throwing it away.
function malformedMarkingModel() {
  return {
    generateContent: async (parts: Array<{ text?: string }>) => {
      const prompt = parts.map((part) => part.text ?? "").join("\n");
      if (prompt.includes(MARKING_PROMPT)) return { response: { text: () => "this is not json" } };
      return { response: { text: () => JSON.stringify({ items: [] }) } };
    },
  } as never;
}

describe("focus auto-submission reliability", () => {
  beforeAll(async () => {
    await startTestServer();
    await ensureSchemaReady();
  });
  afterAll(async () => {
    setGeminiModelForTesting(null);
    await stopTestServer();
  });
  beforeEach(async () => {
    setGeminiModelForTesting(null);
    await resetDatabase();
  });

  async function setup() {
    const teacher = await registerTeacher();
    const classId = teacher.classes[0].id;
    const learner = await registerLearner();
    await joinClass(learner.client, teacher.classes[0].joinCode);
    const { assignmentId, questions } = await createPublishedAssignment(teacher.client, classId);
    const opened = await learner.client.post(`/api/assignments/${assignmentId}/open`, {});
    expect(opened.status).toBe(200);
    return { teacher, classId, learner, assignmentId, questions, sessionId: opened.body.sessionId as string };
  }

  const left = (c: any, assignmentId: string, sessionId: string) =>
    c.post(`/api/assignments/${assignmentId}/focus/left`, { sessionId });
  const returned = (c: any, assignmentId: string, sessionId: string) =>
    c.post(`/api/assignments/${assignmentId}/focus/returned`, { sessionId });

  // Drive the attempt to the final-exit auto-submit without sleeping.
  async function forceExitLimit(learner: any, assignmentId: string, sessionId: string) {
    await left(learner.client, assignmentId, sessionId);
    await pool.query(`update slate_assignment_sessions set focus_away_since = now() - interval '10 minutes' where id = $1`, [sessionId]);
    await pool.query(`update slate_assignment_sessions set focus_warning_count = $2 where id = $1`, [sessionId, FOCUS_MAX_WARNINGS - 1]);
    return returned(learner.client, assignmentId, sessionId);
  }

  const submissionsFor = (assignmentId: string, learnerId: string) =>
    db.select().from(submissionsTable).where(and(
      eq(submissionsTable.assignmentId, assignmentId),
      eq(submissionsTable.learnerId, learnerId),
    ));

  it("auto-submits the paper through the normal pipeline on the final exit", async () => {
    const { learner, assignmentId, sessionId } = await setup();
    setGeminiModelForTesting(memoAwareMarkingModel());

    const auto = await forceExitLimit(learner, assignmentId, sessionId);

    expect(auto.body.autoSubmitted).toBe(true);
    expect(auto.body.submissionId).toBeTruthy();
    const rows = await submissionsFor(assignmentId, learner.learner.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].autoSubmitted).toBe(true);
    expect(rows[0].autoSubmitReason).toBe("FOCUS_EXIT_LIMIT");
    // A focus-mode paper is held until the teacher releases it.
    expect(rows[0].resultsHeldForReview).toBe(true);
  });

  it("links a successful auto-submission to its exit event", async () => {
    const { learner, assignmentId, sessionId } = await setup();
    const auto = await forceExitLimit(learner, assignmentId, sessionId);
    expect(auto.body.autoSubmitted).toBe(true);
    const events = await db.select().from(focusEventsTable).where(eq(focusEventsTable.sessionId, sessionId));
    const autoEvent = events.find((event) => event.outcome === "AUTO_SUBMITTED");
    expect(autoEvent).toBeTruthy();
    expect(autoEvent?.submissionId).toBe(auto.body.submissionId);
  });

  it("saves the learner's work as MARKING_FAILED when the marking response is unusable", async () => {
    const { learner, assignmentId, sessionId } = await setup();
    // The learner answered before focus mode ended the attempt.
    await learner.client.post(`/api/assignments/${assignmentId}/focus/answers`, {
      sessionId,
      answers: [{ questionId: "q1", answer: "4" }],
    });
    setGeminiModelForTesting(malformedMarkingModel());

    const auto = await forceExitLimit(learner, assignmentId, sessionId);

    // The paper exists, so this IS a submission — the work is never lost.
    expect(auto.body.autoSubmitted).toBe(true);
    const rows = await submissionsFor(assignmentId, learner.learner.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].markingStatus).toBe("MARKING_FAILED");
    // The learner's own answer is stored, ready for a later retry.
    expect(JSON.stringify(rows[0].answers)).toContain("4");
  });

  it("saves the learner's work as MARKING_FAILED when Gemini is unreachable", async () => {
    const { learner, assignmentId, sessionId } = await setup();
    setGeminiModelForTesting({
      generateContent: async () => { throw new Error("network down"); },
    } as never);

    const auto = await forceExitLimit(learner, assignmentId, sessionId);
    expect(auto.body.autoSubmitted).toBe(true);
    const rows = await submissionsFor(assignmentId, learner.learner.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].markingStatus).toBe("MARKING_FAILED");
    expect(rows[0].resultsHeldForReview).toBe(true);
  });

  it("never creates a second submission for the same attempt", async () => {
    const { learner, assignmentId, sessionId } = await setup();
    const auto = await forceExitLimit(learner, assignmentId, sessionId);
    expect(auto.body.autoSubmitted).toBe(true);

    // Every further touch reports the SAME paper rather than writing another.
    const again = await returned(learner.client, assignmentId, sessionId);
    expect(again.body.autoSubmitted).toBe(true);
    await learner.client.post(`/api/assignments/${assignmentId}/focus/heartbeat`, { sessionId });
    expect(await submissionsFor(assignmentId, learner.learner.id)).toHaveLength(1);

    // A manual submit is refused too, because a paper already exists.
    const manual = await learner.client.post(`/api/assignments/${assignmentId}/submit`, {
      sessionId,
      answers: [{ questionId: "q1", answer: "4" }],
    });
    expect(manual.status).toBeGreaterThanOrEqual(400);
    expect(await submissionsFor(assignmentId, learner.learner.id)).toHaveLength(1);
  });

  // ---- The explicit state machine ------------------------------------------
  // A boolean claim could not say "in flight" or "gave up". These tests pin the
  // replacement: PROCESSING with a lease, DONE with a submission id, FAILED with
  // the deadline kept, and the two sweepers that pick FAILED and stale PROCESSING
  // attempts back up.

  const sessionRow = (id: string) =>
    db.select().from(assignmentSessionsTable).where(eq(assignmentSessionsTable.id, id)).then((rows) => rows[0]);

  it("records DONE and the submission id on the session after a successful auto-submit", async () => {
    const { learner, assignmentId, sessionId } = await setup();
    setGeminiModelForTesting(memoAwareMarkingModel());

    const auto = await forceExitLimit(learner, assignmentId, sessionId);
    expect(auto.body.status).toBe("submitted");

    const after = await sessionRow(sessionId);
    expect(after.focusAutoSubmitState).toBe("DONE");
    expect(after.focusSubmissionId).toBe(auto.body.submissionId);
    expect(after.focusAutoSubmitLeaseUntil).toBeNull();
  });

  it("reports processing (not submitted) while a worker holds the lease", async () => {
    const { learner, assignmentId, sessionId } = await setup();
    // A lease held by another worker: no paper exists, so this must never be
    // reported to the learner as a submission.
    await pool.query(
      `update slate_assignment_sessions set focus_auto_submit_state = 'PROCESSING',
         focus_auto_submit_lease_until = now() + interval '5 minutes',
         focus_auto_submit_attempts = 1, focus_deadline_at = now() - interval '1 minute'
       where id = $1`,
      [sessionId],
    );

    const beat = await learner.client.post(`/api/assignments/${assignmentId}/focus/heartbeat`, { sessionId });
    expect(beat.body.autoSubmitted).toBe(false);
    expect(beat.body.status).toBe("processing");
    expect(beat.body.submissionId).toBeNull();
    expect(await submissionsFor(assignmentId, learner.learner.id)).toHaveLength(0);
  });

  it("treats a stale lease as a crashed worker and retries the submit", async () => {
    const { learner, assignmentId, sessionId } = await setup();
    setGeminiModelForTesting(memoAwareMarkingModel());
    // PROCESSING with an expired lease and a failed first attempt: the lazy check
    // on the heartbeat must pick it up and finish the job.
    await pool.query(
      `update slate_assignment_sessions set focus_auto_submit_state = 'PROCESSING',
         focus_auto_submit_lease_until = now() - interval '5 minutes',
         focus_auto_submit_attempts = 1, focus_deadline_at = now() - interval '1 minute'
       where id = $1`,
      [sessionId],
    );

    const beat = await learner.client.post(`/api/assignments/${assignmentId}/focus/heartbeat`, { sessionId });
    expect(beat.body.autoSubmitted).toBe(true);
    expect(beat.body.status).toBe("submitted");
    const after = await sessionRow(sessionId);
    expect(after.focusAutoSubmitState).toBe("DONE");
    expect(await submissionsFor(assignmentId, learner.learner.id)).toHaveLength(1);
  });

  it("recovers a stranded attempt (auto-submit timestamp, no paper) instead of refusing the learner", async () => {
    const { learner, assignmentId, sessionId } = await setup();
    setGeminiModelForTesting(memoAwareMarkingModel());
    // Exactly what the old claim left behind: the flag set, no submission.
    await pool.query(
      `update slate_assignment_sessions set focus_auto_submitted_at = now(),
         focus_auto_submit_state = 'DONE', focus_deadline_at = now() - interval '1 minute'
       where id = $1`,
      [sessionId],
    );

    const beat = await learner.client.post(`/api/assignments/${assignmentId}/focus/heartbeat`, { sessionId });
    expect(beat.body.autoSubmitted).toBe(true);
    expect(await submissionsFor(assignmentId, learner.learner.id)).toHaveLength(1);
  });

  it("picks up FAILED sessions in the cron sweep", async () => {
    const { learner, assignmentId, sessionId } = await setup();
    setGeminiModelForTesting(memoAwareMarkingModel());
    await pool.query(
      `update slate_assignment_sessions set focus_auto_submit_state = 'FAILED',
         focus_auto_submit_attempts = 1, focus_auto_submit_last_error = 'PERSIST_FAILED',
         focus_deadline_at = now() - interval '1 minute'
       where id = $1`,
      [sessionId],
    );

    const res = await sweepCron();
    expect(res.status).toBe(200);
    expect(res.body.submitted).toBeGreaterThanOrEqual(1);
    expect(await submissionsFor(assignmentId, learner.learner.id)).toHaveLength(1);
  });

  it("alerts the teacher once when an attempt has used every retry", async () => {
    const { learner, assignmentId, sessionId } = await setup();
    await pool.query(
      `update slate_assignment_sessions set focus_auto_submit_state = 'FAILED',
         focus_auto_submit_attempts = 5, focus_auto_submit_last_error = 'GEMINI_UNAVAILABLE',
         focus_deadline_at = now() - interval '1 minute'
       where id = $1`,
      [sessionId],
    );

    const first = await sweepCron();
    expect(first.status).toBe(200);
    expect(first.body.alerted).toBeGreaterThanOrEqual(1);
    // The alert fires once per attempt, not on every sweep.
    const second = await sweepCron();
    expect(second.body.alerted).toBe(0);
    expect(await submissionsFor(assignmentId, learner.learner.id)).toHaveLength(0);
  });
});
