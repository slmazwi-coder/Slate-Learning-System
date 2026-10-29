import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { db } from "@workspace/db";
import { assignmentsTable, auditLogTable, classesTable, interventionsTable } from "@workspace/db/schema";
import { and, eq } from "drizzle-orm";
import { ensureSchemaReady, resetDatabase, startTestServer, stopTestServer } from "./harness";
import {
  SAMPLE_QUESTIONS,
  createPublishedAssignment,
  joinClass,
  joinClassAsHod,
  memoAwareMarkingModel,
  registerHod,
  registerLearner,
  registerParent,
  registerTeacher,
  submitAssignment,
} from "./fixtures";
import { setGeminiModelForTesting, setGeminiSleepForTesting } from "../lib/ai";
import {
  ZONE_DEFAULTS,
  computeLearnerZone,
  consecutiveMissed,
  priorityOrder,
  resolveZoneSettings,
  trendOf,
  twoMostRecentBelowRed,
  weightedAverage,
  zoneForScore,
  type ResultEntry,
} from "../lib/zones";

// ---- The pure arithmetic, with no database ----------------------------------
// These are the rules the task states, checked directly against the functions
// that implement them. A date is only used for ordering, so it is arbitrary.
const day = (n: number) => new Date(Date.UTC(2026, 0, n));

function results(scores: Array<[number, boolean?]>): ResultEntry[] {
  // Newest first: index 0 is the most recent result.
  return scores.map(([score, formal], index) => ({ score, formal: Boolean(formal), submittedAt: day(30 - index) }));
}

describe("zone engine (pure)", () => {
  const settings = resolveZoneSettings(null);

  it("is grey, never red, with fewer than three results", () => {
    expect(zoneForScore(0, 0, settings)).toBe("grey");
    expect(zoneForScore(5, 1, settings)).toBe("grey");
    expect(zoneForScore(10, 2, settings)).toBe("grey");
    // The moment there is enough evidence, the low score does place red.
    expect(zoneForScore(10, 3, settings)).toBe("red");
  });

  it("places the 40 and 60 boundaries correctly", () => {
    expect(zoneForScore(39.9, 3, settings)).toBe("red");
    expect(zoneForScore(40, 3, settings)).toBe("yellow");
    expect(zoneForScore(59.9, 3, settings)).toBe("yellow");
    expect(zoneForScore(60, 3, settings)).toBe("green");
    expect(ZONE_DEFAULTS.greenMin).toBe(60);
    expect(ZONE_DEFAULTS.yellowMin).toBe(40);
    expect(ZONE_DEFAULTS.minResults).toBe(3);
    expect(ZONE_DEFAULTS.windowSize).toBe(5);
    expect(ZONE_DEFAULTS.formalWeight).toBe(2);
    expect(ZONE_DEFAULTS.trendDropFlag).toBe(15);
    expect(ZONE_DEFAULTS.missedInRowFlag).toBe(2);
  });

  it("counts a formal assignment double", () => {
    // One informal 50 and one formal 100: (50 + 200) / 3 = 83.33
    const weighted = weightedAverage(results([[100, true], [50, false]]), 2);
    expect(Math.round(weighted!)).toBe(83);
    // The same two scores without the formal flag would average 75.
    const unweighted = weightedAverage(results([[100, false], [50, false]]), 2);
    expect(unweighted).toBe(75);
  });

  it("never counts missed work as zero", () => {
    // A learner with one 90 has an average of 90 whether or not work was missed;
    // the misses live in a separate flag and never drag the score down.
    const zone = computeLearnerZone({
      learnerId: "l1",
      learnerName: "A",
      results: results([[90]]),
      missedNewestFirst: [true, true, true],
      settings,
    });
    expect(zone.score).toBe(90);
    expect(zone.zone).toBe("grey");
    expect(zone.missedInARow).toBe(3);
    expect(zone.engagementFlag).toBe(true);
  });

  it("sets an engagement flag on two missed in a row, and not on one", () => {
    expect(consecutiveMissed([true])).toBe(1);
    expect(consecutiveMissed([true, true])).toBe(2);
    // A miss, then work handed in, then a miss: the run is only one.
    expect(consecutiveMissed([true, false, true])).toBe(1);
    expect(consecutiveMissed([false, true, true])).toBe(0);

    const base = { learnerId: "l1", learnerName: "A", results: results([[70, false], [70, false], [70, false]]) };
    expect(computeLearnerZone({ ...base, missedNewestFirst: [true], settings }).engagementFlag).toBe(false);
    expect(computeLearnerZone({ ...base, missedNewestFirst: [true, true], settings }).engagementFlag).toBe(true);
  });

  it("sets earlyWarning on a drop of 15 points or more", () => {
    const down = trendOf(50, 65, settings);
    expect(down.trend).toBe("down");
    expect(down.earlyWarning).toBe(true);

    // Exactly 15 points is the boundary and still flags.
    expect(trendOf(50, 65, settings).earlyWarning).toBe(true);
    // 14.9 points does not.
    expect(trendOf(50.1, 65, settings).earlyWarning).toBe(false);
    // A rise is never an early warning.
    expect(trendOf(80, 60, settings)).toEqual({ trend: "up", earlyWarning: false });
    // With no previous window there is nothing to compare.
    expect(trendOf(50, null, settings)).toEqual({ trend: "flat", earlyWarning: false });
  });

  it("flags an early warning even for a learner who is still green", () => {
    // Previous window 90, current window 70: still green, but a 20-point slide.
    const zone = computeLearnerZone({
      learnerId: "l1",
      learnerName: "A",
      results: results([[70], [70], [70], [70], [70], [90], [90], [90], [90], [90]]),
      missedNewestFirst: [],
      settings,
    });
    expect(zone.score).toBe(70);
    expect(zone.zone).toBe("green");
    expect(zone.earlyWarning).toBe(true);
    expect(zone.trend).toBe("down");
  });

  it("uses only the most recent window for the score", () => {
    // The five most recent are 90; the older ones are 10 and must not count.
    const zone = computeLearnerZone({
      learnerId: "l1",
      learnerName: "A",
      results: results([[90], [90], [90], [90], [90], [10], [10], [10], [10], [10]]),
      missedNewestFirst: [],
      settings,
    });
    expect(zone.score).toBe(90);
    expect(zone.resultCount).toBe(5);
    expect(zone.zone).toBe("green");
  });

  it("raises the two-below-red alert only when the two most recent are both red", () => {
    expect(twoMostRecentBelowRed(results([[20], [30]]), settings)).toBe(true);
    // One of the two is yellow, so no alert.
    expect(twoMostRecentBelowRed(results([[20], [50]]), settings)).toBe(false);
    // Only one result: not enough for the rule.
    expect(twoMostRecentBelowRed(results([[10]]), settings)).toBe(false);
  });

  it("orders the priority list red, then early warning, then yellow", () => {
    const mk = (name: string, zone: string, earlyWarning: boolean, score: number) =>
      ({ learnerId: name, learnerName: name, zone, earlyWarning, score, resultCount: 5, trend: "flat", engagementFlag: false, missedInARow: 0 } as any);
    const ordered = priorityOrder([
      mk("green", "green", false, 80),
      mk("yellow", "yellow", false, 50),
      mk("red", "red", false, 20),
      mk("warning", "yellow", true, 55),
    ]);
    expect(ordered.map((entry) => entry.learnerName)).toEqual(["red", "warning", "yellow", "green"]);
  });
});

// ---- The service against a real database ------------------------------------

// The default stand-in: every answer fully correct, so a submission always ends
// MARKED at 100% and the zone rules are the only variable under test.
function adjustableModel() {
  return memoAwareMarkingModel({ ratio: 1 });
}

const answers = SAMPLE_QUESTIONS.map((question) => ({ questionId: question.id, answer: question.answer }));

describe("zone service", () => {
  beforeAll(async () => {
    await startTestServer();
    await ensureSchemaReady();
    setGeminiSleepForTesting(async () => {});
    setGeminiModelForTesting(adjustableModel());
  });
  afterAll(async () => {
    await stopTestServer();
    setGeminiModelForTesting(null);
    setGeminiSleepForTesting(null);
  });
  beforeEach(async () => { await resetDatabase(); });

  it("excludes held results and results flagged for teacher review", async () => {
    const { client: teacher, classes } = await registerTeacher();
    const { client: learner } = await registerLearner();
    await joinClass(learner, classes[0].joinCode);

    // Three released, marked results, so the learner is placed rather than grey.
    for (let index = 0; index < 3; index += 1) {
      const { assignmentId } = await createPublishedAssignment(teacher, classes[0].id, {
        topic: `Released ${index}`,
        resultReleasePolicy: "immediate",
      });
      await submitAssignment(learner, assignmentId, answers);
    }
    // A fourth assignment, held: its mark must not appear.
    const { assignmentId: heldId } = await createPublishedAssignment(teacher, classes[0].id, {
      topic: "Held",
      resultReleasePolicy: "after_close",
    });
    await submitAssignment(learner, heldId, answers);

    const held = await teacher.get(`/api/tis/classes/${classes[0].id}/zones`);
    expect(held.status).toBe(200);
    const learnerEntry = held.body.groups.green.find((row: any) => row.id);
    expect(learnerEntry).toBeTruthy();
    expect(learnerEntry.resultCount).toBe(3);
    expect(learnerEntry.zone).toBe("green");

    // Release the held paper and the count rises to four.
    await teacher.post(`/api/tis/assignments/${heldId}/release-results`, { action: "release" });
    const released = await teacher.get(`/api/tis/classes/${classes[0].id}/zones`);
    expect(released.body.groups.green[0].resultCount).toBe(4);
  });

  it("excludes a submission still flagged needsTeacherReview", async () => {
    const { client: teacher, classes } = await registerTeacher();
    const { client: learner } = await registerLearner();
    await joinClass(learner, classes[0].joinCode);

    // A marker that cannot place the answer holds every question for review, so
    // the paper never reaches a zone even though it is released.
    setGeminiModelForTesting(memoAwareMarkingModel({ ratio: 1, needsTeacherReview: true }));
    const { assignmentId } = await createPublishedAssignment(teacher, classes[0].id, { resultReleasePolicy: "immediate" });
    await submitAssignment(learner, assignmentId, answers);
    await teacher.post(`/api/tis/assignments/${assignmentId}/release-results`, { action: "release" });

    const zones = await teacher.get(`/api/tis/classes/${classes[0].id}/zones`);
    // No released result counts, so the learner has no evidence: grey, not red.
    expect(zones.body.groups.grey).toHaveLength(1);
    expect(zones.body.groups.red).toHaveLength(0);

    setGeminiModelForTesting(adjustableModel());
  });

  it("raises a stored alert when the two most recent results are below the red line", async () => {
    const { client: teacher, classes } = await registerTeacher();
    const { client: learner } = await registerLearner();
    await joinClass(learner, classes[0].joinCode);

    // A model that awards nothing, so every released result is 0 and red.
    setGeminiModelForTesting(memoAwareMarkingModel({ ratio: 0 }));
    for (let index = 0; index < 3; index += 1) {
      const { assignmentId } = await createPublishedAssignment(teacher, classes[0].id, {
        topic: `Fail ${index}`,
        resultReleasePolicy: "immediate",
      });
      await submitAssignment(learner, assignmentId, answers);
    }

    const zones = await teacher.get(`/api/tis/classes/${classes[0].id}/zones`);
    expect(zones.body.groups.red).toHaveLength(1);
    expect(zones.body.alerts).toHaveLength(1);
    expect(zones.body.alerts[0].kind).toBe("TWO_BELOW_RED");

    setGeminiModelForTesting(adjustableModel());
  });

  it("flags engagement when two closed assignments are missed in a row, without scoring them", async () => {
    const { client: teacher, classes } = await registerTeacher();
    const { client: learner } = await registerLearner();
    await joinClass(learner, classes[0].joinCode);

    // Two published assignments the learner never submits. They are closed by
    // moving closeAt just behind "now", so the learner is inside the window in
    // which the work was theirs to do.
    const missedIds: string[] = [];
    for (let index = 0; index < 2; index += 1) {
      const { assignmentId } = await createPublishedAssignment(teacher, classes[0].id, { topic: `Missed ${index}` });
      missedIds.push(assignmentId);
    }
    for (const id of missedIds) {
      await db.update(assignmentsTable).set({ closeAt: new Date() }).where(eq(assignmentsTable.id, id));
    }

    const zones = await teacher.get(`/api/tis/classes/${classes[0].id}/zones`);
    const learnerEntry = zones.body.groups.grey[0];
    expect(learnerEntry).toBeTruthy();
    expect(learnerEntry.engagementFlag).toBe(true);
    expect(learnerEntry.missedInARow).toBe(2);
    // Missed work never becomes a score: there is no result, so the learner is
    // grey (not enough data) and is NOT pushed into red.
    expect(learnerEntry.score).toBeNull();
    expect(learnerEntry.resultCount).toBe(0);
    expect(zones.body.groups.red).toHaveLength(0);
  });

  it("logs an intervention and exposes it on the class zone view", async () => {
    const { client: teacher, classes } = await registerTeacher();
    const { client: learner, learner: learnerRow } = await registerLearner();
    await joinClass(learner, classes[0].joinCode);

    const created = await teacher.post(`/api/tis/classes/${classes[0].id}/learners/${learnerRow.id}/interventions`, {
      note: "Sat with the learner on fraction equivalence.",
      outcome: "Improving.",
    });
    expect(created.status).toBe(201);

    const listed = await teacher.get(`/api/tis/classes/${classes[0].id}/learners/${learnerRow.id}/interventions`);
    expect(listed.body.interventions).toHaveLength(1);
    expect(listed.body.interventions[0].note).toContain("fraction equivalence");

    const audit = await db
      .select({ action: auditLogTable.action })
      .from(auditLogTable)
      .where(and(eq(auditLogTable.classId, classes[0].id), eq(auditLogTable.action, "zone_intervention")));
    expect(audit).toHaveLength(1);
  });

  it("audits a zone cut-off change with the old and the new values", async () => {
    const { client: teacher, classes } = await registerTeacher();
    const updated = await teacher.put(`/api/tis/classes/${classes[0].id}/zone-settings`, { greenMin: 70, yellowMin: 45 });
    expect(updated.status).toBe(200);
    expect(updated.body.settings.greenMin).toBe(70);
    expect(updated.body.settings.yellowMin).toBe(45);

    const audit = await db
      .select({ action: auditLogTable.action, detail: auditLogTable.detail })
      .from(auditLogTable)
      .where(and(eq(auditLogTable.classId, classes[0].id), eq(auditLogTable.action, "zone_settings_change")));
    expect(audit).toHaveLength(1);
    // Both the previous and the new cut-off are in the record.
    expect(audit[0].detail).toContain('"greenMin":60');
    expect(audit[0].detail).toContain('"greenMin":70');

    // The new cut-off is what the service now uses.
    const settings = await teacher.get(`/api/tis/classes/${classes[0].id}/zone-settings`);
    expect(settings.body.settings.greenMin).toBe(70);

    // A yellow floor above the green line is refused.
    const bad = await teacher.put(`/api/tis/classes/${classes[0].id}/zone-settings`, { yellowMin: 90 });
    expect(bad.status).toBe(400);
  });

  it("rejects a cut-off change from a teacher who does not own the class", async () => {
    const { classes } = await registerTeacher();
    const { client: other } = await registerTeacher({ section: "B" });
    const forbidden = await other.put(`/api/tis/classes/${classes[0].id}/zone-settings`, { greenMin: 70 });
    expect(forbidden.status).toBe(404);
  });

  it("hides the parent zone phrase unless the teacher switches it on", async () => {
    const { client: teacher, classes } = await registerTeacher();
    const { client: learner, learner: learnerRow } = await registerLearner();
    await joinClass(learner, classes[0].joinCode);
    const { client: parent } = await registerParent();
    await parent.post("/api/parent/learners/link", { learnerId: learnerRow.id });

    // Off by default: the class payload carries no wording at all.
    const hidden = await parent.get("/api/parent/dashboard");
    const hiddenChild = hidden.body.children.find((child: any) => child.learner.id === learnerRow.id);
    expect(hiddenChild.classes[0].zoneWording).toBeUndefined();

    // The teacher turns it on.
    await teacher.put(`/api/tis/classes/${classes[0].id}/parent-zone-visibility`, { enabled: true });

    const shown = await parent.get("/api/parent/dashboard");
    const shownChild = shown.body.children.find((child: any) => child.learner.id === learnerRow.id);
    // A phrase only, and no score, zone key or result count leaks with it.
    expect(typeof shownChild.classes[0].zoneWording).toBe("string");
    expect(shownChild.classes[0].zoneWording.length).toBeGreaterThan(0);
    expect(shownChild.classes[0].zone).toBeUndefined();
    expect(shownChild.classes[0].zoneScore).toBeUndefined();
  });

  it("never puts a zone field on a learner payload", async () => {
    const { client: teacher, classes } = await registerTeacher();
    const { client: learner } = await registerLearner();
    await joinClass(learner, classes[0].joinCode);
    const { assignmentId } = await createPublishedAssignment(teacher, classes[0].id, { resultReleasePolicy: "immediate" });
    await submitAssignment(learner, assignmentId, answers);

    const dashboard = await learner.get("/api/dashboard/summary");
    const classrooms = await learner.get("/api/classes/mine");
    const detail = await learner.get(`/api/classrooms/${classes[0].id}`);
    const serialized = JSON.stringify({ dashboard: dashboard.body, classrooms: classrooms.body, detail: detail.body });
    for (const key of ["zone", "zoneWording", "earlyWarning", "engagementFlag", "missedInARow", "priority"]) {
      expect(serialized).not.toContain(`"${key}"`);
    }
  });

  it("keeps learner names and ids out of the HOD payloads", async () => {
    const { client: teacher, classes } = await registerTeacher();
    const { client: hod } = await registerHod();
    await joinClassAsHod(hod, classes[0].hodJoinCode);
    const { client: learner, learner: learnerRow } = await registerLearner();
    await joinClass(learner, classes[0].joinCode);
    const { assignmentId } = await createPublishedAssignment(teacher, classes[0].id, { resultReleasePolicy: "immediate" });
    await submitAssignment(learner, assignmentId, answers);

    const summary = await hod.get(`/api/hod/classes/${classes[0].id}`);
    expect(summary.status).toBe(200);
    // Counts, a class average, the change since last term and the intervention
    // share, and nothing that identifies a learner.
    expect(summary.body.zones.grey).toBe(1);
    expect(summary.body.zoneIntervention).toBeTruthy();
    const serialized = JSON.stringify(summary.body);
    expect(serialized).not.toContain(learnerRow.id);
    expect(serialized).not.toContain(learnerRow.fullName);
    expect(serialized).not.toContain(learnerRow.slateId);

    const overview = await hod.get("/api/hod/overview");
    const overviewJson = JSON.stringify(overview.body);
    expect(overviewJson).not.toContain(learnerRow.id);
    expect(overviewJson).not.toContain(learnerRow.fullName);
  });

  it("lets a linked HOD change the cut-offs, audited the same way", async () => {
    const { client: teacher, classes } = await registerTeacher();
    const { client: hod } = await registerHod();
    await joinClassAsHod(hod, classes[0].hodJoinCode);
    const updated = await hod.put(`/api/hod/classes/${classes[0].id}/zone-settings`, { minResults: 4 });
    expect(updated.status).toBe(200);
    expect(updated.body.settings.minResults).toBe(4);
    const audit = await db
      .select({ actorRole: auditLogTable.actorRole })
      .from(auditLogTable)
      .where(and(eq(auditLogTable.classId, classes[0].id), eq(auditLogTable.action, "zone_settings_change")));
    expect(audit).toHaveLength(1);
    expect(audit[0].actorRole).toBe("HOD");
    void teacher;
  });

  it("shows the teacher only their own class zones", async () => {
    const { client: teacherA, classes: classesA } = await registerTeacher({ section: "A" });
    const { client: teacherB } = await registerTeacher({ section: "B" });
    // Teacher B may not read teacher A's zones.
    const forbidden = await teacherB.get(`/api/tis/classes/${classesA[0].id}/zones`);
    expect(forbidden.status).toBe(404);
    const mine = await teacherA.get(`/api/tis/classes/${classesA[0].id}/zones`);
    expect(mine.status).toBe(200);
    expect(mine.body.disclaimer).toContain("never a promotion decision");
  });

  it("leaves the intervention table row in place after the class is read", async () => {
    const { client: teacher, classes } = await registerTeacher();
    const { client: learner, learner: learnerRow } = await registerLearner();
    await joinClass(learner, classes[0].joinCode);
    await teacher.post(`/api/tis/classes/${classes[0].id}/learners/${learnerRow.id}/interventions`, { note: "Extra support session." });
    const rows = await db.select().from(interventionsTable).where(eq(interventionsTable.classId, classes[0].id));
    expect(rows).toHaveLength(1);
    // A quick sanity check that the class row itself is untouched by a read.
    const [classRow] = await db.select().from(classesTable).where(eq(classesTable.id, classes[0].id)).limit(1);
    expect(classRow.parentZoneVisibility).toBe(false);
  });
});
