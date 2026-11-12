import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { pool } from "@workspace/db";
import { client, ensureSchemaReady, resetDatabase, startTestServer, stopTestServer } from "./harness";
import { registerLearner, registerParent, registerTeacher, registerTutor } from "./fixtures";

describe("account and learner security", () => {
  beforeAll(async () => { await startTestServer(); await ensureSchemaReady(); });
  beforeEach(async () => { await resetDatabase(); });
  afterEach(() => { vi.restoreAllMocks(); delete process.env.RESEND_API_KEY; delete process.env.RECOVERY_EMAIL_FROM; });
  afterAll(async () => { await stopTestServer(); });

  it("requires proof of email ownership, consumes the code once and revokes sessions", async () => {
    const teacher = await registerTeacher();
    const attacker = client();
    const payload = { email: teacher.email, username: teacher.email, kind: "teacher", password: "new-password-123" };
    expect((await attacker.post("/api/auth/recover/reset", payload)).status).not.toBe(200);
    expect((await attacker.post("/api/auth/recover/lookup", { email: teacher.email })).status).toBe(503);
    process.env.RESEND_API_KEY = "synthetic-test-key";
    process.env.RECOVERY_EMAIL_FROM = "Slate <test@example.com>";
    let code = "";
    const originalFetch = globalThis.fetch;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      if (String(input) === "https://api.resend.com/emails") {
        const body = JSON.parse(String(init?.body));
        code = body.text.match(/[A-Za-z0-9_-]{43}/)?.[0] ?? "";
        return new Response("{}", { status: 200 });
      }
      return originalFetch(input, init);
    });
    const lookup = await attacker.post("/api/auth/recover/lookup", { email: teacher.email });
    expect(lookup.status).toBe(200);
    expect(lookup.body.accounts).toBeUndefined();
    expect(code).toHaveLength(43);
    expect((await attacker.post("/api/auth/recover/verify", { email: teacher.email, code: "a".repeat(43) })).status).toBe(403);
    const verify = await attacker.post("/api/auth/recover/verify", { email: teacher.email, code });
    expect(verify.body.accounts.some((account: any) => account.kind === "teacher")).toBe(true);
    const firstCode = code;
    await attacker.post("/api/auth/recover/lookup", { email: teacher.email });
    const secondCode = code;
    expect(secondCode).not.toBe(firstCode);
    const raced = await Promise.all([
      attacker.post("/api/auth/recover/reset", { ...payload, code: firstCode }),
      attacker.post("/api/auth/recover/reset", { ...payload, code: secondCode }),
    ]);
    expect(raced.map((response) => response.status).sort()).toEqual([200, 403]);
    expect((await teacher.client.get("/api/tis/auth/me")).body.teacher).toBeNull();
    expect((await attacker.post("/api/auth/recover/reset", { ...payload, code })).status).toBe(403);
    expect((await attacker.post("/api/tis/auth/login", { email: teacher.email, password: payload.password })).status).toBe(200);
  });

  it("requires a learner's approval for search and links, bound to the recipient and role", async () => {
    const learner = await registerLearner();
    const parent = await registerParent();
    const stranger = await registerParent();
    const tutor = await registerTutor();
    const issue = await learner.client.post("/api/auth/learner-approval", { role: "parent", slateId: parent.parent.slateId });
    const code = issue.body.code;
    expect(issue.status).toBe(200);
    expect((await parent.client.get("/api/learners/search?q=Test")).status).toBe(403);
    expect((await stranger.client.post("/api/learners/search", { q: "Test", approvalCode: code })).status).toBe(403);
    expect((await tutor.client.post("/api/tutor/learners/link", { learnerId: learner.learner.id, approvalCode: code })).status).toBe(403);
    expect((await stranger.client.post("/api/parent/learners/link", { learnerId: learner.learner.id, approvalCode: code })).status).toBe(403);
    const found = await parent.client.post("/api/learners/search", { q: "Test", approvalCode: code });
    expect(found.body.learners.map((row: any) => row.id)).toEqual([learner.learner.id]);
    expect((await parent.client.post("/api/parent/learners/link", { learnerId: learner.learner.id, approvalCode: code })).status).toBe(201);
    expect((await parent.client.post("/api/learners/search", { q: "Test", approvalCode: code })).status).toBe(403);
    expect((await stranger.client.get(`/api/parent/learners/${learner.learner.id}/export`)).status).toBe(404);
    expect((await stranger.client.delete(`/api/parent/learners/${learner.learner.id}`)).status).toBe(404);
  });

  it("denies unverified historical search links and permits reapproval", async () => {
    const learner = await registerLearner(); const parent = await registerParent();
    await pool.query("INSERT INTO slate_parent_learners (parent_id, learner_id, verified_at) VALUES ($1, $2, NULL)", [parent.parent.id, learner.learner.id]);
    expect((await parent.client.get(`/api/parent/learners/${learner.learner.id}/export`)).status).toBe(404);
    expect((await parent.client.delete(`/api/parent/learners/${learner.learner.id}`)).status).toBe(404);
    const approval = await learner.client.post("/api/auth/learner-approval", { role: "parent", slateId: parent.parent.slateId });
    expect((await parent.client.post("/api/parent/learners/link", { learnerId: learner.learner.id, approvalCode: approval.body.code })).status).toBe(201);
    expect((await parent.client.get(`/api/parent/learners/${learner.learner.id}/export`)).status).toBe(200);
  });

  it("counts concurrent login attempts across clients in the database", async () => {
    const base = await startTestServer();
    const responses = await Promise.all(Array.from({ length: 15 }, (_, i) => fetch(`${base}/api/tis/auth/login`, {
      method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": `10.5.0.${i + 1}` },
      body: JSON.stringify({ email: "same@example.com", password: "wrong" }),
    })));
    expect(responses.filter((r) => r.status === 429)).toHaveLength(5);
  });

  it("hides tutor class reports for unverified historical links until reapproval", async () => {
    const learner = await registerLearner(); const tutor = await registerTutor();
    const created = await tutor.client.post("/api/tutor/classes", { grade: 8, subject: "Mathematics" });
    const classId = created.body.classes[0].id;
    await pool.query("INSERT INTO slate_tutor_learners (tutor_id, learner_id, verified_at) VALUES ($1, $2, NULL)", [tutor.tutor.id, learner.learner.id]);
    await pool.query("INSERT INTO slate_class_learners (class_id, learner_id, subject) VALUES ($1, $2, 'Mathematics')", [classId, learner.learner.id]);
    expect((await tutor.client.get(`/api/tutor/classes/${classId}/overview`)).status).toBe(404);
    expect((await tutor.client.get("/api/tutor/summary")).body.classes).toHaveLength(0);
    const approval = await learner.client.post("/api/auth/learner-approval", { role: "tutor", slateId: tutor.tutor.slateId });
    expect((await tutor.client.post("/api/tutor/learners/link", { learnerId: learner.learner.id, approvalCode: approval.body.code })).status).toBe(201);
    expect((await tutor.client.get(`/api/tutor/classes/${classId}/overview`)).status).toBe(200);
  });

  it("recovers a parent-created legacy learner through the verified parent email", async () => {
    const parent = await registerParent();
    const child = await parent.client.post("/api/parent/learners", { fullName: "Legacy Child", grade: 8, subjects: ["Mathematics"], age: 13, gender: "girl", consent: true });
    expect(child.status).toBe(201);
    await pool.query("DELETE FROM slate_parent_learners WHERE learner_id = $1", [child.body.learner.id]);
    await pool.query("UPDATE slate_learners SET email = NULL WHERE id = $1", [child.body.learner.id]);
    process.env.RESEND_API_KEY = "synthetic-test-key"; process.env.RECOVERY_EMAIL_FROM = "Slate <test@example.com>";
    let code = ""; const originalFetch = globalThis.fetch;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      if (String(input) === "https://api.resend.com/emails") { code = JSON.parse(String(init?.body)).text.match(/[A-Za-z0-9_-]{43}/)[0]; return new Response("{}", { status: 200 }); }
      return originalFetch(input, init);
    });
    const requester = client();
    expect((await requester.post("/api/auth/recover/lookup", { email: parent.email })).status).toBe(200);
    const verified = await requester.post("/api/auth/recover/verify", { email: parent.email, code });
    expect(verified.body.accounts.some((account: any) => account.username === child.body.credentials.username)).toBe(true);
    expect((await requester.post("/api/auth/recover/reset", { email: parent.email, kind: "learner", username: child.body.credentials.username, password: "new-password-123", code })).status).toBe(200);
    expect((await requester.post("/api/auth/login", { username: child.body.credentials.username, password: "new-password-123" })).status).toBe(200);
  });

  it("rejects expired codes", async () => {
    const learner = await registerLearner(); const parent = await registerParent();
    const issue = await learner.client.post("/api/auth/learner-approval", { role: "parent", slateId: parent.parent.slateId });
    await pool.query("UPDATE slate_learner_approvals SET expires_at = now() - interval '1 second'");
    expect((await parent.client.post("/api/parent/learners/link", { learnerId: learner.learner.id, approvalCode: issue.body.code })).status).toBe(403);
  });
});
