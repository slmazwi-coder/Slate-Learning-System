import { Router, type IRouter } from "express";
import { and, desc, eq, inArray, isNull, or } from "drizzle-orm";
import { z } from "zod";
import {
  assignmentsTable,
  assignmentSessionsTable,
  classFocusExemptionsTable,
  classHodsTable,
  classLearnersTable,
  classMaterialsTable,
  classesTable,
  db,
  learnersTable,
  liveSessionsTable,
  remediationActivitiesTable,
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
import { PRESET_SUBJECT_MAX_LENGTH, curriculumForClass, presetSubjects, resolvePresetForClass } from "../lib/presets";
import { generateSlateId } from "../lib/slate-id";
import { analyseLessonPlan, extractAssignmentQuestions, extractDocumentAssignment, extractScannedAssignment, generateFollowUp, generateProblemSet, type GeneratedQuestion } from "../lib/ai";
import { extractDocxText } from "../lib/docx";
import { classLearnerIds, conceptStats, loadClassData } from "../lib/class-insights";
import { applyConceptOutcomes } from "../lib/learning-profile";
import { resultsReleased, teacherReleaseState } from "../lib/result-release";
import { retryFailedMarkingForLearners } from "../lib/marking-retry";
import { rateLimit } from "../lib/rate-limit";
import { generateHodJoinCode, generateJoinCode } from "../lib/class-codes";
import {
  buildClassOverview,
  buildClassSummary,
  buildLearnerDrillDown,
  serializeClass,
  serializeClassesWithCounts,
} from "../lib/class-views";
import { buildMarkedScript, submissionById, submissionForLearner, teacherOwnsSubmission, teacherTeachesLearner } from "../lib/marked-script";
import { enrollLearnerInClass, publicFamilyLearner } from "../lib/family-learners";
import {
  activeLiveSession,
  focusEventsForSession,
} from "../lib/focus-mode";

const router: IRouter = Router();

const ClassInput = z.object({
  grade: z.number().int().min(0).max(13),
  section: z.string().trim().max(8).default(""),
  subject: z.string().trim().min(2).max(PRESET_SUBJECT_MAX_LENGTH),
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

const ReviewedQuestion = z.object({
  id: z.string().trim().min(1).max(80),
  prompt: z.string().trim().min(1).max(2000),
  type: z.enum(["text", "equation", "multiple_choice"]),
  options: z.array(z.string().trim().min(1).max(500)).max(6).optional(),
  concept: z.string().trim().min(1).max(200),
  answer: z.string().trim().min(1).max(1000),
}).superRefine((question, context) => {
  if (question.type === "multiple_choice" && (question.options?.length ?? 0) < 2) {
    context.addIssue({ code: "custom", message: "Multiple-choice questions need at least two options.", path: ["options"] });
  }
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
  questionTypes: z.array(z.enum(["multiple_choice", "text", "equation"])).min(1).max(3).default(["multiple_choice", "text"]),
  resultReleasePolicy: z.enum(["after_close", "immediate"]).default("after_close"),
  questionSource: z.enum(["ai", "manual", "pdf", "scan", "docx"]).default("ai"),
  questions: z.array(ReviewedQuestion).min(1).max(10).optional(),
  pdfBase64: z.string().min(1).max(7_000_000).optional(),
  imageBase64: z.string().min(1).max(7_000_000).optional(),
  imageMimeType: z.enum(["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"]).optional(),
  documentBase64: z.string().min(1).max(7_000_000).optional(),
  fileName: z.string().trim().max(200).optional(),
}).superRefine((body, context) => {
  if (body.questionSource === "manual" && (!body.questions || body.questions.length !== body.questionCount)) {
    context.addIssue({ code: "custom", message: "Enter exactly the selected number of questions.", path: ["questions"] });
  }
  if (body.questionSource === "pdf" && !body.pdfBase64) {
    context.addIssue({ code: "custom", message: "Upload a PDF to extract questions.", path: ["pdfBase64"] });
  }
  if (body.questionSource === "scan" && !body.imageBase64) {
    context.addIssue({ code: "custom", message: "Upload a photo or scan of the assignment.", path: ["imageBase64"] });
  }
  if (body.questionSource === "docx" && !body.documentBase64) {
    context.addIssue({ code: "custom", message: "Upload a Word document to extract questions.", path: ["documentBase64"] });
  }
  if (body.questionSource !== "manual" && body.questions) context.addIssue({ code: "custom", message: "Only manual authoring accepts question drafts.", path: ["questions"] });
  if (body.questionSource !== "pdf" && body.pdfBase64) context.addIssue({ code: "custom", message: "Only PDF extraction accepts a PDF payload.", path: ["pdfBase64"] });
  if (body.questionSource !== "scan" && body.imageBase64) context.addIssue({ code: "custom", message: "Only scanned extraction accepts an image payload.", path: ["imageBase64"] });
  if (body.questionSource !== "docx" && body.documentBase64) context.addIssue({ code: "custom", message: "Only Word extraction accepts a document payload.", path: ["documentBase64"] });
});

const LessonPlanBody = z.object({
  lessonPlan: z.string().trim().min(20).max(20000),
});

const SetClassModeBody = z.object({
  mode: z.enum(["TEACHER_DEPENDENT", "INDEPENDENT"]),
});

const PublishAssignmentBody = z.object({
  questions: z.array(ReviewedQuestion).min(1).max(10),
  // AI-drafted questions must be explicitly confirmed by the teacher before
  // publishing in Teacher-Dependent mode.
  confirmAiDraft: z.boolean().optional(),
}).superRefine((body, context) => {
  const ids = body.questions.map((question) => question.id);
  if (new Set(ids).size !== ids.length) {
    context.addIssue({ code: "custom", message: "Question IDs must be unique.", path: ["questions"] });
  }
});

const MaterialKind = z.enum(["NOTE", "REVISION", "QUIZ", "DEMONSTRATION"]);

const MaterialBody = z.object({
  title: z.string().trim().min(2).max(160),
  description: z.string().trim().max(600).default(""),
  kind: MaterialKind.default("NOTE"),
  content: z.string().max(200_000).optional(),
  fileName: z.string().trim().max(200).optional(),
  fileType: z.string().trim().max(120).optional(),
  fileBase64: z.string().max(4_200_000).optional(),
}).superRefine((body, context) => {
  if (!body.content?.trim() && !body.fileBase64) {
    context.addIssue({ code: "custom", message: "Add notes or attach a file.", path: ["content"] });
  }
});

// Postgres unique_violation.
function isUniqueViolation(error: unknown) {
  if (typeof error !== "object" || error === null) return false;
  const { code } = error as { code?: unknown };
  return code === "23505";
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

// Supplementary programme material for a class: a tutor's own programme or
// teacher notes, stored as study material. It is offered to the model as
// reference only — the preset CAPS sequence still drives pacing.
async function loadSupplementaryMaterial(classId: string): Promise<string> {
  const rows = await db
    .select({ title: classMaterialsTable.title, content: classMaterialsTable.content, fileName: classMaterialsTable.fileName })
    .from(classMaterialsTable)
    .where(eq(classMaterialsTable.classId, classId))
    .orderBy(desc(classMaterialsTable.createdAt))
    .limit(5);
  const parts = rows
    .map((row) => {
      const body = row.content?.trim();
      if (body) return `${row.title}: ${body.slice(0, 1500)}`;
      if (row.fileName) return `${row.title} (attached document: ${row.fileName})`;
      return "";
    })
    .filter(Boolean);
  return parts.join(" | ").slice(0, 6000);
}

router.post("/tis/auth/register", rateLimit({ scope: "teacher-register", usernameField: "email" }), async (req, res) => {
  const parsed = RegisterTeacherBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Please complete every field, including at least one class you teach." });
  const data = parsed.data;
  try {
    const seen = new Set<string>();
    const classSpecs = data.classes
      .map((entry) => ({ grade: entry.grade, section: entry.section.trim().toUpperCase(), subject: entry.subject.trim() }))
      .filter((entry) => {
        const key = `${entry.grade}|${entry.section}|${entry.subject.toLowerCase()}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    // Gate: only subjects with a hardwired preset curriculum may be created. This
    // runs before any account row is written, so a rejected class leaves nothing
    // behind that would make the retry collide with itself.
    for (const spec of classSpecs) {
      const preset = await resolvePresetForClass(spec.subject, spec.grade);
      if (!preset) {
        return res.status(400).json({
          error: `"${spec.subject}" (Grade ${spec.grade}) has no preset curriculum yet. Only subjects with a hardwired preset curriculum can be opened as classes.`,
          allowedSubjects: presetSubjects(),
        });
      }
    }
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
      slateId: await generateSlateId("teacher"),
    }).returning();
    const values = await Promise.all(classSpecs.map(async (spec) => {
      const { preset } = (await resolvePresetForClass(spec.subject, spec.grade))!;
      const curriculum = await curriculumForClass(preset, spec.grade);
      return {
        teacherId: teacher.id,
        presetSubject: preset.subject,
        grade: spec.grade,
        section: spec.section,
        subject: spec.subject,
        schoolName: teacher.schoolName,
        joinCode: generateJoinCode(),
        hodJoinCode: await generateHodJoinCode(),
        lessonSequence: curriculum.sequence,
        curriculumText: `Preset curriculum: ${curriculum.sourceName}`,
        curriculumFileName: curriculum.sourceName,
        curriculumLockedAt: new Date(),
      };
    }));
    await db.insert(classesTable).values(values);
    await createTeacherSession(teacher.id, res);
    return res.status(201).json({ teacher: toPublicTeacher(teacher), classes: await classesForTeacher(teacher.id) });
  } catch (error) {
    req.log.error({ err: error }, "teacher registration failed");
    return res.status(400).json({ error: "We could not create that TIS account." });
  }
});

router.post("/tis/auth/login", rateLimit({ scope: "teacher-login", usernameField: "email" }), async (req, res) => {
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
  const subject = parsed.data.subject.trim();
  const preset = await resolvePresetForClass(subject, parsed.data.grade);
  if (!preset) {
    return res.status(400).json({
      error: `"${subject}" (Grade ${parsed.data.grade}) has no preset curriculum yet. Only subjects with a hardwired preset curriculum can be opened as classes.`,
      allowedSubjects: presetSubjects(),
    });
  }
  try {
    const curriculum = await curriculumForClass(preset.preset, parsed.data.grade);
    await db.insert(classesTable).values({
      teacherId: teacher.id,
      presetSubject: preset.preset.subject,
      grade: parsed.data.grade,
      section: parsed.data.section.trim().toUpperCase(),
      subject,
      schoolName: teacher.schoolName,
      joinCode: generateJoinCode(),
      hodJoinCode: await generateHodJoinCode(),
      lessonSequence: curriculum.sequence,
      curriculumText: `Preset curriculum: ${curriculum.sourceName}`,
      curriculumFileName: curriculum.sourceName,
      curriculumLockedAt: new Date(),
    });
  } catch (error) {
    req.log.error({ err: error }, "class creation failed");
    // Only a unique violation means the class already exists; anything else is a
    // real failure and must not be reported to the teacher as a duplicate.
    if (isUniqueViolation(error)) {
      return res.status(409).json({ error: "You already teach a class with that grade, section and subject." });
    }
    return res.status(500).json({ error: "We could not open that class. Please try again." });
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
  // Marking reliability: the next time the teacher opens the class, any
  // submission whose Gemini marking failed is retried in the background, so a
  // temporary outage never strands a learner's work.
  await retryFailedMarkingForLearners(await classLearnerIds(classRow.id)).catch(() => undefined);
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

// Full marked script for one submission, editable by the owning teacher. Reachable
// from the submission list or a learner's row, one click.
router.get("/tis/submissions/:submissionId/script", async (req, res) => {
  const teacher = await requireTeacher(req, res);
  if (!teacher) return;
  const submission = await submissionById(req.params.submissionId);
  if (!submission) return res.status(404).json({ error: "That submission was not found." });
  if (!(await teacherOwnsSubmission(teacher.id, submission))) {
    return res.status(403).json({ error: "That submission is not in one of your classes." });
  }
  const script = await buildMarkedScript(submission, { editable: true });
  if (!script) return res.status(404).json({ error: "That marked script could not be found." });
  return res.json(script);
});

// Full marked script for a learner's most recent submission to one assignment.
router.get("/tis/classes/:classId/learners/:learnerId/assignments/:assignmentId/script", async (req, res) => {
  const teacher = await requireTeacher(req, res);
  if (!teacher) return;
  const classRow = await requireTeacherClass(teacher.id, req.params.classId);
  if (!classRow) return res.status(404).json({ error: "That class is not on your timetable." });
  if (!(await teacherTeachesLearner(teacher.id, req.params.learnerId))) {
    return res.status(403).json({ error: "That learner is not in one of your classes." });
  }
  const submission = await submissionForLearner(req.params.assignmentId, req.params.learnerId);
  if (!submission) return res.status(404).json({ error: "That learner has not submitted this assignment." });
  const script = await buildMarkedScript(submission, { editable: true });
  if (!script) return res.status(404).json({ error: "That marked script could not be found." });
  return res.json(script);
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

// ---------------------------------------------------------------------------
// HOD supervision, from the teacher's side.
//
// A teacher mints the HOD code, switches script access, and sees who
// supervises the class. There is deliberately NO route here that removes,
// blocks or hides a class from an HOD: the HOD is senior to the teacher, so
// the only ways a membership ends are the HOD leaving (/hod/classes/:id/leave)
// or Age Thirty4 support removing them out of band.
// ---------------------------------------------------------------------------

// Mint or rotate the class's HOD code. Rotating only changes which code future
// HODs may use; it never unlinks an HOD who has already joined.
router.post("/tis/classes/:classId/hod-code", async (req, res) => {
  const teacher = await requireTeacher(req, res);
  if (!teacher) return;
  const classRow = await requireTeacherClass(teacher.id, req.params.classId);
  if (!classRow) return res.status(404).json({ error: "That class is not on your timetable." });
  let next = "";
  try {
    next = await generateHodJoinCode();
  } catch {
    return res.status(503).json({ error: "Could not mint a fresh HOD code right now. Try again." });
  }
  const [updated] = await db.update(classesTable).set({ hodJoinCode: next }).where(eq(classesTable.id, classRow.id)).returning();
  await recordAudit({
    actorUserId: teacher.userId ?? "",
    actorRole: "TEACHER",
    action: "hod_code_rotate",
    classId: classRow.id,
    detail: `HOD code rotated for ${classRow.subject} (grade ${classRow.grade}${classRow.section || ""}). Existing HODs stay linked.`,
  });
  return res.json({ hodJoinCode: updated.hodJoinCode, class: serializeClass(updated) });
});

const HodScriptAccessBody = z.object({ enabled: z.boolean() });

// The teacher's switch for whether supervising HODs may open individual marked
// scripts. While off, HOD script routes return 403; class-level aggregates are
// always visible to an HOD and cannot be switched off.
router.put("/tis/classes/:classId/hod-script-access", async (req, res) => {
  const teacher = await requireTeacher(req, res);
  if (!teacher) return;
  const classRow = await requireTeacherClass(teacher.id, req.params.classId);
  if (!classRow) return res.status(404).json({ error: "That class is not on your timetable." });
  const parsed = HodScriptAccessBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Choose whether HODs may view scripts." });
  const [updated] = await db
    .update(classesTable)
    .set({ hodCanViewScripts: parsed.data.enabled })
    .where(eq(classesTable.id, classRow.id))
    .returning();
  await recordAudit({
    actorUserId: teacher.userId ?? "",
    actorRole: "TEACHER",
    action: "hod_script_access_toggle",
    classId: classRow.id,
    detail: `HOD script access ${parsed.data.enabled ? "enabled" : "disabled"} for ${classRow.subject} (grade ${classRow.grade}${classRow.section || ""}).`,
  });
  return res.json({ class: serializeClass(updated) });
});

// Who supervises this class, by name only. Read-only: there is no matching
// DELETE route, by design.
router.get("/tis/classes/:classId/hods", async (req, res) => {
  const teacher = await requireTeacher(req, res);
  if (!teacher) return;
  const classRow = await requireTeacherClass(teacher.id, req.params.classId);
  if (!classRow) return res.status(404).json({ error: "That class is not on your timetable." });
  const rows = await db
    .select({ id: classHodsTable.id, fullName: usersTable.fullName, joinedAt: classHodsTable.joinedAt })
    .from(classHodsTable)
    .innerJoin(usersTable, eq(usersTable.id, classHodsTable.hodUserId))
    .where(and(
      eq(classHodsTable.classId, classRow.id),
      isNull(classHodsTable.leftAt),
      isNull(classHodsTable.removedAt),
    ));
  return res.json({
    hods: rows.map((row) => ({ id: row.id, fullName: row.fullName, joinedAt: row.joinedAt.toISOString() })),
    hodCanViewScripts: classRow.hodCanViewScripts,
  });
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

// Manually add an existing learner (found by SLATE ID or name) to this class.
// The membership written is identical to the join-code path, so access and
// tracked work do not depend on how the learner was added.
const AddClassLearnerBody = z.object({ learnerId: z.string().uuid() });

router.post("/tis/classes/:classId/learners", async (req, res) => {
  const teacher = await requireTeacher(req, res);
  if (!teacher) return;
  const classRow = await requireTeacherClass(teacher.id, req.params.classId);
  if (!classRow) return res.status(404).json({ error: "That class is not on your timetable." });
  const parsed = AddClassLearnerBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Choose a learner to add." });
  const [learner] = await db.select().from(learnersTable).where(eq(learnersTable.id, parsed.data.learnerId)).limit(1);
  if (!learner) return res.status(404).json({ error: "That learner account was not found." });
  const updated = await enrollLearnerInClass(classRow, learner);
  await recordAudit({
    actorUserId: teacher.userId ?? "",
    actorRole: "TEACHER",
    action: "class_learner_add",
    classId: classRow.id,
    memberId: learner.id,
    memberType: "learner",
    detail: `Added ${learner.fullName} (${learner.slateId ?? learner.username}) to ${classRow.subject} (grade ${classRow.grade}${classRow.section || ""}).`,
  });
  return res.status(201).json({
    learner: publicFamilyLearner(updated),
    classes: await classesForTeacher(teacher.id),
  });
});

// Operating mode toggle: TEACHER_DEPENDENT (default, teacher drives all work)
// or INDEPENDENT (Slate auto-generates from the preset curriculum). Preset
// classes always carry their curriculum, so switching modes is always allowed.
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

// Curriculum is locked: a class always teaches the hardwired CAPS preset for
// its subject and grade. The upload/replace endpoints were removed so teachers
// and parents cannot replace the official curriculum.

// Study material a teacher shares with a class: notes, revision, class quizzes
// and demonstrations. Distinct from assignments — no marks or lock window.
function serializeMaterial(material: typeof classMaterialsTable.$inferSelect) {
  return {
    id: material.id,
    title: material.title,
    description: material.description,
    kind: material.kind,
    fileName: material.fileName,
    fileType: material.fileType,
    hasContent: Boolean(material.content && material.content.trim()),
    hasFile: Boolean(material.fileData),
    createdAt: material.createdAt.toISOString(),
  };
}

router.get("/tis/classes/:classId/materials", async (req, res) => {
  const teacher = await requireTeacher(req, res);
  if (!teacher) return;
  const classRow = await requireTeacherClass(teacher.id, req.params.classId);
  if (!classRow) return res.status(404).json({ error: "That class is not on your timetable." });
  const materials = await db
    .select()
    .from(classMaterialsTable)
    .where(eq(classMaterialsTable.classId, classRow.id))
    .orderBy(desc(classMaterialsTable.createdAt));
  return res.json({ materials: materials.map(serializeMaterial) });
});

router.post("/tis/classes/:classId/materials", async (req, res) => {
  const teacher = await requireTeacher(req, res);
  if (!teacher) return;
  const classRow = await requireTeacherClass(teacher.id, req.params.classId);
  if (!classRow) return res.status(404).json({ error: "That class is not on your timetable." });
  const parsed = MaterialBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Give the material a title and add notes or a file." });
  const [material] = await db
    .insert(classMaterialsTable)
    .values({
      classId: classRow.id,
      createdByTeacherId: teacher.id,
      title: parsed.data.title,
      description: parsed.data.description,
      kind: parsed.data.kind,
      content: parsed.data.content?.trim() || null,
      fileName: parsed.data.fileName || null,
      fileType: parsed.data.fileType || null,
      fileData: parsed.data.fileBase64 || null,
    })
    .returning();
  return res.status(201).json({ material: serializeMaterial(material) });
});

router.delete("/tis/classes/:classId/materials/:materialId", async (req, res) => {
  const teacher = await requireTeacher(req, res);
  if (!teacher) return;
  const classRow = await requireTeacherClass(teacher.id, req.params.classId);
  if (!classRow) return res.status(404).json({ error: "That class is not on your timetable." });
  const [removed] = await db
    .delete(classMaterialsTable)
    .where(and(eq(classMaterialsTable.id, req.params.materialId), eq(classMaterialsTable.classId, classRow.id)))
    .returning();
  if (!removed) return res.status(404).json({ error: "That material was not found." });
  return res.status(204).end();
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
  if (data.markingMode === "selective" && data.autoMarkQuestions?.length === 0) {
    return res.status(400).json({ error: "Choose at least one question to auto-mark, or use full manual marking." });
  }
  if ((data.autoMarkQuestions ?? []).some((index) => index >= data.questionCount)) {
    return res.status(400).json({ error: "An auto-mark question number is outside this assignment." });
  }
  const autoMarkQuestions = data.markingMode === "selective" ? (data.autoMarkQuestions ?? []) : [];
  const questionTypes = data.questionSource === "manual"
    ? [...new Set((data.questions ?? []).map((question) => question.type))]
    : data.questionTypes;
  let previews: Array<{ row: typeof rows[number]; curriculumContext: string; questions: GeneratedQuestion[] }>;
  try {
    previews = await Promise.all(rows.map(async (row) => {
      // The preset CAPS sequence always drives pacing. Any supplementary material
      // the owner added (a tutor's programme, teacher notes) is referenced by the
      // model but never replaces the preset sequence.
      const sequence = Array.isArray(row.lessonSequence) ? row.lessonSequence.filter(Boolean) : [];
      const supplementary = await loadSupplementaryMaterial(row.id);
      const curriculumContext = data.curriculumContext?.trim()
        || [
          `Grade ${row.grade} South African ${row.subject} curriculum.`,
          `Approved CAPS topic sequence (drives pacing): ${sequence.join(" → ") || "Use CAPS sequencing for this grade and subject."}`,
          supplementary
            ? `Supplementary programme material the owner supplied (may be referenced, does not replace the CAPS sequence): ${supplementary}.`
            : "",
          `Assignment focus: ${data.topic.trim()}.`,
        ].filter(Boolean).join(" ");
      try {
        let draftQuestions: unknown[];
        if (data.questionSource === "manual") {
          draftQuestions = (data.questions ?? []).map((question, index) => ({ ...question, id: `q${index + 1}` }));
        } else if (data.questionSource === "pdf") {
          draftQuestions = await extractAssignmentQuestions({
            grade: row.grade,
            subject: row.subject,
            topic: data.topic.trim(),
            curriculumContext,
            questionCount: data.questionCount,
            questionTypes: data.questionTypes,
            pdfBase64: data.pdfBase64!,
          });
        } else if (data.questionSource === "scan") {
          draftQuestions = await extractScannedAssignment({
            grade: row.grade,
            subject: row.subject,
            topic: data.topic.trim(),
            curriculumContext,
            questionCount: data.questionCount,
            questionTypes: data.questionTypes,
            imageBase64: data.imageBase64!,
            mimeType: data.imageMimeType ?? "image/jpeg",
          });
        } else if (data.questionSource === "docx") {
          draftQuestions = await extractDocumentAssignment({
            grade: row.grade,
            subject: row.subject,
            topic: data.topic.trim(),
            curriculumContext,
            questionCount: data.questionCount,
            questionTypes: data.questionTypes,
            documentText: extractDocxText(data.documentBase64!),
          });
        } else {
          draftQuestions = await generateProblemSet({
            learnerId: teacher.id,
            grade: row.grade,
            subject: row.subject,
            topic: data.topic.trim(),
            curriculumContext,
            questionCount: data.questionCount,
            questionTypes: data.questionTypes,
            uniquenessSeed: `teacher-preview:${teacher.id}:${row.id}:${Date.now()}`,
          });
        }
        const validatedQuestions = z.array(ReviewedQuestion).length(data.questionCount).safeParse(draftQuestions);
        if (!validatedQuestions.success) {
          throw new Error(`The ${data.questionSource === "pdf" ? "PDF extraction" : data.questionSource === "scan" ? "scan reading" : data.questionSource === "docx" ? "Word extraction" : "question draft"} did not produce ${data.questionCount} valid questions. Please review the source and try again.`);
        }
        return { row, curriculumContext, questions: validatedQuestions.data as GeneratedQuestion[] };
      } catch (error) {
        req.log.error({ err: error, classId: row.id, questionSource: data.questionSource }, "assignment question draft failed");
        throw error instanceof Error ? error : new Error(`Questions could not be prepared for ${row.subject}.`);
      }
    }));
  } catch (error) {
    return res.status(502).json({
      error: error instanceof Error ? error.message : "Questions could not be prepared. Please try again.",
    });
  }
  const created = await db.insert(assignmentsTable).values(previews.map(({ row, curriculumContext, questions }) => ({
    title: data.title?.trim() || data.topic.trim(),
    subject: row.subject,
    topic: data.topic.trim(),
    curriculumContext,
    openAt,
    closeAt,
    questionCount: data.questionCount,
    classId: row.id,
    createdByTeacherId: teacher.id,
    markingMode: data.markingMode,
    autoMarkQuestions,
    questionTypes,
    questionBlueprint: questions,
    questionSource: data.questionSource,
    isPublished: false,
    resultReleasePolicy: data.resultReleasePolicy,
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
      questionTypes: assignment.questionTypes,
      resultReleasePolicy: assignment.resultReleasePolicy,
      questionSource: assignment.questionSource,
      // AI-generated questions and answer keys must be reviewed and confirmed by
      // the teacher before publishing. The flag marks the draft as AI-authored.
      aiDraft: assignment.questionSource !== "manual",
      isPublished: assignment.isPublished,
      questions: assignment.questionBlueprint,
    })),
  });
});

router.post("/tis/assignments/:assignmentId/publish", async (req, res) => {
  const teacher = await requireTeacher(req, res);
  if (!teacher) return;
  const parsed = PublishAssignmentBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Review each question and include a valid answer key before publishing." });
  const [assignment] = await db.select().from(assignmentsTable).where(eq(assignmentsTable.id, req.params.assignmentId)).limit(1);
  if (!assignment) return res.status(404).json({ error: "That assignment was not found." });
  if (!assignment.classId || !(await requireTeacherClass(teacher.id, assignment.classId))) {
    return res.status(403).json({ error: "Only the owning teacher can publish this assignment." });
  }
  if (parsed.data.questions.length !== assignment.questionCount) {
    return res.status(400).json({ error: `This assignment needs exactly ${assignment.questionCount} questions.` });
  }
  // Teacher-Dependent mode: an AI-drafted question set (questionSource "ai",
  // "pdf", "scan" or "docx") must be explicitly confirmed by the teacher, who
  // reviews every prompt and answer key, before it can reach learners.
  const isAiDraft = assignment.questionSource !== "manual";
  const [classRow] = assignment.classId
    ? await db.select().from(classesTable).where(eq(classesTable.id, assignment.classId)).limit(1)
    : [];
  const teacherDependent = (classRow?.mode ?? "TEACHER_DEPENDENT") === "TEACHER_DEPENDENT";
  if (isAiDraft && teacherDependent && parsed.data.confirmAiDraft !== true) {
    return res.status(400).json({
      error: "This is an AI draft. Confirm you have reviewed the AI-generated questions and answer keys before publishing.",
      requiresAiDraftConfirmation: true,
    });
  }
  const [published] = await db.update(assignmentsTable)
    .set({ questionBlueprint: parsed.data.questions as GeneratedQuestion[], isPublished: true })
    .where(eq(assignmentsTable.id, assignment.id))
    .returning();
  return res.json({
    id: published.id,
    isPublished: published.isPublished,
    publishedAt: new Date().toISOString(),
    questionCount: published.questionCount,
  });
});

// ---- Focus mode (tab lock) teacher controls ----
// Focus mode is on by default per assignment. It only locks homework; a live
// class session makes it alert-only, and an exemption turns it off for one
// learner (e.g. assistive technology).

const FocusToggleBody = z.object({ enabled: z.boolean() });

// Turn focus mode on or off for an assignment. Allowed until the first paper is
// submitted, after which the setting is locked so it cannot be changed
// mid-homework (which would be unfair to learners already working).
router.post("/tis/assignments/:assignmentId/focus-mode", async (req, res) => {
  const teacher = await requireTeacher(req, res);
  if (!teacher) return;
  const parsed = FocusToggleBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Send whether focus mode should be on or off." });
  const [assignment] = await db.select().from(assignmentsTable).where(eq(assignmentsTable.id, req.params.assignmentId)).limit(1);
  if (!assignment) return res.status(404).json({ error: "That assignment was not found." });
  const classRow = assignment.classId ? await requireTeacherClass(teacher.id, assignment.classId) : null;
  if (!classRow) return res.status(403).json({ error: "Only the owning teacher can change focus mode." });
  const [existingSubmission] = await db.select({ id: submissionsTable.id })
    .from(submissionsTable)
    .where(eq(submissionsTable.assignmentId, assignment.id))
    .limit(1);
  if (existingSubmission) {
    return res.status(409).json({ error: "Focus mode can no longer be changed: a learner has already submitted this assignment." });
  }
  const [updated] = await db.update(assignmentsTable)
    .set({ focusMode: parsed.data.enabled })
    .where(eq(assignmentsTable.id, assignment.id))
    .returning();
  await recordAudit({
    actorUserId: teacher.userId ?? "",
    actorRole: "TEACHER",
    action: "focus_mode_change",
    classId: classRow.id,
    detail: `${parsed.data.enabled ? "Enabled" : "Disabled"} focus mode for "${assignment.title}".`,
  });
  return res.json({ assignmentId: updated.id, focusMode: updated.focusMode });
});

// Start a live class session. While it runs, focus mode is alert-only: the
// teacher is told who leaves the page, but nothing is warned or auto-submitted.
router.post("/tis/classes/:classId/live-session/start", async (req, res) => {
  const teacher = await requireTeacher(req, res);
  if (!teacher) return;
  const classRow = await requireTeacherClass(teacher.id, req.params.classId);
  if (!classRow) return res.status(404).json({ error: "That class is not on your timetable." });
  const existing = await activeLiveSession(classRow.id);
  if (existing) return res.json({ sessionId: existing.id, startedAt: existing.startedAt.toISOString(), active: true });
  const [created] = await db.insert(liveSessionsTable).values({ classId: classRow.id, startedBy: teacher.userId ?? null }).returning();
  await recordAudit({
    actorUserId: teacher.userId ?? "",
    actorRole: "TEACHER",
    action: "live_session_start",
    classId: classRow.id,
    detail: `Started a live session for ${classRow.subject}, grade ${classRow.grade}${classRow.section || ""}.`,
  });
  return res.status(201).json({ sessionId: created.id, startedAt: created.startedAt.toISOString(), active: true });
});

// End the live session, returning focus mode to its normal locked behaviour.
router.post("/tis/classes/:classId/live-session/end", async (req, res) => {
  const teacher = await requireTeacher(req, res);
  if (!teacher) return;
  const classRow = await requireTeacherClass(teacher.id, req.params.classId);
  if (!classRow) return res.status(404).json({ error: "That class is not on your timetable." });
  const active = await activeLiveSession(classRow.id);
  if (active) {
    await db.update(liveSessionsTable).set({ endedAt: new Date() }).where(eq(liveSessionsTable.id, active.id));
    await recordAudit({
      actorUserId: teacher.userId ?? "",
      actorRole: "TEACHER",
      action: "live_session_end",
      classId: classRow.id,
      detail: `Ended the live session for ${classRow.subject}, grade ${classRow.grade}${classRow.section || ""}.`,
    });
  }
  return res.json({ active: false });
});

// Focus-mode status for a class: whether a live session is running, and the
// exits recorded since it began.
router.get("/tis/classes/:classId/focus-status", async (req, res) => {
  const teacher = await requireTeacher(req, res);
  if (!teacher) return;
  const classRow = await requireTeacherClass(teacher.id, req.params.classId);
  if (!classRow) return res.status(404).json({ error: "That class is not on your timetable." });
  const live = await activeLiveSession(classRow.id);
  const data = await loadClassData(classRow);
  const events = live
    ? await Promise.all(data.submissions.map(async (submission) => ({
      submissionId: submission.id,
      learnerId: submission.learnerId,
      autoSubmitted: submission.autoSubmitted,
      events: await focusEventsForSession(submission.sessionId),
    })))
    : [];
  return res.json({
    liveSession: live ? { sessionId: live.id, startedAt: live.startedAt.toISOString(), active: true } : null,
    alertOnly: Boolean(live),
    focusAlerts: events.flatMap((entry) => entry.events.map((event) => ({ ...event, submissionId: entry.submissionId, learnerId: entry.learnerId }))),
  });
});

// Reopen a paper that focus mode ended, so the learner may continue. The
// learner's submission is removed and a fresh attempt runs with their saved
// answers restored. Only the owning teacher can do this.
router.post("/tis/submissions/:submissionId/reopen", async (req, res) => {
  const teacher = await requireTeacher(req, res);
  if (!teacher) return;
  const [submission] = await db.select().from(submissionsTable).where(eq(submissionsTable.id, req.params.submissionId)).limit(1);
  if (!submission) return res.status(404).json({ error: "That submission was not found." });
  const [assignment] = await db.select().from(assignmentsTable).where(eq(assignmentsTable.id, submission.assignmentId)).limit(1);
  if (!assignment) return res.status(404).json({ error: "That assignment was not found." });
  const classRow = assignment.classId ? await requireTeacherClass(teacher.id, assignment.classId) : null;
  if (!classRow) return res.status(403).json({ error: "Only the owning teacher can reopen that paper." });
  if (!submission.autoSubmitted) {
    return res.status(409).json({ error: "Only a paper that focus mode submitted can be reopened." });
  }
  const draft = (submission.answers as Array<{ questionId: string; answer: string }> | null) ?? [];
  // Clear the focus state on the attempt and restore the learner's answers, so
  // they pick up exactly where focus mode interrupted them.
  await db.update(assignmentSessionsTable)
    .set({
      focusWarningCount: 0,
      focusAcknowledgedWarnings: 0,
      focusDeadlineAt: null,
      focusAwaySince: null,
      focusAutoSubmittedAt: null,
      focusDraftAnswers: draft,
    })
    .where(eq(assignmentSessionsTable.id, submission.sessionId));
  await db.update(submissionsTable)
    .set({
      autoSubmitted: false,
      reopenedAt: new Date(),
      reopenedBy: teacher.userId ?? null,
      reopenReason: "Reopened by teacher after focus mode auto-submitted.",
    })
    .where(eq(submissionsTable.id, submission.id));
  // Remove the auto-submitted paper itself so the learner's next submit is a
  // clean one; their draft answers were copied onto the session above.
  await db.delete(submissionsTable).where(eq(submissionsTable.id, submission.id));
  await recordAudit({
    actorUserId: teacher.userId ?? "",
    actorRole: "TEACHER",
    action: "focus_reopen",
    classId: classRow.id,
    memberId: submission.learnerId,
    memberType: "learner",
    detail: `Reopened "${assignment.title}" after focus mode submitted it (${submission.autoSubmitReason ?? "auto-submit"}).`,
  });
  return res.json({ reopened: true, assignmentId: assignment.id, learnerId: submission.learnerId, sessionId: submission.sessionId });
});

const FocusExemptionBody = z.object({
  learnerId: z.string().trim().min(1),
  exempt: z.boolean(),
  reason: z.string().trim().max(300).optional(),
});

// Exempt one learner from focus mode in a class (e.g. a learner using assistive
// technology that legitimately needs another window).
router.post("/tis/classes/:classId/focus-exemption", async (req, res) => {
  const teacher = await requireTeacher(req, res);
  if (!teacher) return;
  const parsed = FocusExemptionBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Choose a learner and whether they are exempt." });
  const classRow = await requireTeacherClass(teacher.id, req.params.classId);
  if (!classRow) return res.status(404).json({ error: "That class is not on your timetable." });
  const [membership] = await db.select({ id: classLearnersTable.id })
    .from(classLearnersTable)
    .where(and(eq(classLearnersTable.classId, classRow.id), eq(classLearnersTable.learnerId, parsed.data.learnerId)))
    .limit(1);
  if (!membership) return res.status(404).json({ error: "That learner is not in this class." });
  await db.insert(classFocusExemptionsTable)
    .values({
      classId: classRow.id,
      learnerId: parsed.data.learnerId,
      exempt: parsed.data.exempt,
      reason: parsed.data.reason ?? "",
      setBy: teacher.userId ?? null,
    })
    .onConflictDoUpdate({
      target: [classFocusExemptionsTable.classId, classFocusExemptionsTable.learnerId],
      set: { exempt: parsed.data.exempt, reason: parsed.data.reason ?? "", setBy: teacher.userId ?? null },
    });
  await recordAudit({
    actorUserId: teacher.userId ?? "",
    actorRole: "TEACHER",
    action: "focus_exemption",
    classId: classRow.id,
    memberId: parsed.data.learnerId,
    memberType: "learner",
    detail: `${parsed.data.exempt ? "Exempted" : "Removed the exemption for"} a learner in ${classRow.subject}, grade ${classRow.grade}${classRow.section || ""}.`,
  });
  return res.json({ learnerId: parsed.data.learnerId, exempt: parsed.data.exempt });
});

const ReleaseResultsBody = z.object({
  // "release" publishes results now; "hold" hides them again.
  action: z.enum(["release", "hold"]),
});

// Teacher-controlled result release. A teacher can release results at any time
// (before or after close) or hold them again. Every action is audited. Learners
// and parents see marks only while results are released.
router.post("/tis/assignments/:assignmentId/release-results", async (req, res) => {
  const teacher = await requireTeacher(req, res);
  if (!teacher) return;
  const parsed = ReleaseResultsBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Choose whether to release or hold the results." });
  const [assignment] = await db.select().from(assignmentsTable).where(eq(assignmentsTable.id, req.params.assignmentId)).limit(1);
  if (!assignment) return res.status(404).json({ error: "That assignment was not found." });
  const classRow = assignment.classId ? await requireTeacherClass(teacher.id, assignment.classId) : null;
  if (!classRow) return res.status(403).json({ error: "Only the owning teacher can release these results." });
  const now = new Date();
  const releasing = parsed.data.action === "release";
  const [updated] = await db
    .update(assignmentsTable)
    .set(releasing ? { resultsReleasedAt: now, resultsHeldAt: null } : { resultsHeldAt: now })
    .where(eq(assignmentsTable.id, assignment.id))
    .returning();
  // Releasing results also releases any paper focus mode had held for review,
  // so a single teacher action makes those results visible.
  if (releasing) {
    await db.update(submissionsTable)
      .set({ resultsHeldForReview: false })
      .where(eq(submissionsTable.assignmentId, assignment.id));
  }
  await recordAudit({
    actorUserId: teacher.userId ?? "",
    actorRole: "TEACHER",
    action: releasing ? "results_release" : "results_hold",
    classId: classRow.id,
    detail: `${releasing ? "Released" : "Held"} results for "${assignment.title}" (${classRow.subject}, grade ${classRow.grade}${classRow.section || ""}).`,
  });
  return res.json({
    assignmentId: updated.id,
    releaseState: teacherReleaseState(updated) ?? "HELD",
    resultsReleasedAt: updated.resultsReleasedAt?.toISOString() ?? null,
    resultsHeldAt: updated.resultsHeldAt?.toISOString() ?? null,
    resultsVisibleNow: resultsReleased(updated, now),
  });
});

const MarkQuestionBody = z.object({
  questionIndex: z.number().int().min(0).max(49),
  score: z.number().min(0).max(100),
  comment: z.string().trim().max(500).optional(),
});

// Teacher marking and override. Resolves one question (held or already
// auto-marked) and, once every question is scored, flips the submission to
// MARKED. Overriding an AI-awarded score or comment is audited, and both the
// learner's concept gaps and learning profile are updated to match.
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
  const [session] = await db.select({ questions: assignmentSessionsTable.questions })
    .from(assignmentSessionsTable)
    .where(eq(assignmentSessionsTable.id, submission.sessionId))
    .limit(1);
  const sessionQuestions = (session?.questions as GeneratedQuestion[] | undefined) ?? [];
  const questionConcept = sessionQuestions[index]?.concept?.trim() || assignment.topic;
  if (!sessionQuestions[index]) return res.status(409).json({ error: "The submitted question set could not be found. Refresh the marking queue and try again." });
  const previous = marks[index];
  const score = Math.max(0, Math.min(100, Math.round(parsed.data.score)));
  const verdict = score >= 80 ? "CORRECT" : score >= 40 ? "PARTIALLY_CORRECT" : "INCORRECT";
  const comment = parsed.data.comment?.trim() ?? "";
  const resolved = marks.map((mark, position) =>
    position === index
      ? { questionId: mark.questionId, verdict, explanation: comment || "Marked by your teacher.", score, gap: score < 80 ? questionConcept : null }
      : mark,
  );
  const fullyMarked = resolved.every((mark) => mark.verdict !== "PENDING_TEACHER_REVIEW" && mark.score !== null);
  const markedScores = resolved.filter((mark) => mark.score !== null).map((mark) => mark.score as number);
  const newScore = markedScores.length ? Math.round(markedScores.reduce((total, value) => total + value, 0) / markedScores.length) : submission.score;
  const overallVerdict = newScore >= 80 ? "CORRECT" : newScore >= 40 ? "PARTIALLY_CORRECT" : "INCORRECT";
  // A previous AI verdict (or a different earlier teacher score) means this save
  // is an override, which is audited and folded into the learning profile.
  const overridden = Boolean(previous && previous.verdict !== "PENDING_TEACHER_REVIEW" && (previous.score !== score || previous.explanation !== (comment || previous.explanation)));
  const [updated] = await db
    .update(submissionsTable)
    .set({
      marks: resolved,
      markingStatus: fullyMarked ? "MARKED" : "PENDING_TEACHER_REVIEW",
      score: newScore,
      overallVerdict: fullyMarked ? overallVerdict : submission.overallVerdict,
      feedback: fullyMarked ? "Your teacher reviewed every question. Read the comments below for the next step." : submission.feedback,
    })
    .where(eq(submissionsTable.id, submission.id))
    .returning({ id: submissionsTable.id });
  if (overridden) {
    await recordAudit({
      actorUserId: teacher.userId ?? "",
      actorRole: "TEACHER",
      action: "marking_override",
      classId: assignment.classId,
      memberId: submission.learnerId,
      memberType: "learner",
      detail: `Override on question ${index + 1} of "${assignment.title}": ${previous?.score ?? "—"}% → ${score}%.`,
    });
  }
  // Overrides and manual marks both update the learner's concept gaps and
  // learning profile, so the next recommendation reflects the teacher's view.
  await applyConceptOutcomes(
    submission.learnerId,
    resolved.map((mark, position) => ({ concept: sessionQuestions[position]?.concept?.trim() || assignment.topic, score: mark.score })),
  );
  let remediation = null;
  if (fullyMarked) {
    const weakQuestion = resolved.find((mark) => mark.score !== null && mark.score < 80 && mark.gap);
    if (weakQuestion?.gap) {
      try {
        const [existingActivity] = await db.select()
          .from(remediationActivitiesTable)
          .where(and(
            eq(remediationActivitiesTable.assignmentId, assignment.id),
            eq(remediationActivitiesTable.learnerId, submission.learnerId),
            isNull(remediationActivitiesTable.completedAt),
          ))
          .orderBy(desc(remediationActivitiesTable.createdAt))
          .limit(1);
        const activity = existingActivity ?? await (async () => {
          const followUp = await generateFollowUp({ concept: weakQuestion.gap!, subject: assignment.subject });
          const [created] = await db.insert(remediationActivitiesTable).values({
            learnerId: submission.learnerId,
            assignmentId: assignment.id,
            format: "QUIZ",
            title: `Practice ${weakQuestion.gap}`,
            concept: weakQuestion.gap!,
            prompt: followUp.prompt,
            options: followUp.options ?? [],
            instruction: "Try this next question to strengthen this skill.",
            expectedAnswer: followUp.answer,
          }).returning();
          return created;
        })();
        remediation = {
          id: activity.id,
          format: activity.format,
          title: activity.title,
          concept: activity.concept,
          prompt: activity.prompt,
          options: activity.options,
          instruction: activity.instruction,
        };
      } catch (error) {
        req.log.warn({ err: error, submissionId: submission.id }, "manual marking follow-up generation failed");
      }
    }
  }
  return res.json({
    submissionId: submission.id,
    questionIndex: index,
    verdict,
    score: newScore,
    overallVerdict: fullyMarked ? overallVerdict : submission.overallVerdict,
    markingStatus: fullyMarked ? "MARKED" : "PENDING_TEACHER_REVIEW",
    remediation,
  });
});

export default router;
