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
  parentLearnersTable,
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
import { learnerActivitySummary } from "../lib/learner-activity";
import { buildMarkedScript, submissionForLearner } from "../lib/marked-script";
import { PRESET_SUBJECT_MAX_LENGTH } from "../lib/presets";
import { AGE_MAX, AGE_MIN, GenderInput, ProfileImageInput } from "../lib/profile-fields";
import { generateSlateId } from "../lib/slate-id";
import {
  classesForOwner,
  createFamilyLearner,
  enrollLinkedLearnerInOwnerClasses,
  linkParentToLearner,
  publicFamilyLearner,
  resetFamilyLearnerPassword,
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
  assignmentWindowDays: z.number().int().min(1).max(30).optional(),
  // The parent chooses the login username and may either set a password or let
  // Slate generate one to show once. Email is optional but recommended.
  username: z.string().trim().min(3).max(32).optional(),
  password: z.string().min(8).max(128).optional(),
  email: z.string().trim().email().optional(),
  // Every learner account declares age and gender, including parent-created ones.
  age: z.number().int().min(AGE_MIN).max(AGE_MAX),
  gender: GenderInput,
  profileImage: ProfileImageInput.nullable().optional(),
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

// All children linked to a parent through the relationship table, falling back
// to the legacy parentId column for rows created before the link table existed.
async function parentLearnerRows(parentId: string) {
  const linked = await db
    .select({ learner: learnersTable })
    .from(parentLearnersTable)
    .innerJoin(learnersTable, eq(learnersTable.id, parentLearnersTable.learnerId))
    .where(eq(parentLearnersTable.parentId, parentId));
  const byId = new Map(linked.map((row) => [row.learner.id, row.learner]));
  const legacy = await db.select().from(learnersTable).where(eq(learnersTable.parentId, parentId));
  for (const learner of legacy) if (!byId.has(learner.id)) byId.set(learner.id, learner);
  return [...byId.values()].sort((a, b) => a.fullName.localeCompare(b.fullName));
}

async function parentLearners(parentId: string) {
  return (await parentLearnerRows(parentId)).map(publicFamilyLearner);
}

async function requireParentLearner(parentId: string, learnerId: string) {
  const [linked] = await db
    .select({ learner: learnersTable })
    .from(parentLearnersTable)
    .innerJoin(learnersTable, eq(learnersTable.id, parentLearnersTable.learnerId))
    .where(and(eq(parentLearnersTable.parentId, parentId), eq(parentLearnersTable.learnerId, learnerId)))
    .limit(1);
  if (linked) return linked.learner;
  const [legacy] = await db
    .select()
    .from(learnersTable)
    .where(and(eq(learnersTable.id, learnerId), eq(learnersTable.parentId, parentId)))
    .limit(1);
  return legacy ?? null;
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
      slateId: await generateSlateId("parent"),
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
  if (!parsed.success) return res.status(400).json({ error: "Give your child's name, grade, age, gender and at least one subject." });
  try {
    const result = await createFamilyLearner({
      kind: "parent",
      ownerId: parent.id,
      fullName: parsed.data.fullName,
      grade: parsed.data.grade,
      subjects: parsed.data.subjects,
      assignmentWindowDays: parsed.data.assignmentWindowDays,
      username: parsed.data.username,
      password: parsed.data.password,
      email: parsed.data.email,
      age: parsed.data.age,
      gender: parsed.data.gender,
      profileImage: parsed.data.profileImage,
    });
    return res.status(201).json(result);
  } catch (error) {
    req.log.error({ err: error }, "parent learner creation failed");
    const message = error instanceof Error && error.message.includes("username") ? error.message : "We could not create that learner profile.";
    return res.status(400).json({ error: message });
  }
});

// Link an EXISTING learner account (found by SLATE ID or name) to this parent,
// separate from creating a new child profile. Idempotent.
const LinkLearnerBody = z.object({ learnerId: z.string().uuid() });

router.post("/parent/learners/link", async (req, res) => {
  const parent = await requireParent(req, res);
  if (!parent) return;
  const parsed = LinkLearnerBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Choose a learner to link." });
  const [learner] = await db.select().from(learnersTable).where(eq(learnersTable.id, parsed.data.learnerId)).limit(1);
  if (!learner) return res.status(404).json({ error: "That learner account was not found." });
  const existing = await requireParentLearner(parent.id, learner.id);
  if (existing) return res.status(409).json({ error: `${learner.fullName} is already linked to your account.` });
  await linkParentToLearner(parent.id, learner.id);
  await enrollLinkedLearnerInOwnerClasses("parent", parent.id, learner);
  return res.status(201).json({ learner: publicFamilyLearner(learner), learners: await parentLearners(parent.id) });
});

// Unlink a learner from this parent's dashboard. The learner's account and all
// their work are left untouched.
router.delete("/parent/learners/:learnerId/link", async (req, res) => {
  const parent = await requireParent(req, res);
  if (!parent) return;
  const learner = await requireParentLearner(parent.id, req.params.learnerId);
  if (!learner) return res.status(404).json({ error: "That learner profile is not linked to your account." });
  await db
    .delete(parentLearnersTable)
    .where(and(eq(parentLearnersTable.parentId, parent.id), eq(parentLearnersTable.learnerId, learner.id)));
  // Clear the legacy column too, so the fallback query does not re-surface them.
  await db
    .update(learnersTable)
    .set({ parentId: null })
    .where(and(eq(learnersTable.id, learner.id), eq(learnersTable.parentId, parent.id)));
  return res.json({ unlinked: true, learners: await parentLearners(parent.id) });
});

// Reset a child's password. The new password is returned once so the parent can
// share it with the child; the username never changes.
router.post("/parent/learners/:learnerId/reset-password", async (req, res) => {
  const parent = await requireParent(req, res);
  if (!parent) return;
  const learner = await requireParentLearner(parent.id, req.params.learnerId);
  if (!learner) return res.status(404).json({ error: "That learner profile is not linked to your account." });
  const credentials = await resetFamilyLearnerPassword(learner);
  return res.json({ learner: publicFamilyLearner(learner), credentials });
});

// Marked-script review for one of the parent's children, read-only.
router.get("/parent/learners/:learnerId/assignments/:assignmentId/script", async (req, res) => {
  const parent = await requireParent(req, res);
  if (!parent) return;
  const learner = await requireParentLearner(parent.id, req.params.learnerId);
  if (!learner) return res.status(404).json({ error: "That learner profile is not linked to your account." });
  const submission = await submissionForLearner(req.params.assignmentId, learner.id);
  if (!submission) return res.status(404).json({ error: "That assignment has not been submitted yet." });
  const script = await buildMarkedScript(submission, { editable: false });
  if (!script) return res.status(404).json({ error: "That marked script could not be found." });
  return res.json(script);
});

// Per-child usage activity for the parent's monitoring card.
router.get("/parent/learners/:learnerId/activity", async (req, res) => {
  const parent = await requireParent(req, res);
  if (!parent) return;
  const learner = await requireParentLearner(parent.id, req.params.learnerId);
  if (!learner) return res.status(404).json({ error: "That learner profile is not linked to your account." });
  return res.json(await learnerActivitySummary(learner.id));
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
    // Completed work, newest first, so the parent can open any marked script.
    const history = await db
      .select({
        submissionId: submissionsTable.id,
        assignmentId: submissionsTable.assignmentId,
        title: assignmentsTable.title,
        subject: assignmentsTable.subject,
        topic: assignmentsTable.topic,
        score: submissionsTable.score,
        verdict: submissionsTable.overallVerdict,
        markingStatus: submissionsTable.markingStatus,
        submittedAt: submissionsTable.submittedAt,
      })
      .from(submissionsTable)
      .innerJoin(assignmentsTable, eq(assignmentsTable.id, submissionsTable.assignmentId))
      .where(eq(submissionsTable.learnerId, learner.id))
      .orderBy(desc(submissionsTable.submittedAt));
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
      assignmentHistory: history.map((row) => ({
        submissionId: row.submissionId,
        assignmentId: row.assignmentId,
        title: row.title,
        subject: row.subject,
        topic: row.topic,
        score: row.score,
        verdict: row.verdict,
        markingStatus: row.markingStatus,
        submittedAt: row.submittedAt.toISOString(),
      })),
      activity: await learnerActivitySummary(learner.id),
    });
  }
  return res.json({ parent: toPublicParent(parent), children, classes: await classesForOwner("parent", parent.id) });
});

export default router;
