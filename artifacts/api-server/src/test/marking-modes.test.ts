import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { client, ensureSchemaReady, resetDatabase, startTestServer, stopTestServer } from "./harness";
import { createPublishedAssignment, joinClass, registerLearner, registerTeacher, submitAssignment, SAMPLE_QUESTIONS } from "./fixtures";
import { setGeminiModelForTesting, setGeminiSleepForTesting } from "../lib/ai";

// Records every marking prompt so a test can prove which questions were sent to
// Gemini in each marking mode.
const markingPrompts: string[] = [];
function recordingModel() {
  return {
    generateContent: async (parts: Array<{ text?: string }>) => {
      const prompt = parts.map((part) => part.text ?? "").join("\n");
      if (prompt.includes("Mark this learner")) {
        markingPrompts.push(prompt);
        const ids = [...new Set([...prompt.matchAll(/"id"\s*:\s*"([^"]+)"/g)].map((match) => match[1]))];
        return { response: { text: () => JSON.stringify({
          score: 80,
          overallVerdict: "PARTIALLY_CORRECT",
          feedback: "Good effort.",
          marks: ids.map((id) => ({ questionId: id, verdict: "PARTIALLY_CORRECT", explanation: "Partly right.", score: 80, gap: null })),
          remediation: null,
        }) } };
      }
      // Question generation: return a valid draft so the AI-sourced path can
      // be exercised without a network call.
      return { response: { text: () => JSON.stringify([
        { id: "q1", prompt: "What is 2 + 2?", type: "text", options: [], concept: "Addition", answer: "4" },
      ]) } };
    },
  } as any;
}

const answers = SAMPLE_QUESTIONS.map((question) => ({ questionId: question.id, answer: question.answer }));

describe("marking modes", () => {
  beforeAll(async () => {
    await startTestServer();
    await ensureSchemaReady();
    setGeminiSleepForTesting(async () => {});
    setGeminiModelForTesting(recordingModel());
  });
  afterAll(async () => {
    await stopTestServer();
    setGeminiModelForTesting(null);
    setGeminiSleepForTesting(null);
  });
  beforeEach(async () => { await resetDatabase(); markingPrompts.length = 0; });

  it("auto-marks every question and releases the marks once the teacher does", async () => {
    const { client: teacher, classes } = await registerTeacher();
    const { assignmentId } = await createPublishedAssignment(teacher, classes[0].id, { markingMode: "auto" });
    const { client: learner } = await registerLearner();
    await joinClass(learner, classes[0].joinCode);
    const submitted = await submitAssignment(learner, assignmentId, answers);
    expect(submitted.body.markingStatus).toBe("MARKED");
    expect(markingPrompts).toHaveLength(1);
    // Every question was sent in one call.
    for (const question of SAMPLE_QUESTIONS) expect(markingPrompts[0]).toContain(question.id);
    await teacher.post(`/api/tis/assignments/${assignmentId}/release-results`, { action: "release" });
    const review = await learner.get(`/api/assignments/${assignmentId}/review`);
    expect(review.status).toBe(200);
    expect(review.body.score).toBe(80);
  });

  it("selective mode auto-marks only the chosen indices and holds the rest for the teacher", async () => {
    const { client: teacher, classes } = await registerTeacher();
    const { assignmentId } = await createPublishedAssignment(teacher, classes[0].id, {
      markingMode: "selective",
      autoMarkQuestions: [0, 2],
    });
    const { client: learner } = await registerLearner();
    await joinClass(learner, classes[0].joinCode);
    const submitted = await submitAssignment(learner, assignmentId, answers);
    expect(submitted.body.markingStatus).toBe("PENDING_TEACHER_REVIEW");
    expect(submitted.body.released).toBe(false);
    // Only q1 and q3 went to Gemini; q2 is held for the teacher.
    expect(markingPrompts).toHaveLength(1);
    expect(markingPrompts[0]).toContain("q1");
    expect(markingPrompts[0]).toContain("q3");
    expect(markingPrompts[0]).not.toContain("q2");
  });

  it("manual mode sends nothing to Gemini and holds every question", async () => {
    const { client: teacher, classes } = await registerTeacher();
    const { assignmentId } = await createPublishedAssignment(teacher, classes[0].id, { markingMode: "manual" });
    const { client: learner } = await registerLearner();
    await joinClass(learner, classes[0].joinCode);
    const submitted = await submitAssignment(learner, assignmentId, answers);
    expect(submitted.body.markingStatus).toBe("PENDING_TEACHER_REVIEW");
    expect(markingPrompts).toHaveLength(0);
  });

  it("keeps a selective submission hidden until the teacher resolves the held question", async () => {
    const { client: teacher, classes } = await registerTeacher();
    const { assignmentId } = await createPublishedAssignment(teacher, classes[0].id, {
      markingMode: "selective",
      autoMarkQuestions: [0, 2],
    });
    const { client: learner } = await registerLearner();
    await joinClass(learner, classes[0].joinCode);
    await submitAssignment(learner, assignmentId, answers);
    await teacher.post(`/api/tis/assignments/${assignmentId}/release-results`, { action: "release" });
    // Released, but q2 is still unmarked, so the script stays locked.
    const locked = await learner.get(`/api/assignments/${assignmentId}/review`);
    expect(locked.status).toBe(403);

    const overview = await teacher.get(`/api/tis/classes/${classes[0].id}/overview`);
    const pending = overview.body.pendingMarking[0];
    const submissionId = pending.submissionId;
    const mark = await teacher.post(`/api/tis/submissions/${submissionId}/mark`, { questionIndex: 1, score: 70, comment: "Nearly there." });
    expect(mark.status).toBe(200);
    expect(mark.body.markingStatus).toBe("MARKED");

    const review = await learner.get(`/api/assignments/${assignmentId}/review`);
    expect(review.status).toBe(200);
    // (80 + 70 + 80) / 3 = 76.67 -> 77
    expect(review.body.score).toBe(77);
  });

  it("flags AI-drafted questions and requires confirmation before publishing", async () => {
    const { client: teacher, classes } = await registerTeacher();
    // An AI-sourced draft is flagged so the teacher knows it needs review.
    const created = await teacher.post("/api/tis/assignments", {
      classIds: [classes[0].id],
      topic: "Equivalent fractions",
      questionCount: 1,
      openAt: new Date(Date.now() - 60_000).toISOString(),
      closeAt: new Date(Date.now() + 3_600_000).toISOString(),
      markingMode: "auto",
      resultReleasePolicy: "after_close",
      questionSource: "ai",
    });
    expect(created.status).toBe(201);
    expect(created.body.assignments[0].aiDraft).toBe(true);
    const assignmentId = created.body.assignments[0].id;
    const questions = [{ id: "q1", prompt: "What is 2 + 2?", type: "text", concept: "Addition", answer: "4" }];

    // In Teacher-Dependent mode publishing an AI draft needs an explicit confirm.
    const unconfirmed = await teacher.post(`/api/tis/assignments/${assignmentId}/publish`, { questions });
    expect(unconfirmed.status).toBe(400);
    expect(unconfirmed.body.requiresAiDraftConfirmation).toBe(true);

    const confirmed = await teacher.post(`/api/tis/assignments/${assignmentId}/publish`, { questions, confirmAiDraft: true });
    expect(confirmed.status).toBe(200);
    expect(confirmed.body.isPublished).toBe(true);
  });

  it("publishes manually authored questions without an AI-draft confirmation", async () => {
    const { client: teacher, classes } = await registerTeacher();
    // createPublishedAssignment publishes through the same route; it throws if
    // the publish does not return 200, so a manual set needs no confirmation.
    const { assignmentId } = await createPublishedAssignment(teacher, classes[0].id, { questionCount: 1 });
    const overview = await teacher.get(`/api/tis/classes/${classes[0].id}/overview`);
    expect(overview.body.assignments.some((entry: any) => entry.id === assignmentId)).toBe(true);
  });
});
