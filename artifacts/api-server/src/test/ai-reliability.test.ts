import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { db } from "@workspace/db";
import { submissionsTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { ensureSchemaReady, resetDatabase, startTestServer, stopTestServer } from "./harness";
import { createPublishedAssignment, joinClass, memoAwareMarkingModel, registerLearner, registerTeacher, submitAssignment, SAMPLE_QUESTIONS } from "./fixtures";
import {
  GeminiUnavailableError,
  markAssignment,
  markRemediation,
  setGeminiModelForTesting,
  setGeminiSleepForTesting,
} from "../lib/ai";

const answers = SAMPLE_QUESTIONS.map((question) => ({ questionId: question.id, answer: question.answer }));

// A model whose generateContent always rejects, so every retry fails.
function alwaysFails(message = "upstream unavailable") {
  return { generateContent: async () => { throw new Error(message); } } as any;
}

describe("Gemini reliability (unit)", () => {
  let sleeps: number[] = [];
  beforeAll(() => { setGeminiSleepForTesting(async (ms) => { sleeps.push(ms); }); });
  afterAll(() => { setGeminiModelForTesting(null); setGeminiSleepForTesting(null); });
  beforeEach(() => { sleeps = []; });

  it("retries twice with exponential backoff, then reports the model unavailable", async () => {
    let attempts = 0;
    setGeminiModelForTesting({ generateContent: async () => { attempts += 1; throw new Error("boom"); } } as any);
    await expect(markAssignment({ subject: "Mathematics", topic: "Fractions", questions: SAMPLE_QUESTIONS, answers }))
      .rejects.toBeInstanceOf(GeminiUnavailableError);
    // 1 initial attempt + 2 retries.
    expect(attempts).toBe(3);
    // Backoff doubles: 2s, then 4s.
    expect(sleeps).toEqual([2000, 4000]);
  });

  it("recovers on a later attempt without throwing", async () => {
    let attempts = 0;
    setGeminiModelForTesting({
      generateContent: async () => {
        attempts += 1;
        if (attempts < 3) throw new Error("transient");
        return { response: { text: () => JSON.stringify({
          score: 100, overallVerdict: "CORRECT", feedback: "ok",
          marks: [{ questionId: "q1", verdict: "CORRECT", explanation: "ok", score: 100, gap: null }],
          remediation: null,
        }) } };
      },
    } as any);
    const result = await markAssignment({ subject: "Mathematics", topic: "Fractions", questions: [SAMPLE_QUESTIONS[0]], answers: [answers[0]] });
    expect(result.score).toBe(100);
    expect(attempts).toBe(3);
    expect(sleeps).toEqual([2000, 4000]);
  });

  it("treats a slow call as a failure and retries it", async () => {
    let attempts = 0;
    setGeminiModelForTesting({
      generateContent: async () => {
        attempts += 1;
        if (attempts === 1) {
          // Never resolves: the 30s call timeout must fire. The test clock is
          // faked down to a few milliseconds so the suite stays fast.
          return new Promise(() => {}) as any;
        }
        return { response: { text: () => JSON.stringify({ correct: true, feedback: "ok", score: 100 }) } };
      },
    } as any);
    const originalTimeout = globalThis.setTimeout;
    // Cap every timer to 20ms so the real 30s call timeout fires immediately.
    (globalThis as { setTimeout: typeof setTimeout }).setTimeout = ((...args: Parameters<typeof setTimeout>) =>
      originalTimeout(args[0], Math.min(Number(args[1]) || 0, 20), ...(args.slice(2) as []))) as typeof setTimeout;
    try {
      const result = await markRemediation({ concept: "Addition", format: "QUIZ", prompt: "1+1?", expectedAnswer: "2", answer: "2" });
      expect(result.correct).toBe(true);
      expect(attempts).toBe(2);
    } finally {
      (globalThis as any).setTimeout = originalTimeout;
    }
  });

  it("reports the last upstream error message in the unavailable error", async () => {
    setGeminiModelForTesting(alwaysFails("rate limited")) ;
    await expect(markRemediation({ concept: "Addition", format: "QUIZ", prompt: "1+1?", expectedAnswer: "2", answer: "2" }))
      .rejects.toThrow("rate limited");
  });
});

describe("marking failure path (integration)", () => {
  beforeAll(async () => {
    await startTestServer();
    await ensureSchemaReady();
    setGeminiSleepForTesting(async () => {});
  });
  afterAll(async () => {
    await stopTestServer();
    setGeminiModelForTesting(null);
    setGeminiSleepForTesting(null);
  });
  beforeEach(async () => { await resetDatabase(); });

  it("saves the submission as MARKING_FAILED instead of losing the work, then recovers on the teacher's next view", async () => {
    // First: Gemini is down, so the submission must still be saved.
    setGeminiModelForTesting(alwaysFails());
    const { client: teacher, classes } = await registerTeacher();
    const { assignmentId } = await createPublishedAssignment(teacher, classes[0].id, { markingMode: "auto" });
    const { client: learner } = await registerLearner();
    await joinClass(learner, classes[0].joinCode);
    const submitted = await submitAssignment(learner, assignmentId, answers);
    // The learner's work is accepted and saved; only the marking is delayed.
    expect(submitted.status).toBe(200);
    expect(submitted.body.markingStatus).toBe("MARKING_FAILED");
    expect(submitted.body.score).toBeNull();
    expect(submitted.body.released).toBe(false);
    const [stored] = await db.select().from(submissionsTable).where(eq(submissionsTable.assignmentId, assignmentId)).limit(1);
    expect(stored.markingStatus).toBe("MARKING_FAILED");
    // The answers themselves are intact.
    expect(stored.answers).toHaveLength(answers.length);

    // Then: Gemini recovers, and the teacher's next view of the class re-marks
    // it. The re-marker works from the memorandum, so the mock must answer the
    // memo prompt.
    setGeminiModelForTesting(memoAwareMarkingModel({ ratio: 1 }));
    const overview = await teacher.get(`/api/tis/classes/${classes[0].id}/overview`);
    expect(overview.status).toBe(200);
    const [recovered] = await db.select().from(submissionsTable).where(eq(submissionsTable.assignmentId, assignmentId)).limit(1);
    expect(recovered.markingStatus).toBe("MARKED");
    expect(recovered.score).toBe(100);

    // And the learner can see the result once the teacher releases it.
    await teacher.post(`/api/tis/assignments/${assignmentId}/release-results`, { action: "release" });
    const review = await learner.get(`/api/assignments/${assignmentId}/review`);
    expect(review.status).toBe(200);
    expect(review.body.score).toBe(100);
  });

  it("keeps the failed submission hidden from the learner until it is marked", async () => {
    setGeminiModelForTesting(alwaysFails());
    const { client: teacher, classes } = await registerTeacher();
    const { assignmentId } = await createPublishedAssignment(teacher, classes[0].id, { markingMode: "auto" });
    const { client: learner } = await registerLearner();
    await joinClass(learner, classes[0].joinCode);
    await submitAssignment(learner, assignmentId, answers);
    // Release alone is not enough: nothing is marked yet, so there is no result
    // to show and the script stays locked.
    await teacher.post(`/api/tis/assignments/${assignmentId}/release-results`, { action: "release" });
    const review = await learner.get(`/api/assignments/${assignmentId}/review`);
    expect(review.status).toBe(403);
    expect((await learner.get("/api/dashboard/summary")).body.averageScore).toBe(0);
  });
});
