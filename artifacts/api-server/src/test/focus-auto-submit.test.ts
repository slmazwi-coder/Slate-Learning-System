import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { db, pool } from "@workspace/db";
import { focusEventsTable, submissionsTable } from "@workspace/db/schema";
import { and, eq } from "drizzle-orm";
import { ensureSchemaReady, resetDatabase, startTestServer, stopTestServer } from "./harness";
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
});
