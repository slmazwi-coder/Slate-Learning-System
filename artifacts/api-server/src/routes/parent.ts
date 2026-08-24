import { Router, type IRouter } from "express";
import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import {
  assignmentsTable,
  classLearnersTable,
  classesTable,
  db,
  learningActivitiesTable,
  learningProfilesTable,
  learnersTable,
  parentsTable,
  submissionsTable,
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
import { extractLessonSequence } from "../lib/ai";
import { serializeClass } from "../lib/class-views";
import {
  classesForOwner,
  createFamilyLearner,
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
  grade: z.number().int().min(1).max(13),
  subjects: z.array(z.string().trim().min(2).max(60)).min(1).max(10),
  assignmentWindowDays: z.number().int().min(1).max(30).optional(),
});

const UpdateChildBody = z.object({
  grade: z.number().int().min(1).max(13).optional(),
  subjects: z.array(z.string().trim().min(2).max(60)).min(1).max(10).optional(),
  assignmentWindowDays: z.number().int().min(1).max(30).optional(),
});

const CurriculumUploadBody = z.object({
  fileName: z.string().trim().max(200).optional(),
  text: z.string().max(200000).optional(),
  pdfBase64: z.string().max(8_000_000).optional(),
});

async function parentLearners(parentId: string) {
  const rows = await db.select().from(learnersTable).where(eq(learnersTable.parentId, parentId));
  return rows.map(publicFamilyLearner);
}

async function requireParentLearner(parentId: string, learnerId: string) {
  const [row] = await db
    .select()
    .from(learnersTable)
    .where(and(eq(learnersTable.id, learnerId), eq(learnersTable.parentId, parentId)))
    .limit(1);
  return row ?? null;
}

router.post("/parent/auth/register", async (req, res) => {
  const parsed = RegisterParentBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Please complete every field. Passwords need at least 8 characters." });
  try {
    const result = await createOrMergeUser({ email: parsed.data.email, password: parsed.data.password, fullName: parsed.data.fullName, role: "PARENT" });
    if ("error" in result) return res.status(401).json({ error: result.error });
    const existingProfile = await parentProfileForUser(result.user.id);
    if (existingProfile) return res.status(409).json({ error: "That email address already has a parent account." });
    const [parent] = await db.insert(parentsTable).values({
      userId: result.user.id,
      email: result.user.email,
      passwordHash: result.user.passwordHash,
      fullName: result.user.fullName,
    }).returning();
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
  const user = await verifyUserLogin(parsed.data.email, parsed.data.password);
  if (!user || !user.roles.includes("PARENT")) {
    return res.status(401).json({ error: "That email or password is not correct." });
  }
  const parent = await parentProfileForUser(user.id);
  if (!parent) return res.status(401).json({ error: "That email or password is not correct." });
  await createParentSession(parent.id, res);
  return res.json({ parent: toPublicParent(parent), learners: await parentLearners(parent.id) });
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
      assignmentWindowDays: parsed.data.assignmentWindowDays,
    });
    return res.status(201).json(result);
  } catch (error) {
    req.log.error({ err: error }, "parent learner creation failed");
    return res.status(400).json({ error: "We could not create that learner profile." });
  }
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
  const learners = await db.select().from(learnersTable).where(eq(learnersTable.parentId, parent.id));
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
    });
  }
  return res.json({ parent: toPublicParent(parent), children, classes: await classesForOwner("parent", parent.id) });
});

export default router;
