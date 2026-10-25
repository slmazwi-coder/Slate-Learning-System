import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { client, ensureSchemaReady, resetDatabase, startTestServer, stopTestServer } from "./harness";
import {
  createPublishedAssignment,
  joinClass,
  joinClassAsHod,
  registerHod,
  registerLearner,
  registerTeacher,
  submitAssignment,
} from "./fixtures";
import { setGeminiModelForTesting, setGeminiSleepForTesting } from "../lib/ai";
import { ZONE_CONFIG, countZones, zoneFor } from "../lib/hod-zones";

// A deterministic fake Gemini: every answer is marked fully correct, so a
// submission always ends MARKED and the release/zone rules are the only
// variable under test.
function correctModel() {
  return {
    generateContent: async (parts: Array<{ text?: string }>) => {
      const prompt = parts.map((part) => part.text ?? "").join("\n");
      const ids = [...new Set([...prompt.matchAll(/"id"\s*:\s*"([^"]+)"/g)].map((match) => match[1]))];
      if (prompt.includes("Mark this learner")) {
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

const answerKey = [
  { questionId: "q1", answer: "4" },
  { questionId: "q2", answer: "15" },
  { questionId: "q3", answer: "6" },
];

async function auditActions(classId: string): Promise<string[]> {
  const { db, auditLogTable } = await import("@workspace/db");
  const { eq } = await import("drizzle-orm");
  const rows = await db.select({ action: auditLogTable.action }).from(auditLogTable).where(eq(auditLogTable.classId, classId));
  return rows.map((row) => row.action);
}

// Deep-scans a payload for anything that looks like learner identity. The HOD
// contract is that class-level payloads never carry a learner name or id.
// Class ids, assignment ids and titles are class-level metadata and are fine;
// what must never appear is a learner's identity.
function learnerIdentityLeaks(payload: unknown): string[] {
  const leaks: string[] = [];
  const walk = (value: unknown, path: string, insideLearners: boolean) => {
    if (Array.isArray(value)) {
      const isLearnerList = /(^|\.)learners$/.test(path);
      if (isLearnerList && value.length) leaks.push(`${path} (non-empty learner list)`);
      return value.forEach((entry, index) => walk(entry, `${path}[${index}]`, isLearnerList || insideLearners));
    }
    if (value && typeof value === "object") {
      for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
        if (/^(learnerName|learnerId|fullName|username|slateId)$/.test(key)) leaks.push(`${path}.${key}`);
        // A bare "id" is only a leak when it sits inside a learner list.
        if (key === "id" && insideLearners) leaks.push(`${path}.id`);
        walk(entry, `${path}.${key}`, insideLearners);
      }
    }
  };
  walk(payload, "$", false);
  return leaks;
}

describe("zones (unit)", () => {
  it("bands a learner by their average, and never marks thin evidence red", () => {
    expect(zoneFor(75, 3)).toBe("green");
    expect(zoneFor(60, 3)).toBe("green");
    expect(zoneFor(59, 3)).toBe("yellow");
    expect(zoneFor(40, 3)).toBe("yellow");
    expect(zoneFor(39, 3)).toBe("red");
    // Fewer than the minimum results is never red, however low the average.
    expect(zoneFor(0, 0)).toBe("insufficient");
    expect(zoneFor(10, 2)).toBe("insufficient");
    expect(ZONE_CONFIG.minResultsForZone).toBe(3);
    expect(ZONE_CONFIG.greenMin).toBe(60);
    expect(ZONE_CONFIG.yellowMin).toBe(40);
  });

  it("counts learners into zones, keeping thin evidence out of red", () => {
    const counts = countZones([
      { averageScore: 80, resultCount: 5 },
      { averageScore: 50, resultCount: 4 },
      { averageScore: 20, resultCount: 6 },
      { averageScore: 5, resultCount: 2 },
    ]);
    expect(counts).toEqual({ green: 1, yellow: 1, red: 1, insufficient: 1, total: 4 });
  });
});

describe("HOD supervisory role", () => {
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

  it("lets an HOD join with the HOD code and never with the learner code", async () => {
    const { classes } = await registerTeacher();
    const { client: hod } = await registerHod();
    // The learner join code must not open a supervisory membership.
    const wrong = await hod.post("/api/hod/join", { code: classes[0].joinCode });
    expect(wrong.status).toBe(404);
    expect((await hod.get("/api/hod/overview")).body.classes).toHaveLength(0);

    const joined = await joinClassAsHod(hod, classes[0].hodJoinCode);
    expect(joined.class.id).toBe(classes[0].id);
    const overview = await hod.get("/api/hod/overview");
    expect(overview.body.classes).toHaveLength(1);
    expect(await auditActions(classes[0].id)).toContain("hod_join");
  });

  it("keeps an HOD linked when the teacher rotates the HOD code", async () => {
    const { client: teacher, classes } = await registerTeacher();
    const { client: hod } = await registerHod();
    await joinClassAsHod(hod, classes[0].hodJoinCode);

    const rotated = await teacher.post(`/api/tis/classes/${classes[0].id}/hod-code`, {});
    expect(rotated.status).toBe(200);
    const newCode = rotated.body.hodJoinCode as string;
    expect(newCode).not.toBe(classes[0].hodJoinCode);
    // Rotation is for new joiners only: the existing HOD is untouched.
    const stillThere = await hod.get("/api/hod/overview");
    expect(stillThere.body.classes).toHaveLength(1);
    const listed = await teacher.get(`/api/tis/classes/${classes[0].id}/hods`);
    expect(listed.body.hods).toHaveLength(1);
    expect(await auditActions(classes[0].id)).toContain("hod_code_rotate");

    // A new HOD can use the rotated code; the old one no longer works.
    const { client: hod2 } = await registerHod();
    expect((await hod2.post("/api/hod/join", { code: classes[0].hodJoinCode })).status).toBe(404);
    expect((await hod2.post("/api/hod/join", { code: newCode })).status).toBe(201);
  });

  it("gives the teacher no route that removes or hides an HOD", async () => {
    const { client: teacher, classes } = await registerTeacher();
    const { client: hod } = await registerHod();
    await joinClassAsHod(hod, classes[0].hodJoinCode);
    const listed = await teacher.get(`/api/tis/classes/${classes[0].id}/hods`);
    const membershipId = listed.body.hods[0].id as string;

    // No teacher-facing route exists that ends the membership, whatever it is
    // pointed at: expel targets learners, and nothing else touches HODs.
    for (const path of [
      `/api/tis/classes/${classes[0].id}/hods/${membershipId}`,
      `/api/tis/classes/${classes[0].id}/hods/remove`,
      `/api/tis/classes/${classes[0].id}/hod-remove`,
      `/api/tis/hods/${membershipId}`,
    ]) {
      const response = await teacher.delete(path);
      expect([404, 405]).toContain(response.status);
    }
    // Expelling the HOD's membership id as a "member" does not remove them.
    const expel = await teacher.post(`/api/tis/classes/${classes[0].id}/expel`, { memberId: membershipId, memberType: "hod" });
    expect(expel.status).toBeGreaterThanOrEqual(400);
    // The HOD still supervises the class.
    expect((await hod.get("/api/hod/overview")).body.classes).toHaveLength(1);
    expect((await teacher.get(`/api/tis/classes/${classes[0].id}/hods`)).body.hods).toHaveLength(1);
  });

  it("lets only the HOD leave a class", async () => {
    const { client: teacher, classes } = await registerTeacher();
    const { client: hod } = await registerHod();
    await joinClassAsHod(hod, classes[0].hodJoinCode);

    // The teacher cannot force a leave on the HOD's behalf.
    const teacherLeave = await teacher.post(`/api/hod/classes/${classes[0].id}/leave`, {});
    expect([401, 403, 404]).toContain(teacherLeave.status);

    const left = await hod.post(`/api/hod/classes/${classes[0].id}/leave`, {});
    expect(left.status).toBe(200);
    expect(left.body.classes).toHaveLength(0);
    expect((await hod.get("/api/hod/overview")).body.classes).toHaveLength(0);
    expect((await teacher.get(`/api/tis/classes/${classes[0].id}/hods`)).body.hods).toHaveLength(0);
    expect(await auditActions(classes[0].id)).toContain("hod_leave");
  });

  it("never puts a learner name or id in an HOD class payload", async () => {
    const { client: teacher, classes } = await registerTeacher();
    const { client: hod } = await registerHod();
    await joinClassAsHod(hod, classes[0].hodJoinCode);
    const { assignmentId } = await createPublishedAssignment(teacher, classes[0].id);
    const { client: learner } = await registerLearner();
    await joinClass(learner, classes[0].joinCode);
    await submitAssignment(learner, assignmentId, answerKey);
    await teacher.post(`/api/tis/assignments/${assignmentId}/release-results`, { action: "release" });

    const overview = await hod.get("/api/hod/overview");
    expect(overview.status).toBe(200);
    expect(learnerIdentityLeaks(overview.body)).toEqual([]);
    const classView = await hod.get(`/api/hod/classes/${classes[0].id}`);
    expect(classView.status).toBe(200);
    expect(learnerIdentityLeaks(classView.body)).toEqual([]);
    // The class view must not carry the teacher's learner panels at all.
    expect(classView.body.learners).toBeUndefined();
    expect(classView.body.pendingMarking).toBeUndefined();
    expect(classView.body.submissions).toBeUndefined();
  });

  it("returns 403 for scripts while the teacher's toggle is off, 200 when on", async () => {
    const { client: teacher, classes } = await registerTeacher();
    const { client: hod } = await registerHod();
    await joinClassAsHod(hod, classes[0].hodJoinCode);
    const { assignmentId } = await createPublishedAssignment(teacher, classes[0].id);
    const { client: learner } = await registerLearner();
    await joinClass(learner, classes[0].joinCode);
    await submitAssignment(learner, assignmentId, answerKey);
    await teacher.post(`/api/tis/assignments/${assignmentId}/release-results`, { action: "release" });

    const offList = await hod.get(`/api/hod/classes/${classes[0].id}/assignments/${assignmentId}/submissions`);
    expect(offList.status).toBe(403);

    const enabled = await teacher.put(`/api/tis/classes/${classes[0].id}/hod-script-access`, { enabled: true });
    expect(enabled.status).toBe(200);
    const onList = await hod.get(`/api/hod/classes/${classes[0].id}/assignments/${assignmentId}/submissions`);
    expect(onList.status).toBe(200);
    expect(onList.body.submissions).toHaveLength(1);
    // The script itself opens read-only, and the view is audited.
    const submissionId = onList.body.submissions[0].submissionId as string;
    const script = await hod.get(`/api/hod/submissions/${submissionId}`);
    expect(script.status).toBe(200);
    expect(script.body.editable).toBe(false);
    expect(script.body.score).toBe(90);
    expect(await auditActions(classes[0].id)).toContain("hod_script_view");

    // Switching it back off closes the script routes again, immediately.
    await teacher.put(`/api/tis/classes/${classes[0].id}/hod-script-access`, { enabled: false });
    expect((await hod.get(`/api/hod/submissions/${submissionId}`)).status).toBe(403);
    expect((await hod.get(`/api/hod/classes/${classes[0].id}/assignments/${assignmentId}/submissions`)).status).toBe(403);
  });

  it("excludes held results from the class average, zones and trend", async () => {
    const { client: teacher, classes } = await registerTeacher();
    const { client: hod } = await registerHod();
    await joinClassAsHod(hod, classes[0].hodJoinCode);
    const { assignmentId } = await createPublishedAssignment(teacher, classes[0].id, { resultReleasePolicy: "after_close" });
    const { client: learner } = await registerLearner();
    await joinClass(learner, classes[0].joinCode);
    await submitAssignment(learner, assignmentId, answerKey);

    // Held: nothing counts, and the learner is not red — they have no evidence.
    const held = await hod.get(`/api/hod/classes/${classes[0].id}`);
    expect(held.body.classAverage).toBe(0);
    expect(held.body.zones).toEqual({ green: 0, yellow: 0, red: 0, insufficient: 1, total: 1 });
    expect(held.body.trend).toBe("NOT_ENOUGH_DATA");
    expect(held.body.assignments[0].resultsVisible).toBe(false);
    expect(held.body.assignments[0].averageScore).toBe(0);

    await teacher.post(`/api/tis/assignments/${assignmentId}/release-results`, { action: "release" });

    const released = await hod.get(`/api/hod/classes/${classes[0].id}`);
    expect(released.body.classAverage).toBe(90);
    expect(released.body.assignments[0].resultsVisible).toBe(true);
    expect(released.body.assignments[0].averageScore).toBe(90);
    // One marked result is still below the minimum, so the learner stays in
    // "not enough data" and is never pushed into red.
    expect(released.body.zones.insufficient).toBe(1);
    expect(released.body.zones.red).toBe(0);
  });

  it("shows a teacher only their own classes and a tutor nothing extra", async () => {
    const { client: teacherA, classes: classesA } = await registerTeacher({ section: "A" });
    const { client: teacherB, classes: classesB } = await registerTeacher({ section: "B" });
    const { client: hod } = await registerHod();
    await joinClassAsHod(hod, classesA[0].hodJoinCode);

    // The HOD sees only the class they joined, not the other teacher's.
    const overview = await hod.get("/api/hod/overview");
    expect(overview.body.classes.map((entry: any) => entry.class.id)).toEqual([classesA[0].id]);
    expect(overview.body.classes.map((entry: any) => entry.class.id)).not.toContain(classesB[0].id);
    // And cannot read the un-joined class even with its id.
    expect((await hod.get(`/api/hod/classes/${classesB[0].id}`)).status).toBe(404);
    expect((await hod.get(`/api/hod/classes/${classesB[0].id}/assignments/x/submissions`)).status).toBe(404);
    // Teacher isolation is unchanged by the HOD feature.
    expect((await teacherB.get(`/api/tis/classes/${classesA[0].id}/overview`)).status).toBe(404);
  });

  it("isolates the HOD from every teacher, parent, tutor and learner route", async () => {
    const { client: teacher, classes } = await registerTeacher();
    const { client: hod } = await registerHod();
    await joinClassAsHod(hod, classes[0].hodJoinCode);
    const { assignmentId } = await createPublishedAssignment(teacher, classes[0].id);

    // HODs must have no access to learner, parent, tutor or teacher-write routes.
    const blocked: Array<[string, Promise<{ status: number }>]> = [
      ["tis summary", hod.get("/api/tis/summary")],
      ["tis overview", hod.get(`/api/tis/classes/${classes[0].id}/overview`)],
      ["tis hods", hod.get(`/api/tis/classes/${classes[0].id}/hods`)],
      ["tis hod-code", hod.post(`/api/tis/classes/${classes[0].id}/hod-code`, {})],
      ["tis script access", hod.put(`/api/tis/classes/${classes[0].id}/hod-script-access`, { enabled: true })],
      ["tis expel", hod.post(`/api/tis/classes/${classes[0].id}/expel`, { memberId: "x", memberType: "learner" })],
      ["tis create assignment", hod.post("/api/tis/assignments", { classIds: [classes[0].id], topic: "Nope", questionCount: 1 })],
      ["tis release results", hod.post(`/api/tis/assignments/${assignmentId}/release-results`, { action: "release" })],
      ["learner dashboard", hod.get("/api/dashboard/summary")],
      ["learner assignments", hod.get("/api/assignments")],
      ["learner profile", hod.get("/api/learners/me")],
      ["parent dashboard", hod.get("/api/parent/dashboard")],
      ["tutor summary", hod.get("/api/tutor/summary")],
      ["learner search", hod.get("/api/learners/search?q=Test")],
    ];
    for (const [label, pending] of blocked) {
      const response = await pending;
      expect([401, 403, 404], `${label} should be blocked for an HOD`).toContain(response.status);
    }
    // The HOD's own routes still work.
    expect((await hod.get("/api/hod/overview")).status).toBe(200);
  });

  it("rejects unauthenticated access to every HOD route", async () => {
    const anon = client();
    expect((await anon.get("/api/hod/overview")).status).toBe(401);
    expect((await anon.get("/api/hod/auth/me")).status).toBe(200);
    expect((await anon.get("/api/hod/auth/me")).body.hod).toBeNull();
    expect((await anon.post("/api/hod/join", { code: "ABC123" })).status).toBe(401);
    expect((await anon.post("/api/hod/classes/any/leave", {})).status).toBe(401);
    expect((await anon.get("/api/hod/classes/any")).status).toBe(401);
  });

  it("groups the HOD overview by teacher without ranking them", async () => {
    const { classes: classesA } = await registerTeacher({ section: "A", fullName: "Amara Dlamini" });
    const { classes: classesB } = await registerTeacher({ section: "B", fullName: "Bongani Nkosi" });
    const { client: hod } = await registerHod();
    await joinClassAsHod(hod, classesA[0].hodJoinCode);
    await joinClassAsHod(hod, classesB[0].hodJoinCode);
    const overview = await hod.get("/api/hod/overview");
    expect(overview.body.teachers).toHaveLength(2);
    expect(overview.body.teachers.map((group: any) => group.teacherName)).toEqual(["Amara Dlamini", "Bongani Nkosi"]);
    // Grouped by teacher name, alphabetically — not by class average.
    const names = overview.body.teachers.map((group: any) => group.teacherName);
    expect(names).toEqual([...names].sort((a: string, b: string) => a.localeCompare(b)));
    for (const group of overview.body.teachers) {
      expect(group.teacherName).toBeTruthy();
      expect(group.classes.length).toBeGreaterThan(0);
      for (const entry of group.classes) {
        expect(entry.classAverage).toBeGreaterThanOrEqual(0);
        expect(entry.zones).toBeTruthy();
        expect(entry.trend).toBeTruthy();
      }
    }
    expect(overview.body.totals.classes).toBe(2);
    expect(learnerIdentityLeaks(overview.body)).toEqual([]);
  });
});
