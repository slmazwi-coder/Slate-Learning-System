import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { db } from "@workspace/db";
import { auditLogTable, learningProfilesTable } from "@workspace/db/schema";
import { and, eq } from "drizzle-orm";
import { ensureSchemaReady, resetDatabase, startTestServer, stopTestServer } from "./harness";
import { createPublishedAssignment, joinClass, registerLearner, registerTeacher, submitAssignment, SAMPLE_QUESTIONS } from "./fixtures";
import { setGeminiModelForTesting, setGeminiSleepForTesting } from "../lib/ai";

// Marks every question correct, so the teacher's override is the only thing that
// changes the result and the learner's concept gaps.
function correctModel() {
  return {
    generateContent: async (parts: Array<{ text?: string }>) => {
      const prompt = parts.map((part) => part.text ?? "").join("\n");
      if (prompt.includes("Mark this learner")) {
        const ids = [...new Set([...prompt.matchAll(/"id"\s*:\s*"([^"]+)"/g)].map((match) => match[1]))];
        return { response: { text: () => JSON.stringify({
          score: 100,
          overallVerdict: "CORRECT",
          feedback: "All correct.",
          marks: ids.map((id) => ({ questionId: id, verdict: "CORRECT", explanation: "Correct.", score: 100, gap: null })),
          remediation: null,
        }) } };
      }
      return { response: { text: () => JSON.stringify([]) } };
    },
  } as any;
}

const answers = SAMPLE_QUESTIONS.map((question) => ({ questionId: question.id, answer: question.answer }));

describe("teacher override", () => {
  beforeAll(async () => {
    await startTestServer();
    await ensureSchemaReady();
    setGeminiSleepForTesting(async () => {});
    setGeminiModelForTesting(correctModel());
  });
  afterAll(async () => {
    await stopTestServer();
    setGeminiModelForTesting(null);
    setGeminiSleepForTesting(null);
  });
  beforeEach(async () => { await resetDatabase(); });

  it("lets the teacher override an AI score and comment, and records it", async () => {
    const { client: teacher, classes } = await registerTeacher();
    const { assignmentId } = await createPublishedAssignment(teacher, classes[0].id, { markingMode: "auto" });
    const { client: learner, learner: learnerRow } = await registerLearner();
    await joinClass(learner, classes[0].joinCode);
    const submitted = await submitAssignment(learner, assignmentId, answers);
    expect(submitted.body.markingStatus).toBe("MARKED");

    const overview = await teacher.get(`/api/tis/classes/${classes[0].id}/overview`);
    const submissionId = overview.body.submissions[0].submissionId;

    // Override question 1: 100% (AI) -> 20% with the teacher's own comment.
    const override = await teacher.post(`/api/tis/submissions/${submissionId}/mark`, {
      questionIndex: 0,
      score: 20,
      comment: "This working is not right — revisit carrying.",
    });
    expect(override.status).toBe(200);
    // (20 + 100 + 100) / 3 = 73.33 -> 73
    expect(override.body.score).toBe(73);

    const audit = await db.select({ action: auditLogTable.action, detail: auditLogTable.detail })
      .from(auditLogTable)
      .where(and(eq(auditLogTable.classId, classes[0].id), eq(auditLogTable.action, "marking_override")));
    expect(audit).toHaveLength(1);
    expect(audit[0].detail).toContain("100%");
    expect(audit[0].detail).toContain("20%");

    // The override feeds the learner's concept gaps: the low-scoring concept is
    // now an active gap.
    const [profile] = await db.select().from(learningProfilesTable).where(eq(learningProfilesTable.learnerId, learnerRow.id)).limit(1);
    expect(profile.activeGaps).toContain("Addition");

    // The learner sees the teacher's override once results are released.
    await teacher.post(`/api/tis/assignments/${assignmentId}/release-results`, { action: "release" });
    const review = await learner.get(`/api/assignments/${assignmentId}/review`);
    expect(review.body.score).toBe(73);
    const firstQuestion = review.body.questions[0];
    expect(firstQuestion.score).toBe(20);
    expect(firstQuestion.explanation).toBe("This working is not right — revisit carrying.");
    expect(firstQuestion.correctAnswer).toBe("4");
  });

  it("lets the teacher resolve a held (manual) question and audits only real overrides", async () => {
    const { client: teacher, classes } = await registerTeacher();
    const { assignmentId } = await createPublishedAssignment(teacher, classes[0].id, { markingMode: "manual" });
    const { client: learner } = await registerLearner();
    await joinClass(learner, classes[0].joinCode);
    await submitAssignment(learner, assignmentId, answers);

    const overview = await teacher.get(`/api/tis/classes/${classes[0].id}/overview`);
    const submissionId = overview.body.pendingMarking[0].submissionId;
    // Marking a held question is not an override, so no override audit is written.
    for (const index of [0, 1, 2]) {
      const response = await teacher.post(`/api/tis/submissions/${submissionId}/mark`, { questionIndex: index, score: 60 });
      expect(response.status).toBe(200);
    }
    const overrides = await db.select({ action: auditLogTable.action })
      .from(auditLogTable)
      .where(and(eq(auditLogTable.classId, classes[0].id), eq(auditLogTable.action, "marking_override")));
    expect(overrides).toHaveLength(0);
  });

  it("refuses an override from a teacher who does not own the class", async () => {
    const { client: teacher, classes } = await registerTeacher();
    const { assignmentId } = await createPublishedAssignment(teacher, classes[0].id);
    const { client: learner } = await registerLearner();
    await joinClass(learner, classes[0].joinCode);
    await submitAssignment(learner, assignmentId, answers);
    const overview = await teacher.get(`/api/tis/classes/${classes[0].id}/overview`);
    const submissionId = overview.body.submissions[0].submissionId;

    const { client: otherTeacher } = await registerTeacher({ section: "B" });
    const forbidden = await otherTeacher.post(`/api/tis/submissions/${submissionId}/mark`, { questionIndex: 0, score: 10 });
    expect(forbidden.status).toBe(403);
  });
});
