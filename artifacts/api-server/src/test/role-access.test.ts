import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { client, ensureSchemaReady, resetDatabase, startTestServer, stopTestServer } from "./harness";
import { createPublishedAssignment, joinClass, registerLearner, registerParent, registerTeacher, registerTutor, submitAssignment } from "./fixtures";
import { setGeminiModelForTesting, setGeminiSleepForTesting } from "../lib/ai";

function correctModel() {
  return {
    generateContent: async (parts: Array<{ text?: string }>) => {
      const prompt = parts.map((part) => part.text ?? "").join("\n");
      if (prompt.includes("Mark this learner")) {
        const ids = [...new Set([...prompt.matchAll(/"id"\s*:\s*"([^"]+)"/g)].map((match) => match[1]))];
        return { response: { text: () => JSON.stringify({
          score: 90, overallVerdict: "CORRECT", feedback: "Well done.",
          marks: ids.map((id) => ({ questionId: id, verdict: "CORRECT", explanation: "Correct.", score: 90, gap: null })),
          remediation: null,
        }) } };
      }
      return { response: { text: () => JSON.stringify([]) } };
    },
  } as any;
}

describe("role-based access", () => {
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

  it("shows a teacher only their own classes", async () => {
    const { client: teacherA, classes: classesA } = await registerTeacher({ section: "A" });
    const { client: teacherB, classes: classesB } = await registerTeacher({ section: "B" });
    const summaryA = await teacherA.get("/api/tis/summary");
    expect(summaryA.body.classes.map((entry: any) => entry.id)).toEqual([classesA[0].id]);
    expect(summaryA.body.classes.map((entry: any) => entry.id)).not.toContain(classesB[0].id);
    const summaryB = await teacherB.get("/api/tis/summary");
    expect(summaryB.body.classes.map((entry: any) => entry.id)).toEqual([classesB[0].id]);
    // And one teacher cannot read the other's class overview.
    const foreignOverview = await teacherB.get(`/api/tis/classes/${classesA[0].id}/overview`);
    expect(foreignOverview.status).toBe(404);
  });

  it("shows a parent only their own children", async () => {
    const { client: parentA } = await registerParent();
    const { client: parentB } = await registerParent();
    const childA = await parentA.post("/api/parent/learners", {
      fullName: "Child A", grade: 8, subjects: ["Mathematics"], age: 13, gender: "boy", consent: true,
    });
    const childB = await parentB.post("/api/parent/learners", {
      fullName: "Child B", grade: 8, subjects: ["Mathematics"], age: 13, gender: "girl", consent: true,
    });
    expect(childA.status).toBe(201);
    expect(childB.status).toBe(201);

    const dashboardA = await parentA.get("/api/parent/dashboard");
    expect(dashboardA.body.children.map((entry: any) => entry.learner.fullName)).toEqual(["Child A"]);
    // Parent A cannot export or delete parent B's child.
    const foreignExport = await parentA.get(`/api/parent/learners/${childB.body.learner.id}/export`);
    expect(foreignExport.status).toBe(404);
    const foreignDelete = await parentA.delete(`/api/parent/learners/${childB.body.learner.id}`);
    expect(foreignDelete.status).toBe(404);
    // And parent B's child still exists.
    const dashboardB = await parentB.get("/api/parent/dashboard");
    expect(dashboardB.body.children).toHaveLength(1);
  });

  it("gives a tutor read-only access to a class shared by invitation", async () => {
    const { client: teacher, classes } = await registerTeacher();
    const { assignmentId } = await createPublishedAssignment(teacher, classes[0].id);
    const { client: learner } = await registerLearner();
    await joinClass(learner, classes[0].joinCode);
    await submitAssignment(learner, assignmentId, [
      { questionId: "q1", answer: "4" }, { questionId: "q2", answer: "15" }, { questionId: "q3", answer: "6" },
    ]);
    const { client: tutor, email: tutorEmail, tutor: tutorRow } = await registerTutor();

    // The tutor cannot see the class before being invited.
    const beforeInvite = await tutor.get(`/api/tutor/classes/${classes[0].id}/overview`);
    expect(beforeInvite.status).toBe(404);

    const invite = await teacher.post(`/api/tis/classes/${classes[0].id}/invite-tutor`, { email: tutorEmail });
    expect(invite.status).toBe(201);
    const invitations = await tutor.get("/api/tutor/invitations");
    expect(invitations.body.invitations).toHaveLength(1);
    const accept = await tutor.post(`/api/tutor/invitations/${invitations.body.invitations[0].id}/accept`, {});
    expect(accept.status).toBe(200);

    // Read-only: the shared class overview is visible...
    const shared = await tutor.get(`/api/tutor/classes/${classes[0].id}/overview`);
    expect(shared.status).toBe(200);
    expect(shared.body.class.scope).toBe("INVITED");
    // ...but a tutor cannot mutate the class or its assignments.
    const rename = await tutor.patch(`/api/tutor/classes/${classes[0].id}`, { section: "Z" });
    expect([403, 404]).toContain(rename.status);
    const createAssignment = await tutor.post("/api/tutor/assignments", { classIds: [classes[0].id], topic: "Nope", questionCount: 1 });
    expect([403, 404]).toContain(createAssignment.status);
    void tutorRow;
  });

  it("rejects unauthenticated access to every staff route", async () => {
    const anon = client();
    expect((await anon.get("/api/tis/summary")).status).toBe(401);
    expect((await anon.get("/api/parent/dashboard")).status).toBe(401);
    expect((await anon.get("/api/tutor/summary")).status).toBe(401);
    expect((await anon.get("/api/dashboard/summary")).status).toBe(401);
  });

  it("does not let a learner read another learner's review", async () => {
    const { client: teacher, classes } = await registerTeacher();
    const { assignmentId } = await createPublishedAssignment(teacher, classes[0].id);
    const { client: learnerA } = await registerLearner();
    const { client: learnerB } = await registerLearner();
    await joinClass(learnerA, classes[0].joinCode);
    await joinClass(learnerB, classes[0].joinCode);
    await submitAssignment(learnerA, assignmentId, [
      { questionId: "q1", answer: "4" }, { questionId: "q2", answer: "15" }, { questionId: "q3", answer: "6" },
    ]);
    await teacher.post(`/api/tis/assignments/${assignmentId}/release-results`, { action: "release" });
    // Learner B has not submitted, so there is nothing of theirs to review.
    const reviewB = await learnerB.get(`/api/assignments/${assignmentId}/review`);
    expect(reviewB.status).toBe(404);
  });
});
