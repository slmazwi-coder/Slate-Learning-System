import { randomBytes } from "node:crypto";
import { Router, type IRouter } from "express";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import {
  assignmentsTable,
  classesTable,
  db,
  teachersTable,
} from "@workspace/db";
import { hashPassword, verifyPassword } from "../lib/auth";
import {
  createTeacherSession,
  destroyTeacherSession,
  getCurrentTeacher,
  requireTeacher,
  toPublicTeacher,
} from "../lib/teacher-auth";
import { analyseLessonPlan, extractLessonSequence } from "../lib/ai";
import { conceptStats, loadClassData } from "../lib/class-insights";
import {
  buildClassOverview,
  buildClassSummary,
  buildLearnerDrillDown,
  serializeClass,
  serializeClassesWithCounts,
} from "../lib/class-views";

const router: IRouter = Router();

const ClassInput = z.object({
  grade: z.number().int().min(1).max(12),
  section: z.string().trim().max(8).default(""),
  subject: z.string().trim().min(2).max(60),
});

const RegisterTeacherBody = z.object({
  fullName: z.string().trim().min(2).max(120),
  email: z.string().trim().email(),
  schoolName: z.string().trim().min(2).max(160),
  password: z.string().min(8).max(128),
  classes: z.array(ClassInput).min(1).max(30),
});

const LoginTeacherBody = z.object({
  email: z.string().trim().email(),
  password: z.string().min(1),
});

const CreateAssignmentBody = z.object({
  classIds: z.array(z.string().uuid()).min(1).max(30),
  title: z.string().trim().min(3).max(160).optional(),
  topic: z.string().trim().min(2).max(160),
  curriculumContext: z.string().trim().max(600).optional(),
  questionCount: z.number().int().min(1).max(10).default(4),
  openAt: z.string().datetime({ offset: true }),
  closeAt: z.string().datetime({ offset: true }),
});

const LessonPlanBody = z.object({
  lessonPlan: z.string().trim().min(20).max(20000),
});

const SetClassModeBody = z.object({
  mode: z.enum(["TEACHER_DEPENDENT", "INDEPENDENT"]),
});

const CurriculumUploadBody = z.object({
  fileName: z.string().trim().max(200).optional(),
  text: z.string().max(200000).optional(),
  pdfBase64: z.string().max(8_000_000).optional(),
});

function generateJoinCode() {
  return randomBytes(4).toString("hex").toUpperCase().slice(0, 6);
}

async function classesForTeacher(teacherId: string) {
  const rows = await db.select().from(classesTable).where(eq(classesTable.teacherId, teacherId));
  return serializeClassesWithCounts(rows);
}

async function requireTeacherClass(teacherId: string, classId: string) {
  const [row] = await db
    .select()
    .from(classesTable)
    .where(and(eq(classesTable.id, classId), eq(classesTable.teacherId, teacherId)))
    .limit(1);
  return row ?? null;
}

router.post("/tis/auth/register", async (req, res) => {
  const parsed = RegisterTeacherBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Please complete every field, including at least one class you teach." });
  const data = parsed.data;
  const email = data.email.toLowerCase();
  try {
    const [existing] = await db.select({ id: teachersTable.id }).from(teachersTable).where(eq(teachersTable.email, email)).limit(1);
    if (existing) return res.status(409).json({ error: "That email address already has a TIS account." });
    const [teacher] = await db.insert(teachersTable).values({
      email,
      passwordHash: await hashPassword(data.password),
      fullName: data.fullName.trim(),
      schoolName: data.schoolName.trim(),
    }).returning();
    const seen = new Set<string>();
    const values = data.classes
      .map((entry) => ({
        teacherId: teacher.id,
        grade: entry.grade,
        section: entry.section.trim().toUpperCase(),
        subject: entry.subject.trim(),
        schoolName: teacher.schoolName,
        joinCode: generateJoinCode(),
      }))
      .filter((entry) => {
        const key = `${entry.grade}|${entry.section}|${entry.subject.toLowerCase()}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    await db.insert(classesTable).values(values);
    await createTeacherSession(teacher.id, res);
    return res.status(201).json({ teacher: toPublicTeacher(teacher), classes: await classesForTeacher(teacher.id) });
  } catch (error) {
    req.log.error({ err: error }, "teacher registration failed");
    return res.status(400).json({ error: "We could not create that TIS account." });
  }
});

router.post("/tis/auth/login", async (req, res) => {
  const parsed = LoginTeacherBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Enter your email address and password." });
  const [teacher] = await db.select().from(teachersTable).where(eq(teachersTable.email, parsed.data.email.toLowerCase())).limit(1);
  if (!teacher || !(await verifyPassword(parsed.data.password, teacher.passwordHash))) {
    return res.status(401).json({ error: "That email or password is not correct." });
  }
  await createTeacherSession(teacher.id, res);
  return res.json({ teacher: toPublicTeacher(teacher), classes: await classesForTeacher(teacher.id) });
});

router.post("/tis/auth/logout", async (req, res) => {
  await destroyTeacherSession(req, res);
  return res.status(204).send();
});

router.get("/tis/auth/me", async (req, res) => {
  const teacher = await getCurrentTeacher(req);
  if (!teacher) return res.json({ teacher: null, classes: [] });
  return res.json({ teacher: toPublicTeacher(teacher), classes: await classesForTeacher(teacher.id) });
});

router.post("/tis/classes", async (req, res) => {
  const teacher = await requireTeacher(req, res);
  if (!teacher) return;
  const parsed = ClassInput.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Choose a grade and subject for the class." });
  try {
    await db.insert(classesTable).values({
      teacherId: teacher.id,
      grade: parsed.data.grade,
      section: parsed.data.section.trim().toUpperCase(),
      subject: parsed.data.subject.trim(),
      schoolName: teacher.schoolName,
      joinCode: generateJoinCode(),
    });
  } catch (error) {
    req.log.error({ err: error }, "class creation failed");
    return res.status(409).json({ error: "You already teach a class with that grade, section and subject." });
  }
  return res.status(201).json({ classes: await classesForTeacher(teacher.id) });
});

// Cross-class summary: one row per class the teacher takes.
router.get("/tis/summary", async (req, res) => {
  const teacher = await requireTeacher(req, res);
  if (!teacher) return;
  const rows = await db.select().from(classesTable).where(eq(classesTable.teacherId, teacher.id));
  return res.json({ teacher: toPublicTeacher(teacher), classes: await buildClassSummary(rows) });
});

router.get("/tis/classes/:classId/overview", async (req, res) => {
  const teacher = await requireTeacher(req, res);
  if (!teacher) return;
  const classRow = await requireTeacherClass(teacher.id, req.params.classId);
  if (!classRow) return res.status(404).json({ error: "That class is not on your timetable." });
  return res.json(await buildClassOverview(classRow));
});

router.get("/tis/classes/:classId/learners/:learnerId", async (req, res) => {
  const teacher = await requireTeacher(req, res);
  if (!teacher) return;
  const classRow = await requireTeacherClass(teacher.id, req.params.classId);
  if (!classRow) return res.status(404).json({ error: "That class is not on your timetable." });
  const drillDown = await buildLearnerDrillDown(classRow, req.params.learnerId);
  if (!drillDown) return res.status(404).json({ error: "That learner is not in this class." });
  return res.json(drillDown);
});

// Operating mode toggle: TEACHER_DEPENDENT (default, teacher drives all work)
// or INDEPENDENT (Slate auto-generates from the uploaded curriculum).
router.post("/tis/classes/:classId/mode", async (req, res) => {
  const teacher = await requireTeacher(req, res);
  if (!teacher) return;
  const classRow = await requireTeacherClass(teacher.id, req.params.classId);
  if (!classRow) return res.status(404).json({ error: "That class is not on your timetable." });
  const parsed = SetClassModeBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Choose a valid operating mode." });
  const [updated] = await db
    .update(classesTable)
    .set({ mode: parsed.data.mode })
    .where(eq(classesTable.id, classRow.id))
    .returning();
  return res.json({ class: serializeClass(updated) });
});

// Curriculum upload for INDEPENDENT mode: PDF (base64) or plain text. Gemini
// reads the document and extracts the ordered lesson sequence Slate will teach.
router.post("/tis/classes/:classId/curriculum", async (req, res) => {
  const teacher = await requireTeacher(req, res);
  if (!teacher) return;
  const classRow = await requireTeacherClass(teacher.id, req.params.classId);
  if (!classRow) return res.status(404).json({ error: "That class is not on your timetable." });
  const parsed = CurriculumUploadBody.safeParse(req.body);
  if (!parsed.success || (!parsed.data.text?.trim() && !parsed.data.pdfBase64)) {
    return res.status(400).json({ error: "Upload a PDF or paste the curriculum text." });
  }
  try {
    const sequence = await extractLessonSequence({
      grade: classRow.grade,
      subject: classRow.subject,
      text: parsed.data.text?.trim() || undefined,
      pdfBase64: parsed.data.pdfBase64,
    });
    const [updated] = await db
      .update(classesTable)
      .set({
        curriculumText: parsed.data.text?.trim() || null,
        curriculumFileName: parsed.data.fileName?.trim() || (parsed.data.pdfBase64 ? "curriculum.pdf" : null),
        lessonSequence: sequence,
        currentTopicIndex: 0,
      })
      .where(eq(classesTable.id, classRow.id))
      .returning();
    return res.json({ class: serializeClass(updated), lessonSequence: sequence });
  } catch (error) {
    req.log.error({ err: error }, "curriculum extraction failed");
    return res.status(502).json({ error: "That curriculum document could not be read right now. Please try again." });
  }
});

router.post("/tis/classes/:classId/lesson-plan", async (req, res) => {
  const teacher = await requireTeacher(req, res);
  if (!teacher) return;
  const classRow = await requireTeacherClass(teacher.id, req.params.classId);
  if (!classRow) return res.status(404).json({ error: "That class is not on your timetable." });
  const parsed = LessonPlanBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Paste your lesson plan before running the analysis." });
  const data = await loadClassData(classRow);
  const gaps = conceptStats(data)
    .filter((stat) => stat.strugglingPercentage > 0)
    .slice(0, 8)
    .map((stat) => ({ concept: stat.concept, strugglingPercentage: stat.strugglingPercentage, averageScore: stat.averageScore }));
  try {
    const analysis = await analyseLessonPlan({
      grade: classRow.grade,
      section: classRow.section,
      subject: classRow.subject,
      gaps,
      lessonPlan: parsed.data.lessonPlan,
    });
    return res.json({ class: serializeClass(classRow, data.learners.length), gaps, analysis });
  } catch (error) {
    req.log.error({ err: error }, "lesson plan analysis failed");
    return res.status(502).json({ error: "The lesson plan could not be analysed right now. Please try again." });
  }
});

router.post("/tis/assignments", async (req, res) => {
  const teacher = await requireTeacher(req, res);
  if (!teacher) return;
  const parsed = CreateAssignmentBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Check the class, topic, question count and times." });
  const data = parsed.data;
  const openAt = new Date(data.openAt);
  const closeAt = new Date(data.closeAt);
  if (closeAt <= openAt) return res.status(400).json({ error: "The close time must be after the open time." });
  const rows = await db
    .select()
    .from(classesTable)
    .where(and(eq(classesTable.teacherId, teacher.id), inArray(classesTable.id, data.classIds)));
  if (rows.length !== data.classIds.length) return res.status(404).json({ error: "One of those classes is not on your timetable." });
  const created = await db.insert(assignmentsTable).values(rows.map((row) => ({
    title: data.title?.trim() || data.topic.trim(),
    subject: row.subject,
    topic: data.topic.trim(),
    curriculumContext: data.curriculumContext?.trim()
      || `Grade ${row.grade} South African ${row.subject} (CAPS): ${data.topic.trim()}.`,
    openAt,
    closeAt,
    questionCount: data.questionCount,
    classId: row.id,
    createdByTeacherId: teacher.id,
  }))).returning();
  return res.status(201).json({
    assignments: created.map((assignment) => ({
      id: assignment.id,
      classId: assignment.classId,
      title: assignment.title,
      subject: assignment.subject,
      topic: assignment.topic,
      openAt: assignment.openAt.toISOString(),
      closeAt: assignment.closeAt.toISOString(),
      questionCount: assignment.questionCount,
    })),
  });
});

export default router;
