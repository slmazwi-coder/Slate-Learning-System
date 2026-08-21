import { randomBytes } from "node:crypto";
import { Router, type IRouter } from "express";
import { and, eq, inArray, or } from "drizzle-orm";
import { z } from "zod";
import {
  assignmentsTable,
  classLearnersTable,
  classesTable,
  db,
  learnersTable,
  submissionsTable,
  teachersTable,
  tutorInvitationsTable,
  tutorsTable,
  usersTable,
} from "@workspace/db";
import { recordAudit } from "../lib/audit";
import {
  createTeacherSession,
  destroyTeacherSession,
  getCurrentTeacher,
  requireTeacher,
  teacherProfileForUser,
  toPublicTeacher,
} from "../lib/teacher-auth";
import { createOrMergeUser, verifyUserLogin } from "../lib/unified-auth";
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
  markingMode: z.enum(["auto", "selective", "manual"]).default("auto"),
  autoMarkQuestions: z.array(z.number().int().min(0).max(49)).optional(),
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
  try {
    const result = await createOrMergeUser({ email: data.email, password: data.password, fullName: data.fullName, role: "TEACHER" });
    if ("error" in result) return res.status(401).json({ error: result.error });
    const existingProfile = await teacherProfileForUser(result.user.id);
    if (existingProfile) return res.status(409).json({ error: "That email address already has a TIS account." });
    const [teacher] = await db.insert(teachersTable).values({
      userId: result.user.id,
      email: result.user.email,
      passwordHash: result.user.passwordHash,
      fullName: result.user.fullName,
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
  const user = await verifyUserLogin(parsed.data.email, parsed.data.password);
  if (!user || !user.roles.includes("TEACHER")) {
    return res.status(401).json({ error: "That email or password is not correct." });
  }
  const teacher = await teacherProfileForUser(user.id);
  if (!teacher) return res.status(401).json({ error: "That email or password is not correct." });
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

const RegenerateCodeResponse = { retryMax: 25 };

// Rotate the class join code. The old code is expired immediately because the
// column holds a single live code; the rotation is logged to the audit table.
router.post("/tis/classes/:classId/regenerate-code", async (req, res) => {
  const teacher = await requireTeacher(req, res);
  if (!teacher) return;
  const classRow = await requireTeacherClass(teacher.id, req.params.classId);
  if (!classRow) return res.status(404).json({ error: "That class is not on your timetable." });
  let next = "";
  for (let attempt = 0; attempt < RegenerateCodeResponse.retryMax && !next; attempt += 1) {
    const candidate = generateJoinCode();
    const [taken] = await db.select({ id: classesTable.id }).from(classesTable).where(eq(classesTable.joinCode, candidate)).limit(1);
    if (!taken) next = candidate;
  }
  if (!next) return res.status(503).json({ error: "Could not mint a fresh join code right now. Try again." });
  const [updated] = await db.update(classesTable).set({ joinCode: next }).where(eq(classesTable.id, classRow.id)).returning();
  await recordAudit({
    actorUserId: teacher.userId ?? "",
    actorRole: "TEACHER",
    action: "code_rotate",
    classId: classRow.id,
    detail: `Join code rotated for ${classRow.subject} (grade ${classRow.grade}${classRow.section || ""}).`,
  });
  return res.json({ class: serializeClass(updated) });
});

const InviteTutorBody = z.object({
  email: z.string().trim().min(3).max(200).optional(),
  username: z.string().trim().min(2).max(120).optional(),
});

// Invite a tutor to receive read-only CLIP access to this class on acceptance.
router.post("/tis/classes/:classId/invite-tutor", async (req, res) => {
  const teacher = await requireTeacher(req, res);
  if (!teacher) return;
  const classRow = await requireTeacherClass(teacher.id, req.params.classId);
  if (!classRow) return res.status(404).json({ error: "That class is not on your timetable." });
  const parsed = InviteTutorBody.safeParse(req.body);
  if (!parsed.success || (!parsed.data.email && !parsed.data.username)) {
    return res.status(400).json({ error: "Send the tutor's email or username." });
  }
  const contact = (parsed.data.email ?? parsed.data.username ?? "").trim();
  const matches = await db
    .select()
    .from(usersTable)
    .where(or(eq(usersTable.email, contact.toLowerCase()), eq(usersTable.fullName, contact)));
  const tutorMatches = matches.filter((entry) => entry.roles.includes("TUTOR"));
  const resolved = tutorMatches.length === 1 ? tutorMatches[0] : (matches.length === 1 ? matches[0] : null);
  if (!resolved) {
    return res.status(matches.length > 1 || tutorMatches.length > 1 ? 400 : 404).json({
      error: matches.length > 1 || tutorMatches.length > 1
        ? "More than one account matches that value. Ask for the tutor's email instead."
        : "No account found with that email or username.",
    });
  }
  if (!resolved.roles.includes("TUTOR")) {
    return res.status(404).json({ error: "That account does not hold a tutor role." });
  }
  const tutorUser = resolved;
  if (classRow.ownerType === "tutor" && classRow.tutorId) {
    const [ownerProfile] = await db.select({ userId: tutorsTable.userId }).from(tutorsTable).where(eq(tutorsTable.id, classRow.tutorId)).limit(1);
    if (ownerProfile?.userId === tutorUser.id) {
      return res.status(409).json({ error: "That tutor already owns this class." });
    }
  }
  try {
    const [invitation] = await db
      .insert(tutorInvitationsTable)
      .values({ classId: classRow.id, invitedByUserId: teacher.userId ?? "", tutorUserId: tutorUser.id })
      .returning();
    await recordAudit({
      actorUserId: teacher.userId ?? "",
      actorRole: "TEACHER",
      action: "tutor_invite",
      classId: classRow.id,
      memberId: tutorUser.id,
      memberType: "tutor",
      detail: `Tutor invitation sent (${contact}).`,
    });
    return res.status(201).json({
      invitation: {
        id: invitation.id,
        classId: invitation.classId,
        tutorEmail: tutorUser.email,
        tutorFullName: tutorUser.fullName,
        status: invitation.status,
        createdAt: invitation.createdAt.toISOString(),
      },
    });
  } catch {
    return res.status(409).json({ error: "A tutor invitation for that account already exists." });
  }
});

const ExpelMemberBody = z.object({
  memberId: z.string().uuid(),
  memberType: z.enum(["learner", "parent"]),
});

// Expel a member from the class. Membership rows are removed immediately;
// submissions, marks and CLIP history are never membership-scoped.
router.post("/tis/classes/:classId/expel", async (req, res) => {
  const teacher = await requireTeacher(req, res);
  if (!teacher) return;
  const classRow = await requireTeacherClass(teacher.id, req.params.classId);
  if (!classRow) return res.status(404).json({ error: "That class is not on your timetable." });
  const parsed = ExpelMemberBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Choose a valid member and member type." });
  const { memberId, memberType } = parsed.data;
  if (memberType === "learner") {
    const removed = await db
      .delete(classLearnersTable)
      .where(and(eq(classLearnersTable.classId, classRow.id), eq(classLearnersTable.learnerId, memberId)))
      .returning({ id: classLearnersTable.id });
    if (!removed.length) return res.status(404).json({ error: "That learner is not a member of this class." });
    await recordAudit({
      actorUserId: teacher.userId ?? "",
      actorRole: "TEACHER",
      action: "class_expel",
      classId: classRow.id,
      memberId,
      memberType: "learner",
      detail: removed.length > 1 ? `${removed.length} memberships removed` : "Membership removed",
    });
    return res.json({ removed: removed.length });
  }
  const children = await db.select({ id: learnersTable.id }).from(learnersTable).where(eq(learnersTable.parentId, memberId));
  if (!children.length) return res.status(404).json({ error: "No learners for that parent are known to this class." });
  const removed = await db
    .delete(classLearnersTable)
    .where(and(eq(classLearnersTable.classId, classRow.id), inArray(classLearnersTable.learnerId, children.map((child) => child.id))))
    .returning({ id: classLearnersTable.id });
  if (!removed.length) return res.status(404).json({ error: "That parent has no memberships in this class." });
  await recordAudit({
    actorUserId: teacher.userId ?? "",
    actorRole: "TEACHER",
    action: "class_expel",
    classId: classRow.id,
    memberId,
    memberType: "parent",
    detail: `${removed.length} child membership(s) removed`,
  });
  return res.json({ removed: removed.length });
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
  const allAutoIndices = data.markingMode === "selective" && data.autoMarkQuestions?.length === 0
    ? "Provided selective mode needs at least one auto-marked index, or none for full manual."
    : null;
  if (allAutoIndices) return res.status(400).json({ error: allAutoIndices });
  const autoMarkQuestions = data.markingMode === "selective" ? (data.autoMarkQuestions ?? []) : [];
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
    markingMode: data.markingMode,
    autoMarkQuestions,
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
      markingMode: assignment.markingMode,
      autoMarkQuestions: assignment.autoMarkQuestions,
    })),
  });
});

const MarkQuestionBody = z.object({
  questionIndex: z.number().int().min(0).max(49),
  score: z.number().min(0).max(100),
  comment: z.string().trim().max(500).optional(),
});

// Teacher manual marking. Resolves one pending question; once every question
// is scored the submission flips to MARKED and the learner's review unlocks.
router.post("/tis/submissions/:submissionId/mark", async (req, res) => {
  const teacher = await requireTeacher(req, res);
  if (!teacher) return;
  const parsed = MarkQuestionBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Send a question index, a score between 0 and 100 and a comment." });
  const [submission] = await db.select().from(submissionsTable).where(eq(submissionsTable.id, req.params.submissionId)).limit(1);
  if (!submission) return res.status(404).json({ error: "That submission was not found." });
  const [assignment] = await db.select().from(assignmentsTable).where(eq(assignmentsTable.id, submission.assignmentId)).limit(1);
  if (!assignment) return res.status(404).json({ error: "That assignment was not found." });
  const owned = assignment.classId
    ? await requireTeacherClass(teacher.id, assignment.classId)
    : null;
  if (!owned) return res.status(403).json({ error: "Only the owning teacher can mark that submission." });
  const marks = (submission.marks as Array<{ questionId: string; verdict: string; explanation: string; score: number | null; gap: string | null }>) ?? [];
  const index = parsed.data.questionIndex;
  if (index >= marks.length) return res.status(400).json({ error: `That submission only has ${marks.length} questions.` });
  const score = Math.max(0, Math.min(100, Math.round(parsed.data.score)));
  const verdict = score >= 80 ? "CORRECT" : score >= 40 ? "PARTIALLY_CORRECT" : "INCORRECT";
  const comment = parsed.data.comment?.trim() ?? "";
  const resolved = marks.map((mark, position) =>
    position === index
      ? { questionId: mark.questionId, verdict, explanation: comment || `Marked by teacher.`, score, gap: mark.gap }
      : mark,
  );
  const fullyMarked = resolved.every((mark) => mark.verdict !== "PENDING_TEACHER_REVIEW" && mark.score !== null);
  const markedScores = resolved.filter((mark) => mark.score !== null).map((mark) => mark.score as number);
  const newScore = markedScores.length ? Math.round(markedScores.reduce((total, value) => total + value, 0) / markedScores.length) : submission.score;
  const [updated] = await db
    .update(submissionsTable)
    .set({
      marks: resolved,
      markingStatus: fullyMarked ? "MARKED" : "PENDING_TEACHER_REVIEW",
      score: newScore,
    })
    .where(eq(submissionsTable.id, submission.id))
    .returning({ id: submissionsTable.id });
  return res.json({
    submissionId: submission.id,
    questionIndex: index,
    verdict,
    score: newScore,
    markingStatus: fullyMarked ? "MARKED" : "PENDING_TEACHER_REVIEW",
  });
});

export default router;
