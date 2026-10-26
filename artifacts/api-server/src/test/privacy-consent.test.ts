import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { db, pool } from "@workspace/db";
import { learnersTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { client, ensureSchemaReady, resetDatabase, startTestServer, stopTestServer } from "./harness";
import { createPublishedAssignment, joinClass, memoAwareMarkingModel, registerParent, registerTeacher, registerTutor, submitAssignment, uniqueEmail } from "./fixtures";
import { setGeminiModelForTesting, setGeminiSleepForTesting } from "../lib/ai";
import { PRIVACY_NOTICE_VERSION } from "../lib/privacy";

describe("child privacy and consent (POPIA)", () => {
  beforeAll(async () => {
    await startTestServer();
    await ensureSchemaReady();
    setGeminiSleepForTesting(async () => {});
    // Every answer is marked fully correct against the memorandum.
    setGeminiModelForTesting(memoAwareMarkingModel({ ratio: 0.9 }));
  });
  afterAll(async () => {
    await stopTestServer();
    setGeminiModelForTesting(null);
    setGeminiSleepForTesting(null);
  });
  beforeEach(async () => { await resetDatabase(); });

  it("publishes the privacy notice with the consent summary", async () => {
    const response = await client().get("/api/privacy-notice");
    expect(response.status).toBe(200);
    expect(response.body.version).toBe(PRIVACY_NOTICE_VERSION);
    // What is stored must be spelled out, including the external AI processor.
    const stored = response.body.stored.join(" | ");
    for (const field of ["Name", "Grade", "School", "Date of birth", "Gender", "Home language", "Answers"]) {
      expect(stored).toContain(field);
    }
    expect(response.body.consentSummary).toMatch(/Gemini/);
    expect(JSON.stringify(response.body)).toMatch(/external AI/);
  });

  it("refuses to create a child account without the consent checkbox", async () => {
    const { client: parent } = await registerParent();
    const missing = await parent.post("/api/parent/learners", {
      fullName: "No Consent", grade: 8, subjects: ["Mathematics"], age: 13, gender: "boy",
    });
    expect(missing.status).toBe(400);
    expect(missing.body.error).toMatch(/privacy notice/i);
    const explicitlyFalse = await parent.post("/api/parent/learners", {
      fullName: "No Consent", grade: 8, subjects: ["Mathematics"], age: 13, gender: "boy", consent: false,
    });
    expect(explicitlyFalse.status).toBe(400);
    // Nothing was written.
    const dashboard = await parent.get("/api/parent/dashboard");
    expect(dashboard.body.children).toHaveLength(0);
  });

  it("requires the guardian's consent for a tutor-created learner too", async () => {
    const { client: tutor } = await registerTutor();
    const missing = await tutor.post("/api/tutor/learners", {
      fullName: "Tutor Child", grade: 8, subjects: ["Mathematics"],
    });
    expect(missing.status).toBe(400);
    expect(missing.body.error).toMatch(/guardian/i);
  });

  it("stores the consent version and timestamp with the child account", async () => {
    const { client: parent } = await registerParent();
    const created = await parent.post("/api/parent/learners", {
      fullName: "Consented Child", grade: 8, subjects: ["Mathematics"], age: 13, gender: "girl", consent: true,
    });
    expect(created.status).toBe(201);
    expect(created.body.learner.consentVersion).toBe(PRIVACY_NOTICE_VERSION);
    expect(created.body.learner.consentAt).toBeTruthy();
    const [row] = await db.select().from(learnersTable).where(eq(learnersTable.id, created.body.learner.id)).limit(1);
    expect(row.consentVersion).toBe(PRIVACY_NOTICE_VERSION);
    expect(row.consentAt).toBeInstanceOf(Date);
  });

  it("exports everything held for a child as JSON", async () => {
    const { client: teacher, classes } = await registerTeacher();
    const { assignmentId } = await createPublishedAssignment(teacher, classes[0].id);
    const { client: parent } = await registerParent();
    const created = await parent.post("/api/parent/learners", {
      fullName: "Exported Child", grade: 8, subjects: ["Mathematics"], age: 13, gender: "boy", consent: true,
    });
    const childId = created.body.learner.id;
    const credentials = created.body.credentials as { username: string; password: string };
    const childClient = client();
    await childClient.post("/api/auth/login", { username: credentials.username, password: credentials.password });
    await joinClass(childClient, classes[0].joinCode);
    await submitAssignment(childClient, assignmentId, [
      { questionId: "q1", answer: "4" }, { questionId: "q2", answer: "15" }, { questionId: "q3", answer: "6" },
    ]);

    const exported = await parent.get(`/api/parent/learners/${childId}/export`);
    expect(exported.status).toBe(200);
    expect(exported.body.learner.id).toBe(childId);
    expect(exported.body.learner.fullName).toBe("Exported Child");
    expect(exported.body.classes).toHaveLength(1);
    expect(exported.body.submissions).toHaveLength(1);
    expect(exported.body.submissions[0].answers).toHaveLength(3);
    expect(exported.body.learningProfile).toBeTruthy();
    expect(exported.body.exportedAt).toBeTruthy();
  });

  it("deletes a child account and all linked data, leaving other accounts intact", async () => {
    const { client: parent } = await registerParent();
    const keep = await parent.post("/api/parent/learners", {
      fullName: "Keep Me", grade: 8, subjects: ["Mathematics"], age: 13, gender: "boy", consent: true,
    });
    const remove = await parent.post("/api/parent/learners", {
      fullName: "Remove Me", grade: 8, subjects: ["Mathematics"], age: 13, gender: "girl", consent: true,
    });
    const removeId = remove.body.learner.id;
    const deleted = await parent.delete(`/api/parent/learners/${removeId}`);
    expect(deleted.status).toBe(200);
    expect(deleted.body.deleted).toBe(true);
    // The child's own row and learning profile are gone.
    expect(await db.select().from(learnersTable).where(eq(learnersTable.id, removeId))).toHaveLength(0);
    const { rows } = await pool.query(`select 1 from slate_learning_profiles where learner_id = $1`, [removeId]);
    expect(rows).toHaveLength(0);
    // The sibling and the parent account survive.
    const dashboard = await parent.get("/api/parent/dashboard");
    expect(dashboard.body.children.map((entry: any) => entry.learner.fullName)).toEqual(["Keep Me"]);
    expect(dashboard.body.parent).toBeTruthy();
    void keep;
  });

  it("does not expose another parent's child through export or delete", async () => {
    const { client: parentA } = await registerParent();
    const { client: parentB } = await registerParent();
    const child = await parentB.post("/api/parent/learners", {
      fullName: "B's Child", grade: 8, subjects: ["Mathematics"], age: 13, gender: "boy", consent: true,
    });
    const childId = child.body.learner.id;
    expect((await parentA.get(`/api/parent/learners/${childId}/export`)).status).toBe(404);
    expect((await parentA.delete(`/api/parent/learners/${childId}`)).status).toBe(404);
    expect(await db.select().from(learnersTable).where(eq(learnersTable.id, childId))).toHaveLength(1);
    void uniqueEmail;
  });
});
