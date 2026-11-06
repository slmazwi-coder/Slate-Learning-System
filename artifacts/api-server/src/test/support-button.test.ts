import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { client, ensureSchemaReady, resetDatabase, startTestServer, stopTestServer } from "./harness";
import { registerHod, registerLearner, registerParent, registerTeacher, registerTutor } from "./fixtures";
import { normalizeSupportNumber, whatsappSupportNumber } from "../lib/support";

// The support line is adult-only and audit-only. These tests pin the two
// behaviours that matter: a learner can never reach it, and a click records
// the fact without ever recording the message.

describe("support number parsing", () => {
  it("accepts digits only, international, with no plus", () => {
    expect(normalizeSupportNumber("27616122586")).toBe("27616122586");
  });

  it("strips formatting characters the environment might carry", () => {
    expect(normalizeSupportNumber("+27 61 612 2586")).toBe("27616122586");
    expect(normalizeSupportNumber(" 27616122586 ")).toBe("27616122586");
  });

  it("rejects a missing, empty or implausible value", () => {
    expect(normalizeSupportNumber(undefined)).toBeNull();
    expect(normalizeSupportNumber(null)).toBeNull();
    expect(normalizeSupportNumber("")).toBeNull();
    expect(normalizeSupportNumber("123")).toBeNull();
    expect(normalizeSupportNumber("not-a-number")).toBeNull();
    expect(normalizeSupportNumber("1234567890123456789")).toBeNull();
  });

  it("reads WHATSAPP_SUPPORT_NUMBER from the environment", () => {
    expect(whatsappSupportNumber({ WHATSAPP_SUPPORT_NUMBER: "27616122586" } as NodeJS.ProcessEnv)).toBe("27616122586");
    expect(whatsappSupportNumber({} as NodeJS.ProcessEnv)).toBeNull();
  });
});

describe("support config and click (integration)", () => {
  beforeAll(async () => {
    await startTestServer();
    await ensureSchemaReady();
  });
  afterAll(async () => { await stopTestServer(); });
  beforeEach(async () => { await resetDatabase(); });

  it("serves the config publicly, with the hours and the Meta disclosure", async () => {
    const response = await client().get("/api/support/config");
    expect(response.status).toBe(200);
    expect(response.body.categories).toContain("Login help");
    expect(response.body.categories).toContain("HOD change");
    expect(response.body.hours).toContain("SAST");
    expect(response.body.disclosure).toContain("run by Meta");
    // With no WHATSAPP_SUPPORT_NUMBER in the test environment the button is off.
    expect(response.body.enabled).toBe(false);
    expect(response.body.number).toBeNull();
  });

  it("enables the button and serves the number when WHATSAPP_SUPPORT_NUMBER is set", async () => {
    const previous = process.env.WHATSAPP_SUPPORT_NUMBER;
    process.env.WHATSAPP_SUPPORT_NUMBER = "+27 61 612 2586";
    try {
      const response = await client().get("/api/support/config");
      expect(response.status).toBe(200);
      // The value is normalised to digits only, so the wa.me URL is well formed.
      expect(response.body.enabled).toBe(true);
      expect(response.body.number).toBe("27616122586");
    } finally {
      if (previous === undefined) delete process.env.WHATSAPP_SUPPORT_NUMBER;
      else process.env.WHATSAPP_SUPPORT_NUMBER = previous;
    }
  });

  it("refuses a learner, so the button can never be used from a learner page", async () => {
    const { client: learner } = await registerLearner();
    const response = await learner.post("/api/support/click", { category: "Login help" });
    expect(response.status).toBe(403);
    expect(response.body.error).toMatch(/teacher, parent, tutor and HOD/);
  });

  it("refuses an unauthenticated caller", async () => {
    const response = await client().post("/api/support/click", { category: "Login help" });
    expect(response.status).toBe(401);
  });

  it("rejects a category outside the closed list", async () => {
    const { client: teacher } = await registerTeacher();
    const response = await teacher.post("/api/support/click", { category: "My marks are 40%" });
    expect(response.status).toBe(400);
  });

  it("audits a teacher click with the role, category and time and no message content", async () => {
    const { client: teacher, teacher: account } = await registerTeacher();
    const response = await teacher.post("/api/support/click", { category: "Class codes", path: "/teacher/classes?token=secrettoken" });
    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(true);

    const { db, auditLogTable, teachersTable } = await import("@workspace/db");
    const rows = await db.select().from(auditLogTable).where(eq(auditLogTable.action, "support_contact_click"));
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row.actorRole).toBe("TEACHER");
    // The audit row names the signed-in user, not the profile row.
    const [profile] = await db.select({ userId: teachersTable.userId }).from(teachersTable).where(eq(teachersTable.id, account.id));
    expect(row.actorUserId).toBe(profile.userId);
    expect(row.detail).toContain("Class codes");
    // Only the path is kept, and no message text is stored anywhere.
    expect(row.detail).toContain("/teacher/classes");
    expect(row.detail).not.toContain("secrettoken");
    expect(row.detail).not.toMatch(/marks|answer|password/i);
    expect(row.createdAt).toBeInstanceOf(Date);
  });

  it("records the correct role for a parent, tutor and HOD", async () => {
    const { client: parent } = await registerParent();
    const { client: tutor } = await registerTutor();
    const { client: hod } = await registerHod();
    expect((await parent.post("/api/support/click", { category: "Account and privacy" })).status).toBe(200);
    expect((await tutor.post("/api/support/click", { category: "Assignments and marking" })).status).toBe(200);
    expect((await hod.post("/api/support/click", { category: "HOD change" })).status).toBe(200);

    const { db, auditLogTable } = await import("@workspace/db");
    const roles = (await db.select({ role: auditLogTable.actorRole }).from(auditLogTable)
      .where(eq(auditLogTable.action, "support_contact_click"))).map((row) => row.role).sort();
    expect(roles).toEqual(["HOD", "PARENT", "TUTOR"]);
  });
});
