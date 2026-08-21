import { randomBytes } from "node:crypto";
import { Router, type IRouter } from "express";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import {
  classesTable,
  db,
  learnersTable,
  tutorsTable,
} from "@workspace/db";
import { hashPassword, verifyPassword } from "../lib/auth";
import {
  createTutorSession,
  destroyTutorSession,
  getCurrentTutor,
  requireTutor,
  toPublicTutor,
} from "../lib/tutor-auth";
import { extractLessonSequence } from "../lib/ai";
import {
  buildClassOverview,
  buildClassSummary,
  buildLearnerDrillDown,
  serializeClass,
} from "../lib/class-views";
import {
  classesForOwner,
  createFamilyLearner,
  publicFamilyLearner,
  updateFamilyLearner,
} from "../lib/family-learners";

const router: IRouter = Router();

const RegisterTutorBody = z.object({
  fullName: z.string().trim().min(2).max(120),
  email: z.string().trim().email(),
  password: z.string().min(8).max(128),
});

const LoginTutorBody = z.object({
  email: z.string().trim().email(),
  password: z.string().min(1),
});

const CreateTutorClassBody = z.object({
  grade: z.number().int().min(1).max(12),
  section: z.string().trim().max(8).default(""),
  subject: z.string().trim().min(2).max(60),
  assignmentWindowDays: z.number().int().min(1).max(30).optional(),
});

const AddTutorLearnerBody = z.object({
  fullName: z.string().trim().min(2).max(120),
  grade: z.number().int().min(1).max(12),
  subjects: z.array(z.string().trim().min(2).max(60)).min(1).max(10),
});

const UpdateTutorLearnerBody = z.object({
  grade: z.number().int().min(1).max(12).optional(),
  subjects: z.array(z.string().trim().min(2).max(60)).min(1).max(10).optional(),
  assignmentWindowDays: z.number().int().min(1).max(30).optional(),
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

async function tutorLearners(tutorId: string) {
  const rows = await db.select().from(learnersTable).where(eq(learnersTable.tutorId, tutorId));
  return rows.map(publicFamilyLearner);
}

async function requireTutorClass(tutorId: string, classId: string) {
  const [row] = await db
    .select()
    .from(classesTable)
    .where(and(eq(classesTable.id, classId), eq(classesTable.tutorId, tutorId)))
    .limit(1);
  return row ?? null;
}

router.post("/tutor/auth/register", async (req, res) => {
  const parsed = RegisterTutorBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Please complete every field. Passwords need at least 8 characters." });
  const email = parsed.data.email.toLowerCase();
  try {
    const [existing] = await db.select({ id: tutorsTable.id }).from(tutorsTable).where(eq(tutorsTable.email, email)).limit(1);
    if (existing) return res.status(409).json({ error: "That email address already has a tutor account." });
    const [tutor] = await db.insert(tutorsTable).values({
      email,
      passwordHash: await hashPassword(parsed.data.password),
      fullName: parsed.data.fullName.trim(),
    }).returning();
    await createTutorSession(tutor.id, res);
    return res.status(201).json({ tutor: toPublicTutor(tutor), classes: [] });
  } catch (error) {
    req.log.error({ err: error }, "tutor registration failed");
    return res.status(400).json({ error: "We could not create that tutor account." });
  }
});

router.post("/tutor/auth/login", async (req, res) => {
  const parsed = LoginTutorBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Enter your email address and password." });
  const [tutor] = await db.select().from(tutorsTable).where(eq(tutorsTable.email, parsed.data.email.toLowerCase())).limit(1);
  if (!tutor || !(await verifyPassword(parsed.data.password, tutor.passwordHash))) {
    return res.status(401).json({ error: "That email or password is not correct." });
  }
  await createTutorSession(tutor.id, res);
  return res.json({ tutor: toPublicTutor(tutor), classes: await classesForOwner("tutor", tutor.id) });
});

router.post("/tutor/auth/logout", async (req, res) => {
  await destroyTutorSession(req, res);
  return res.status(204).send();
});

router.get("/tutor/auth/me", async (req, res) => {
  const tutor = await getCurrentTutor(req);
  if (!tutor) return res.json({ tutor: null, classes: [] });
  return res.json({ tutor: toPublicTutor(tutor), classes: await classesForOwner("tutor", tutor.id) });
});

router.get("/tutor/learners", async (req, res) => {
  const tutor = await requireTutor(req, res);
  if (!tutor) return;
  return res.json({ learners: await tutorLearners(tutor.id) });
});

router.post("/tutor/learners", async (req, res) => {
  const tutor = await requireTutor(req, res);
  if (!tutor) return;
  const parsed = AddTutorLearnerBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Give the learner's name, grade and at least one subject." });
  try {
    const result = await createFamilyLearner({
      kind: "tutor",
      ownerId: tutor.id,
      fullName: parsed.data.fullName,
      grade: parsed.data.grade,
      subjects: parsed.data.subjects,
    });
    return res.status(201).json(result);
  } catch (error) {
    req.log.error({ err: error }, "tutor learner creation failed");
    return res.status(400).json({ error: "We could not create that learner profile." });
  }
});

router.patch("/tutor/learners/:learnerId", async (req, res) => {
  const tutor = await requireTutor(req, res);
  if (!tutor) return;
  const [learner] = await db
    .select()
    .from(learnersTable)
    .where(and(eq(learnersTable.id, req.params.learnerId), eq(learnersTable.tutorId, tutor.id)))
    .limit(1);
  if (!learner) return res.status(404).json({ error: "That learner is not one of your students." });
  const parsed = UpdateTutorLearnerBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Check the grade, subjects and assignment window." });
  const result = await updateFamilyLearner({
    kind: "tutor",
    ownerId: tutor.id,
    learner,
    grade: parsed.data.grade,
    subjects: parsed.data.subjects,
    assignmentWindowDays: parsed.data.assignmentWindowDays,
  });
  return res.json(result);
});

router.post("/tutor/classes", async (req, res) => {
  const tutor = await requireTutor(req, res);
  if (!tutor) return;
  const parsed = CreateTutorClassBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Choose a grade and subject for the class." });
  const ownerFilter = and(
    eq(classesTable.tutorId, tutor.id),
    eq(classesTable.grade, parsed.data.grade),
    eq(classesTable.section, parsed.data.section.trim().toUpperCase()),
    eq(classesTable.subject, parsed.data.subject.trim()),
  );
  const [existing] = await db.select({ id: classesTable.id }).from(classesTable).where(ownerFilter).limit(1);
  if (existing) return res.status(409).json({ error: "You already have a class with that grade, section and subject." });
  await db.insert(classesTable).values({
    ownerType: "tutor",
    tutorId: tutor.id,
    grade: parsed.data.grade,
    section: parsed.data.section.trim().toUpperCase(),
    subject: parsed.data.subject.trim(),
    schoolName: "Tutoring",
    joinCode: generateJoinCode(),
    mode: "INDEPENDENT",
    assignmentWindowDays: parsed.data.assignmentWindowDays ?? 7,
  });
  return res.status(201).json({ classes: await classesForOwner("tutor", tutor.id) });
});

// The tutor's programme: PDF or text with objectives and lesson plans. Gemini
// extracts the sequence Slate will deliver with AI questions and marking.
router.post("/tutor/classes/:classId/curriculum", async (req, res) => {
  const tutor = await requireTutor(req, res);
  if (!tutor) return;
  const classRow = await requireTutorClass(tutor.id, req.params.classId);
  if (!classRow) return res.status(404).json({ error: "That class is not yours." });
  const parsed = CurriculumUploadBody.safeParse(req.body);
  if (!parsed.success || (!parsed.data.text?.trim() && !parsed.data.pdfBase64)) {
    return res.status(400).json({ error: "Upload a PDF or paste your programme text." });
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
        curriculumFileName: parsed.data.fileName?.trim() || (parsed.data.pdfBase64 ? "programme.pdf" : null),
        lessonSequence: sequence,
        currentTopicIndex: 0,
      })
      .where(eq(classesTable.id, classRow.id))
      .returning();
    return res.json({ class: serializeClass(updated), lessonSequence: sequence });
  } catch (error) {
    req.log.error({ err: error }, "tutor programme extraction failed");
    return res.status(502).json({ error: "That programme document could not be read right now. Please try again." });
  }
});

router.post("/tutor/classes/:classId/mode", async (req, res) => {
  const tutor = await requireTutor(req, res);
  if (!tutor) return;
  const classRow = await requireTutorClass(tutor.id, req.params.classId);
  if (!classRow) return res.status(404).json({ error: "That class is not yours." });
  const parsed = SetClassModeBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Choose a valid operating mode." });
  const [updated] = await db.update(classesTable).set({ mode: parsed.data.mode }).where(eq(classesTable.id, classRow.id)).returning();
  return res.json({ class: serializeClass(updated) });
});

router.get("/tutor/summary", async (req, res) => {
  const tutor = await requireTutor(req, res);
  if (!tutor) return;
  const rows = await db.select().from(classesTable).where(eq(classesTable.tutorId, tutor.id));
  return res.json({ tutor: toPublicTutor(tutor), classes: await buildClassSummary(rows) });
});

router.get("/tutor/classes/:classId/overview", async (req, res) => {
  const tutor = await requireTutor(req, res);
  if (!tutor) return;
  const classRow = await requireTutorClass(tutor.id, req.params.classId);
  if (!classRow) return res.status(404).json({ error: "That class is not yours." });
  return res.json(await buildClassOverview(classRow));
});

router.get("/tutor/classes/:classId/learners/:learnerId", async (req, res) => {
  const tutor = await requireTutor(req, res);
  if (!tutor) return;
  const classRow = await requireTutorClass(tutor.id, req.params.classId);
  if (!classRow) return res.status(404).json({ error: "That class is not yours." });
  const drillDown = await buildLearnerDrillDown(classRow, req.params.learnerId);
  if (!drillDown) return res.status(404).json({ error: "That learner is not in this class." });
  return res.json(drillDown);
});

export default router;
