import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { db, pool } from "@workspace/db";
import { classesTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { client, ensureSchemaReady, resetDatabase, startTestServer, stopTestServer } from "./harness";
import { registerLearner, registerParent, registerTeacher, registerTutor, joinClass } from "./fixtures";
import { lockClassesToPresetCurricula, presetSequenceForGrade, resolvePresetForClass } from "../lib/presets";

describe("class-creation preset gate", () => {
  beforeAll(async () => { await startTestServer(); await ensureSchemaReady(); });
  afterAll(async () => { await stopTestServer(); });
  beforeEach(async () => { await resetDatabase(); });

  it("accepts a subject with a hardwired preset curriculum", async () => {
    const { classes } = await registerTeacher({ grade: 8, subject: "Mathematics" });
    expect(classes).toHaveLength(1);
    expect(classes[0].presetSubject).toBe("Mathematics");
    expect(classes[0].lessonSequence.length).toBeGreaterThan(0);
    expect(classes[0].hasCurriculum).toBe(true);
  });

  it("rejects a subject with no preset curriculum, before writing anything", async () => {
    const c = client();
    const response = await c.post("/api/tis/auth/register", {
      fullName: "Teacher Two",
      email: `teacher-${Date.now()}@example.com`,
      schoolName: "Test High",
      password: "password123",
      classes: [{ grade: 8, section: "A", subject: "Underwater Basket Weaving" }],
    });
    expect(response.status).toBe(400);
    expect(response.body.error).toContain("no preset curriculum");
    expect(Array.isArray(response.body.allowedSubjects)).toBe(true);
    // The rejected registration left no account behind, so a retry can succeed.
    const retry = await c.post("/api/tis/auth/register", {
      fullName: "Teacher Two",
      email: `teacher-retry-${Date.now()}@example.com`,
      schoolName: "Test High",
      password: "password123",
      classes: [{ grade: 8, section: "A", subject: "Mathematics" }],
    });
    expect(retry.status).toBe(201);
  });

  it("gates a later class added to an existing teacher account too", async () => {
    const { client: teacher, classes } = await registerTeacher();
    const rejected = await teacher.post("/api/tis/classes", { grade: 8, section: "B", subject: "Underwater Basket Weaving" });
    expect(rejected.status).toBe(400);
    const accepted = await teacher.post("/api/tis/classes", { grade: 8, section: "B", subject: "Natural Sciences" });
    expect(accepted.status).toBe(201);
    expect(accepted.body.classes.length).toBe(classes.length + 1);
  });

  it("removed the teacher and parent curriculum upload endpoints", async () => {
    const { client: teacher, classes } = await registerTeacher();
    const { client: parent } = await registerParent();
    const teacherUpload = await teacher.post(`/api/tis/classes/${classes[0].id}/curriculum`, { text: "My own curriculum" });
    expect(teacherUpload.status).toBe(404);
    const parentUpload = await parent.post(`/api/parent/classes/${classes[0].id}/curriculum`, { text: "My own curriculum" });
    expect(parentUpload.status).toBe(404);
  });

  it("stores a tutor's programme as supplementary material, not as the curriculum", async () => {
    const { client: tutor, tutor: tutorRow } = await registerTutor();
    const created = await tutor.post("/api/tutor/classes", { grade: 8, section: "", subject: "Mathematics" });
    expect(created.status).toBe(201);
    const classId = created.body.classes[0].id;
    const programme = await tutor.post(`/api/tutor/classes/${classId}/programme`, {
      fileName: "my-programme.txt",
      text: "Term 1: fractions and decimals. Term 2: geometry. A full year of extra practice.",
    });
    expect(programme.status).toBe(201);

    const [row] = await db.select().from(classesTable).where(eq(classesTable.id, classId)).limit(1);
    // The CAPS preset still drives the sequence; the programme lives as material.
    const preset = (await resolvePresetForClass("Mathematics", 8))!;
    expect(row.lessonSequence).toEqual(presetSequenceForGrade(preset.preset, 8));
    expect(row.curriculumText).toBe(`Preset curriculum: ${preset.preset.sourceName}`);
    const { rows } = await pool.query(`select title, content from slate_class_materials where class_id = $1`, [classId]);
    expect(rows).toHaveLength(1);
    expect(rows[0].content).toContain("fractions and decimals");
    void tutorRow;
  });

  it("migrates an uploaded curriculum to the preset and archives the old text", async () => {
    const { client: teacher, classes } = await registerTeacher();
    const classId = classes[0].id;
    // Simulate a class created before the lock: an owner-uploaded curriculum.
    await db.update(classesTable).set({
      curriculumText: "My own Term 1: whatever I like. Term 2: more of the same.",
      curriculumFileName: "my-curriculum.txt",
      lessonSequence: ["My own topic A", "My own topic B"],
      currentTopicIndex: 1,
      // Legacy rows predate the lock marker, which is what makes the migration
      // pick them up.
      curriculumLockedAt: null,
    }).where(eq(classesTable.id, classId));

    const migrated = await lockClassesToPresetCurricula();
    expect(migrated).toBeGreaterThan(0);

    const [row] = await db.select().from(classesTable).where(eq(classesTable.id, classId)).limit(1);
    const preset = (await resolvePresetForClass("Mathematics", 8))!;
    expect(row.lessonSequence).toEqual(presetSequenceForGrade(preset.preset, 8));
    expect(row.currentTopicIndex).toBe(0);
    expect(row.curriculumText).toBe(`Preset curriculum: ${preset.preset.sourceName}`);
    // The old text is preserved, never deleted.
    expect(row.curriculumArchive).toBeTruthy();
    const archived = JSON.parse(row.curriculumArchive!);
    expect(archived.text).toContain("whatever I like");
    expect(archived.fileName).toBe("my-curriculum.txt");
    expect(archived.lessonSequence).toEqual(["My own topic A", "My own topic B"]);

    // A second run is a no-op: the class is already locked, so the archive is
    // not overwritten.
    const again = await lockClassesToPresetCurricula();
    expect(again).toBe(0);
    const [stable] = await db.select().from(classesTable).where(eq(classesTable.id, classId)).limit(1);
    expect(stable.curriculumArchive).toBe(row.curriculumArchive);
  });

  it("reports the archived curriculum to the owner instead of offering an upload", async () => {
    const { client: teacher, classes } = await registerTeacher();
    const classId = classes[0].id;
    await db.update(classesTable).set({ curriculumText: "Legacy upload", curriculumArchive: JSON.stringify({ text: "Legacy upload" }) })
      .where(eq(classesTable.id, classId));
    const response = await teacher.get("/api/tis/summary");
    const row = response.body.classes.find((entry: any) => entry.id === classId);
    expect(row.hasCurriculum).toBe(true);
    expect(row.hasArchivedCurriculum).toBe(true);
  });

  it("keeps a preset class's teaching position when the preset itself changes", async () => {
    const { classes } = await registerTeacher({ grade: 8, subject: "Mathematics" });
    const classId = classes[0].id;
    const preset = (await resolvePresetForClass("Mathematics", 8))!;
    const current = presetSequenceForGrade(preset.preset, 8);
    // Simulate a class that was following an OLDER version of the preset: its
    // stored sequence no longer matches (a topic was added upstream) and it has
    // already progressed part-way through the year. It predates the lock marker.
    await db.update(classesTable).set({
      lessonSequence: current.slice(0, 2),
      currentTopicIndex: 1,
      curriculumLockedAt: null,
    }).where(eq(classesTable.id, classId));

    await lockClassesToPresetCurricula();

    const [row] = await db.select().from(classesTable).where(eq(classesTable.id, classId)).limit(1);
    // The sequence is refreshed to the current preset...
    expect(row.lessonSequence).toEqual(current);
    // ...but the class is NOT sent back to the start of the syllabus.
    expect(row.currentTopicIndex).toBe(1);
    expect(row.curriculumLockedAt).toBeTruthy();
    // Nothing was archived: this class never had an uploaded curriculum.
    expect(row.curriculumArchive).toBeNull();
  });

  it("clamps the teaching position when a preset shrinks, instead of overflowing", async () => {
    const { classes } = await registerTeacher({ grade: 8, subject: "Mathematics" });
    const classId = classes[0].id;
    await db.update(classesTable).set({
      lessonSequence: ["a", "b", "c"],
      currentTopicIndex: 40,
      curriculumLockedAt: null,
    }).where(eq(classesTable.id, classId));

    await lockClassesToPresetCurricula();

    const [row] = await db.select().from(classesTable).where(eq(classesTable.id, classId)).limit(1);
    expect(row.currentTopicIndex).toBe(row.lessonSequence.length - 1);
  });

  it("never re-locks a class that is already marked locked", async () => {
    const { classes } = await registerTeacher({ grade: 8, subject: "Mathematics" });
    const classId = classes[0].id;
    // A locked class whose stored sequence has drifted (e.g. a preset edit).
    // The marker, not the content, decides — so it must be left alone.
    await db.update(classesTable).set({
      lessonSequence: ["hand-edited topic"],
      currentTopicIndex: 7,
    }).where(eq(classesTable.id, classId));

    const migrated = await lockClassesToPresetCurricula();
    expect(migrated).toBe(0);

    const [row] = await db.select().from(classesTable).where(eq(classesTable.id, classId)).limit(1);
    expect(row.lessonSequence).toEqual(["hand-edited topic"]);
    expect(row.currentTopicIndex).toBe(7);
  });

  it("marks a newly created class as locked straight away", async () => {
    const { classes } = await registerTeacher({ grade: 8, subject: "Mathematics" });
    const [row] = await db.select().from(classesTable).where(eq(classesTable.id, classes[0].id)).limit(1);
    expect(row.curriculumLockedAt).toBeTruthy();
    // So the migration is a no-op for it on the next boot.
    expect(await lockClassesToPresetCurricula()).toBe(0);
  });

  it("still lets learners join a preset-locked class", async () => {
    const { classes } = await registerTeacher();
    const { client: learner } = await registerLearner();
    const joined = await joinClass(learner, classes[0].joinCode);
    expect(joined.class.subject).toBe("Mathematics");
  });
});
