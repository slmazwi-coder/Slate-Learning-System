import { Router, type IRouter } from "express";
import { and, desc, eq, gte, inArray, or, sql } from "drizzle-orm";
import { z } from "zod";
import {
  assignmentsTable,
  authSessionsTable,
  classLearnersTable,
  classesTable,
  db,
  learningActivitiesTable,
  learningProfilesTable,
  learnerSessionActivityTable,
  learnersTable,
  parentLearnersTable,
  parentsTable,
  submissionsTable,
  usersTable,
} from "@workspace/db";
import {
  createParentSession,
  destroyParentSession,
  getCurrentParent,
  parentProfileForUser,
  requireParent,
  toPublicParent,
} from "../lib/parent-auth";
import { createOrMergeUser, verifyUserLogin } from "../lib/unified-auth";
import { closeExpiredLearnerSessions, hashPassword, revokeLearnerSessions, verifyPassword } from "../lib/auth";
import { extractLessonSequence } from "../lib/ai";
import { serializeClass } from "../lib/class-views";
import { buildMarkedScript } from "../lib/marked-script";
import { PRESET_SUBJECT_MAX_LENGTH } from "../lib/presets";
import {
  classesForOwner,
  createFamilyLearner,
  generateLearnerPassword,
  publicFamilyLearner,
  updateFamilyLearner,
} from "../lib/family-learners";

const router: IRouter = Router();

const RegisterParentBody = z.object({
  fullName: z.string().trim().min(2).max(120),
  email: z.string().trim().email(),
  password: z.string().min(8).max(128),
});

const LoginParentBody = z.object({
  email: z.string().trim().email(),
  password: z.string().min(1),
});

const CreateChildBody = z.object({
  fullName: z.string().trim().min(2).max(120),
  grade: z.number().int().min(0).max(13),
  subjects: z.array(z.string().trim().min(2).max(PRESET_SUBJECT_MAX_LENGTH)).min(1).max(10),
  password: z.string().min(8).max(128).optional(),
  assignmentWindowDays: z.number().int().min(1).max(30).optional(),
});

const UpdateChildBody = z.object({
  grade: z.number().int().min(0).max(13).optional(),
  subjects: z.array(z.string().trim().min(2).max(PRESET_SUBJECT_MAX_LENGTH)).min(1).max(10).optional(),
  assignmentWindowDays: z.number().int().min(1).max(30).optional(),
});

const CurriculumUploadBody = z.object({
  fileName: z.string().trim().max(200).optional(),
  text: z.string().max(200000).optional(),
  pdfBase64: z.string().max(8_000_000).optional(),
});

async function parentLearnerRows(parentId: string) {
  const [linkedRows, legacyRows] = await Promise.all([
    db
      .select({ learner: learnersTable })
      .from(parentLearnersTable)
      .innerJoin(learnersTable, eq(learnersTable.id, parentLearnersTable.learnerId))
      .where(eq(parentLearnersTable.parentId, parentId)),
    db.select().from(learnersTable).where(eq(learnersTable.parentId, parentId)),
  ]);
  const uniqueRows = new Map<string, typeof learnersTable.$inferSelect>();
  for (const row of linkedRows) uniqueRows.set(row.learner.id, row.learner);
  for (const learner of legacyRows) uniqueRows.set(learner.id, learner);
  return [...uniqueRows.values()];
}

async function parentLearners(parentId: string) {
  return (await parentLearnerRows(parentId)).map(publicFamilyLearner);
}

async function requireParentLearner(parentId: string, learnerId: string) {
  const [row] = await db
    .select({ learner: learnersTable })
    .from(learnersTable)
    .leftJoin(parentLearnersTable, eq(parentLearnersTable.learnerId, learnersTable.id))
    .where(and(
      eq(learnersTable.id, learnerId),
      or(eq(parentLearnersTable.parentId, parentId), eq(learnersTable.parentId, parentId)),
    ))
    .limit(1);
  return row?.learner ?? null;
}

router.post("/parent/auth/register", async (req, res) => {
  const parsed = RegisterParentBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Please complete every field. Passwords need at least 8 characters." });
  try {
    const email = parsed.data.email.trim().toLowerCase();
    const [existingParent] = await db
      .select({ id: parentsTable.id })
      .from(parentsTable)
      .where(sql`lower(${parentsTable.email}) = ${email}`)
      .limit(1);
    if (existingParent) return res.status(409).json({ error: "That email address already has a parent account." });

    const [existingUser] = await db
      .select()
      .from(usersTable)
      .where(sql`lower(${usersTable.email}) = ${email}`)
      .limit(1);
    let parent;
    if (existingUser?.roles.includes("LEARNER")) {
      // Learner email is contact information, not the parent's login identity.
      // Keep separate credentials when an older learner already owns this email.
      [parent] = await db.insert(parentsTable).values({
        email,
        passwordHash: await hashPassword(parsed.data.password),
        fullName: parsed.data.fullName.trim(),
      }).returning();
    } else {
      const result = await createOrMergeUser({ email, password: parsed.data.password, fullName: parsed.data.fullName, role: "PARENT" });
      if ("error" in result) return res.status(401).json({ error: result.error });
      const existingProfile = await parentProfileForUser(result.user.id);
      if (existingProfile) return res.status(409).json({ error: "That email address already has a parent account." });
      [parent] = await db.insert(parentsTable).values({
        userId: result.user.id,
        email: result.user.email,
        passwordHash: result.user.passwordHash,
        fullName: result.user.fullName,
      }).returning();
    }
    await createParentSession(parent.id, res);
    return res.status(201).json({ parent: toPublicParent(parent), learners: [] });
  } catch (error) {
    req.log.error({ err: error }, "parent registration failed");
    return res.status(400).json({ error: "We could not create that parent account." });
  }
});

router.post("/parent/auth/login", async (req, res) => {
  const parsed = LoginParentBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Enter your email address and password." });
  const email = parsed.data.email.trim().toLowerCase();
  const user = await verifyUserLogin(email, parsed.data.password);
  if (user?.roles.includes("PARENT")) {
    const parent = await parentProfileForUser(user.id);
    if (parent) {
      await createParentSession(parent.id, res);
      return res.json({ parent: toPublicParent(parent), learners: await parentLearners(parent.id) });
    }
  }
  const [separateParent] = await db
    .select()
    .from(parentsTable)
    .where(sql`lower(${parentsTable.email}) = ${email}`)
    .limit(1);
  if (!separateParent || separateParent.userId || !(await verifyPassword(parsed.data.password, separateParent.passwordHash))) {
    return res.status(401).json({ error: "That email or password is not correct." });
  }
  await createParentSession(separateParent.id, res);
  return res.json({ parent: toPublicParent(separateParent), learners: await parentLearners(separateParent.id) });
});

router.post("/parent/auth/logout", async (req, res) => {
  await destroyParentSession(req, res);
  return res.status(204).send();
});

router.get("/parent/auth/me", async (req, res) => {
  const parent = await getCurrentParent(req);
  if (!parent) return res.json({ parent: null, learners: [] });
  return res.json({ parent: toPublicParent(parent), learners: await parentLearners(parent.id) });
});

router.post("/parent/learners", async (req, res) => {
  const parent = await requireParent(req, res);
  if (!parent) return;
  const parsed = CreateChildBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Give your child's name, grade and at least one subject." });
  try {
    const result = await createFamilyLearner({
      kind: "parent",
      ownerId: parent.id,
      fullName: parsed.data.fullName,
      grade: parsed.data.grade,
      subjects: parsed.data.subjects,
      email: parent.email,
      password: parsed.data.password,
      assignmentWindowDays: parsed.data.assignmentWindowDays,
    });
    return res.status(201).json(result);
  } catch (error) {
    req.log.error({ err: error }, "parent learner creation failed");
    return res.status(400).json({ error: "We could not create that learner profile." });
  }
});

router.post("/parent/learners/:learnerId/reset-password", async (req, res): Promise<void> => {
  const parent = await requireParent(req, res);
  if (!parent) return;
  const learner = await requireParentLearner(parent.id, req.params.learnerId);
  if (!learner) {
    res.status(404).json({ error: "That learner profile is not linked to your account." });
    return;
  }
  const password = generateLearnerPassword();
  await db.update(learnersTable)
    .set({ passwordHash: await hashPassword(password) })
    .where(eq(learnersTable.id, learner.id));
  await revokeLearnerSessions(learner.id);
  res.json({ credentials: { username: learner.username, password } });
});

router.patch("/parent/learners/:learnerId", async (req, res) => {
  const parent = await requireParent(req, res);
  if (!parent) return;
  const learner = await requireParentLearner(parent.id, req.params.learnerId);
  if (!learner) return res.status(404).json({ error: "That learner profile is not linked to your account." });
  const parsed = UpdateChildBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Check the grade, subjects and assignment window." });
  const result = await updateFamilyLearner({
    kind: "parent",
    ownerId: parent.id,
    learner,
    grade: parsed.data.grade,
    subjects: parsed.data.subjects,
    assignmentWindowDays: parsed.data.assignmentWindowDays,
  });
  return res.json(result);
});

router.get("/parent/learners/:learnerId/submissions/:submissionId/review", async (req, res): Promise<void> => {
  const parent = await requireParent(req, res);
  if (!parent) return;
  const learner = await requireParentLearner(parent.id, req.params.learnerId);
  if (!learner) {
    res.status(404).json({ error: "That learner profile is not linked to your account." });
    return;
  }
  const script = await buildMarkedScript(req.params.submissionId);
  if (!script || script.learner.id !== learner.id) {
    res.status(404).json({ error: "That submission was not found for this learner." });
    return;
  }
  if (!script.submission.released) {
    res.status(409).json({ error: "This marked script is not available yet." });
    return;
  }
  res.json(script);
});

// Parent uploads a curriculum document for one of their child's classes.
router.post("/parent/classes/:classId/curriculum", async (req, res) => {
  const parent = await requireParent(req, res);
  if (!parent) return;
  const [classRow] = await db
    .select()
    .from(classesTable)
    .where(and(eq(classesTable.id, req.params.classId), eq(classesTable.parentId, parent.id)))
    .limit(1);
  if (!classRow) return res.status(404).json({ error: "That class is not linked to your account." });
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
    req.log.error({ err: error }, "parent curriculum extraction failed");
    return res.status(502).json({ error: "That curriculum document could not be read right now. Please try again." });
  }
});

// Simplified single-child view: progress, gaps, learning style, activity.
router.get("/parent/dashboard", async (req, res) => {
  const parent = await requireParent(req, res);
  if (!parent) return;
  const learners = await parentLearnerRows(parent.id);
  const children = [];
  for (const learner of learners) {
    const memberships = await db
      .select({ classRow: classesTable, subject: classLearnersTable.subject })
      .from(classLearnersTable)
      .innerJoin(classesTable, eq(classesTable.id, classLearnersTable.classId))
      .where(eq(classLearnersTable.learnerId, learner.id));
    const classIds = memberships.map((entry) => entry.classRow.id);
    const scores = await db
      .select({ score: submissionsTable.score })
      .from(submissionsTable)
      .where(eq(submissionsTable.learnerId, learner.id));
    const averageScore = scores.length ? Math.round(scores.reduce((total, row) => total + row.score, 0) / scores.length) : null;
    let openCount = 0;
    let missedCount = 0;
    if (classIds.length) {
      const classAssignments = await db
        .select()
        .from(assignmentsTable)
        .where(inArray(assignmentsTable.classId, classIds));
      const submitted = await db
        .select({ assignmentId: submissionsTable.assignmentId })
        .from(submissionsTable)
        .where(and(eq(submissionsTable.learnerId, learner.id), inArray(submissionsTable.assignmentId, classAssignments.map((row) => row.id))));
      const submittedIds = new Set(submitted.map((row) => row.assignmentId));
      const now = new Date();
      for (const assignment of classAssignments) {
        if (submittedIds.has(assignment.id)) continue;
        if (assignment.openAt <= now && assignment.closeAt > now) openCount += 1;
        if (assignment.closeAt <= now) missedCount += 1;
      }
    }
    const [profile] = await db.select().from(learningProfilesTable).where(eq(learningProfilesTable.learnerId, learner.id)).limit(1);
    const activity = await db
      .select()
      .from(learningActivitiesTable)
      .where(eq(learningActivitiesTable.learnerId, learner.id))
      .orderBy(desc(learningActivitiesTable.timestamp))
      .limit(6);
    const recentSubmissions = await db
      .select({ submission: submissionsTable, assignment: assignmentsTable })
      .from(submissionsTable)
      .innerJoin(assignmentsTable, eq(assignmentsTable.id, submissionsTable.assignmentId))
      .where(eq(submissionsTable.learnerId, learner.id))
      .orderBy(desc(submissionsTable.submittedAt))
      .limit(30);
    await closeExpiredLearnerSessions(learner.id);
    const sessionRows = await db
      .select({
        id: learnerSessionActivityTable.id,
        loginAt: learnerSessionActivityTable.loginAt,
        logoutAt: learnerSessionActivityTable.logoutAt,
        durationMinutes: learnerSessionActivityTable.durationMinutes,
        authSessionId: learnerSessionActivityTable.authSessionId,
        expiresAt: authSessionsTable.expiresAt,
      })
      .from(learnerSessionActivityTable)
      .leftJoin(authSessionsTable, eq(authSessionsTable.id, learnerSessionActivityTable.authSessionId))
      .where(and(
        eq(learnerSessionActivityTable.learnerId, learner.id),
        gte(learnerSessionActivityTable.loginAt, new Date(Date.now() - 45 * 24 * 60 * 60 * 1000)),
      ))
      .orderBy(desc(learnerSessionActivityTable.loginAt));
    const sessionUsage = sessionRows.map((row) => {
      const endedAt = row.logoutAt ?? (row.expiresAt && row.expiresAt <= new Date() ? row.expiresAt : null);
      const durationMinutes = row.durationMinutes
        ?? Math.max(0, Math.floor(((endedAt ?? new Date()).getTime() - row.loginAt.getTime()) / 60_000));
      return {
        id: row.id,
        loginAt: row.loginAt.toISOString(),
        logoutAt: endedAt?.toISOString() ?? null,
        durationMinutes,
        active: !endedAt && row.authSessionId !== null,
      };
    });
    children.push({
      learner: publicFamilyLearner(learner),
      averageScore,
      submissionCount: scores.length,
      openAssignments: openCount,
      missedAssignments: missedCount,
      learningStyle: profile?.primaryStyle ?? "Discovering",
      confidence: profile?.confidence ?? 0,
      activeGaps: profile?.activeGaps ?? [],
      classes: memberships.map((entry) => serializeClass(entry.classRow)),
      recentActivity: activity.map((row) => ({
        id: row.id,
        label: row.label,
        subject: row.subject,
        score: row.score,
        detail: row.detail,
        timestamp: row.timestamp.toISOString(),
      })),
      assignmentHistory: recentSubmissions.map(({ submission, assignment }) => ({
        submissionId: submission.id,
        assignmentId: assignment.id,
        title: assignment.title,
        topic: assignment.topic,
        subject: assignment.subject,
        score: submission.score,
        markingStatus: submission.markingStatus,
        submittedAt: submission.submittedAt.toISOString(),
        canReview: submission.markingStatus === "MARKED"
          && (assignment.resultReleasePolicy !== "after_close" || new Date() >= assignment.closeAt),
      })),
      sessionUsage,
    });
  }
  return res.json({ parent: toPublicParent(parent), children, classes: await classesForOwner("parent", parent.id) });
});

export default router;
