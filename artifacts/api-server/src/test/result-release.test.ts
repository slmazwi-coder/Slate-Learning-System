import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { client, ensureSchemaReady, resetDatabase, startTestServer, stopTestServer } from "./harness";
import { createPublishedAssignment, joinClass, registerLearner, registerTeacher, submitAssignment } from "./fixtures";
import { resultsReleased, teacherReleaseState } from "../lib/result-release";
import { setGeminiModelForTesting, setGeminiSleepForTesting } from "../lib/ai";

// A deterministic fake Gemini model: every answer is marked fully correct, so a
// submission always ends up MARKED and the release rules are the only variable.
function correctModel() {
  return {
    generateContent: async (parts: Array<{ text?: string }>) => {
      const prompt = parts.map((part) => part.text ?? "").join("\n");
      const ids = [...prompt.matchAll(/"id"\s*:\s*"([^"]+)"/g)].map((match) => match[1]);
      const unique = [...new Set(ids)];
      if (prompt.includes("Mark this learner")) {
        return { response: { text: () => JSON.stringify({
          score: 100,
          overallVerdict: "CORRECT",
          feedback: "All correct.",
          marks: unique.map((id) => ({ questionId: id, verdict: "CORRECT", explanation: "Correct.", score: 100, gap: null })),
          remediation: null,
        }) } };
      }
      return { response: { text: () => JSON.stringify([]) } };
    },
  } as any;
}

const answerKey = [
  { questionId: "q1", answer: "4" },
  { questionId: "q2", answer: "15" },
  { questionId: "q3", answer: "6" },
];

describe("result release rules (unit)", () => {
  const base = { resultReleasePolicy: "after_close", resultsReleasedAt: null, resultsHeldAt: null };
  const past = new Date(Date.now() - 60_000);
  const future = new Date(Date.now() + 60_000);

  it("applies the configured policy when the teacher has not touched the assignment", () => {
    expect(resultsReleased({ ...base, closeAt: future })).toBe(false);
    expect(resultsReleased({ ...base, closeAt: past })).toBe(true);
    expect(resultsReleased({ ...base, resultReleasePolicy: "immediate", closeAt: future })).toBe(true);
    expect(teacherReleaseState({ ...base, closeAt: future })).toBeNull();
  });

  it("lets an explicit release beat the policy, at any time", () => {
    const assignment = { ...base, closeAt: future, resultsReleasedAt: new Date() };
    expect(resultsReleased(assignment)).toBe(true);
    expect(teacherReleaseState(assignment)).toBe("RELEASED");
  });

  it("hides results again after an explicit hold, and the later action wins", () => {
    const released = new Date(Date.now() - 1000);
    const held = new Date();
    expect(resultsReleased({ ...base, closeAt: past, resultsReleasedAt: released, resultsHeldAt: held })).toBe(false);
    expect(teacherReleaseState({ ...base, closeAt: past, resultsReleasedAt: released, resultsHeldAt: held })).toBe("HELD");
    // Release again after the hold: release is now the later action.
    const reReleased = new Date(held.getTime() + 1000);
    expect(resultsReleased({ ...base, closeAt: past, resultsReleasedAt: reReleased, resultsHeldAt: held })).toBe(true);
  });
});

describe("teacher-controlled release (integration)", () => {
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

  it("hides marks from the learner and parent until the teacher releases them", async () => {
    const { client: teacher, classes } = await registerTeacher();
    const { assignmentId } = await createPublishedAssignment(teacher, classes[0].id, { resultReleasePolicy: "after_close" });
    const { client: learner } = await registerLearner();
    await joinClass(learner, classes[0].joinCode);
    const submitted = await submitAssignment(learner, assignmentId, answerKey);
    expect(submitted.status).toBe(200);
    expect(submitted.body.released).toBe(false);
    expect(submitted.body.score).toBeNull();

    // Held: no marks through review, the dashboard average, or the activity feed.
    const heldReview = await learner.get(`/api/assignments/${assignmentId}/review`);
    expect(heldReview.status).toBe(403);
    const heldDashboard = await learner.get("/api/dashboard/summary");
    expect(heldDashboard.body.averageScore).toBe(0);
    const heldActivity = await learner.get("/api/activity");
    expect(heldActivity.body).toHaveLength(0);

    // The teacher releases results early, before the assignment closes.
    const released = await teacher.post(`/api/tis/assignments/${assignmentId}/release-results`, { action: "release" });
    expect(released.status).toBe(200);
    expect(released.body.releaseState).toBe("RELEASED");
    expect(released.body.resultsVisibleNow).toBe(true);

    const openReview = await learner.get(`/api/assignments/${assignmentId}/review`);
    expect(openReview.status).toBe(200);
    expect(openReview.body.score).toBe(100);
    const openDashboard = await learner.get("/api/dashboard/summary");
    expect(openDashboard.body.averageScore).toBe(100);

    // Holding again hides them immediately.
    const held = await teacher.post(`/api/tis/assignments/${assignmentId}/release-results`, { action: "hold" });
    expect(held.status).toBe(200);
    expect(held.body.releaseState).toBe("HELD");
    expect((await learner.get(`/api/assignments/${assignmentId}/review`)).status).toBe(403);
    expect((await learner.get("/api/dashboard/summary")).body.averageScore).toBe(0);
  });

  it("keeps a held assignment's marks out of the parent dashboard and script", async () => {
    const { client: teacher, classes } = await registerTeacher();
    const { assignmentId } = await createPublishedAssignment(teacher, classes[0].id, { resultReleasePolicy: "after_close" });
    const { client: parent } = await registerParentFixture();
    const child = await parent.post("/api/parent/learners", {
      fullName: "Child Learner", grade: 8, subjects: ["Mathematics"], age: 13, gender: "boy", consent: true,
    });
    const credentials = child.body.credentials as { username: string; password: string };
    const childClient = client();
    const login = await childClient.post("/api/auth/login", { username: credentials.username, password: credentials.password });
    expect(login.status).toBe(200);
    await joinClass(childClient, classes[0].joinCode);
    await submitAssignment(childClient, assignmentId, answerKey);

    const heldDashboard = await parent.get("/api/parent/dashboard");
    const heldChild = heldDashboard.body.children.find((entry: any) => entry.learner.fullName === "Child Learner");
    expect(heldChild.averageScore).toBeNull();
    expect(heldChild.assignmentHistory[0].score).toBeNull();
    expect(heldChild.assignmentHistory[0].released).toBe(false);
    const heldScript = await parent.get(`/api/parent/learners/${child.body.learner.id}/assignments/${assignmentId}/script`);
    expect(heldScript.status).toBe(403);

    await teacher.post(`/api/tis/assignments/${assignmentId}/release-results`, { action: "release" });

    const openDashboard = await parent.get("/api/parent/dashboard");
    const openChild = openDashboard.body.children.find((entry: any) => entry.learner.fullName === "Child Learner");
    expect(openChild.averageScore).toBe(100);
    expect(openChild.assignmentHistory[0].score).toBe(100);
    const openScript = await parent.get(`/api/parent/learners/${child.body.learner.id}/assignments/${assignmentId}/script`);
    expect(openScript.status).toBe(200);
    expect(openScript.body.score).toBe(100);
  });

  it("records each release and hold in the audit log", async () => {
    const { client: teacher, classes } = await registerTeacher();
    const { assignmentId } = await createPublishedAssignment(teacher, classes[0].id);
    await teacher.post(`/api/tis/assignments/${assignmentId}/release-results`, { action: "release" });
    await teacher.post(`/api/tis/assignments/${assignmentId}/release-results`, { action: "hold" });
    const actions = await auditActions(classes[0].id);
    expect(actions).toContain("results_release");
    expect(actions).toContain("results_hold");
  });

  it("only lets the owning teacher release results", async () => {
    const { client: teacher, classes } = await registerTeacher();
    const { assignmentId } = await createPublishedAssignment(teacher, classes[0].id);
    const { client: otherTeacher } = await registerTeacher({ section: "B" });
    const forbidden = await otherTeacher.post(`/api/tis/assignments/${assignmentId}/release-results`, { action: "release" });
    expect(forbidden.status).toBe(403);
    const unauthenticated = await client().post(`/api/tis/assignments/${assignmentId}/release-results`, { action: "release" });
    expect(unauthenticated.status).toBe(401);
  });

  it("hides remediation derived from a held assignment until the teacher releases it", async () => {
    // A model that marks every answer wrong and offers remediation, so a
    // remediation activity row actually exists to be hidden.
    setGeminiModelForTesting({
      generateContent: async (parts: Array<{ text?: string }>) => {
        const prompt = parts.map((part) => part.text ?? "").join("\n");
        const ids = [...new Set([...prompt.matchAll(/"id"\s*:\s*"([^"]+)"/g)].map((match) => match[1]))];
        if (prompt.includes("Mark this learner")) {
          return { response: { text: () => JSON.stringify({
            score: 20,
            overallVerdict: "INCORRECT",
            feedback: "Review place value.",
            marks: ids.map((id) => ({ questionId: id, verdict: "INCORRECT", explanation: "Wrong.", score: 0, gap: "place value" })),
            remediation: { format: "QUIZ", title: "Place value practice", concept: "place value", prompt: "What is 10 × 3?", options: ["30", "13"], instruction: "Pick one", expectedAnswer: "30" },
          }) } };
        }
        return { response: { text: () => JSON.stringify([]) } };
      },
    } as any);
    try {
      const { client: teacher, classes } = await registerTeacher();
      const { assignmentId } = await createPublishedAssignment(teacher, classes[0].id, { resultReleasePolicy: "after_close" });
      const { client: learner } = await registerLearner();
      await joinClass(learner, classes[0].joinCode);
      await submitAssignment(learner, assignmentId, answerKey);
      // Explicit hold: the assignment's result — and any remediation its marking
      // produced — must stay out of the learner's activity feed.
      await teacher.post(`/api/tis/assignments/${assignmentId}/release-results`, { action: "hold" });
      const heldActivities = await learner.get("/api/activities/recommended");
      expect(heldActivities.status).toBe(200);
      expect(heldActivities.body.activities).toHaveLength(0);
      // Releasing makes the activity available again.
      await teacher.post(`/api/tis/assignments/${assignmentId}/release-results`, { action: "release" });
      const releasedActivities = await learner.get("/api/activities/recommended");
      expect(releasedActivities.body.activities.length).toBeGreaterThan(0);
    } finally {
      setGeminiModelForTesting(correctModel());
    }
  });
});

async function registerParentFixture() {
  const c = client();
  const response = await c.post("/api/parent/auth/register", {
    fullName: "Test Parent",
    email: `parent-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`,
    password: "password123",
  });
  if (response.status !== 201) throw new Error(`parent registration failed: ${response.status}`);
  return { client: c, parent: response.body.parent };
}

async function auditActions(classId: string): Promise<string[]> {
  const { db, auditLogTable } = await import("@workspace/db");
  const { eq } = await import("drizzle-orm");
  const rows = await db.select({ action: auditLogTable.action }).from(auditLogTable).where(eq(auditLogTable.classId, classId));
  return rows.map((row) => row.action);
}
