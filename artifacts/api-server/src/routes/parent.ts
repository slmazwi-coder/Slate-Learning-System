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
import { serializeClass } from "../lib/class-views";
import { rateLimit } from "../lib/rate-limit";
import { PRIVACY_NOTICE_VERSION } from "../lib/privacy";
import { learnerActivitySummary } from "../lib/learner-activity";
import { buildMarkedScript, submissionForLearner } from "../lib/marked-script";
import { resultsReleased, submissionResultsVisible } from "../lib/result-release";
import { PRESET_SUBJECT_MAX_LENGTH } from "../lib/presets";
import { AGE_MAX, AGE_MIN, GenderInput, ProfileImageInput } from "../lib/profile-fields";
import { generateSlateId } from "../lib/slate-id";
import {
  classesForOwner,
  createFamilyLearner,
  deleteLearnerAccount,
  enrollLinkedLearnerInOwnerClasses,
  exportLearnerData,
  linkParentToLearner,
  publicFamilyLearner,
  resetFamilyLearnerPassword,
  updateFamilyLearner,
} from "../lib/family-learners";
import { recordAudit } from "../lib/audit";

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
  // POPIA: the parent must actively tick the consent checkbox. A literal true
  // means the request is rejected unless consent was given.
  consent: z.literal(true, { message: "You must consent to Slate storing and processing your child's data." }),
});

const UpdateChildBody = z.object({
  grade: z.number().int().min(0).max(13).optional(),
  subjects: z.array(z.string().trim().min(2).max(PRESET_SUBJECT_MAX_LENGTH)).min(1).max(10).optional(),
  assignmentWindowDays: z.number().int().min(1).max(30).optional(),
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

router.post("/parent/auth/register", rateLimit({ scope: "parent-register", usernameField: "email" }), async (req, res) => {
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

router.post("/parent/auth/login", rateLimit({ scope: "parent-login", usernameField: "email" }), async (req, res) => {
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
  if (!parsed.success) {
    const consentIssue = parsed.error.issues.some((issue) => issue.path.includes("consent"));
    return res.status(400).json({
      error: consentIssue
        ? "Please read the privacy notice and tick the consent box before creating your child's account."
        : "Give your child's name, grade, age, gender and at least one subject.",
    });
  }
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
      consentVersion: PRIVACY_NOTICE_VERSION,
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

// POPIA: export everything Slate holds for a child, as JSON.
router.get("/parent/learners/:learnerId/export", async (req, res) => {
  const parent = await requireParent(req, res);
  if (!parent) return;
  const learner = await requireParentLearner(parent.id, String(req.params.learnerId));
  if (!learner) return res.status(404).json({ error: "That learner profile is not linked to your account." });
  const data = await exportLearnerData(learner);
  await recordAudit({
    actorUserId: parent.userId ?? "",
    actorRole: "PARENT",
    action: "child_export",
    memberId: learner.id,
    memberType: "learner",
    detail: `Exported data for learner ${learner.slateId ?? learner.id}.`,
  });
  res.setHeader("Content-Disposition", `attachment; filename="slate-child-${learner.slateId ?? learner.id}.json"`);
  return res.json(data);
});

// POPIA: delete a child account and all linked data.
router.delete("/parent/learners/:learnerId", async (req, res) => {
  const parent = await requireParent(req, res);
  if (!parent) return;
  const learner = await requireParentLearner(parent.id, String(req.params.learnerId));
  if (!learner) return res.status(404).json({ error: "That learner profile is not linked to your account." });
  const result = await deleteLearnerAccount(learner);
  await recordAudit({
    actorUserId: parent.userId ?? "",
    actorRole: "PARENT",
    action: "child_delete",
    memberId: learner.id,
    memberType: "learner",
    detail: `Deleted learner account ${learner.slateId ?? learner.id} and all linked data.`,
  });
  return res.json({ ...result, learners: await parentLearners(parent.id) });
});

// Reset a child's password. The new password is returned once so the parent can
// share it with the child; the username never changes.
router.post("/parent/learners/:learnerId/reset-password", rateLimit({ scope: "parent-child-reset", usernameField: "learnerId" }), async (req, res) => {
  const parent = await requireParent(req, res);
  if (!parent) return;
  const learner = await requireParentLearner(parent.id, String(req.params.learnerId));
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
  // A held assignment's marks and feedback stay hidden from parents too, and so
  // does a paper focus mode submitted until the teacher releases it.
  const [assignmentRow] = await db.select().from(assignmentsTable).where(eq(assignmentsTable.id, submission.assignmentId)).limit(1);
  if (!assignmentRow || !submissionResultsVisible(assignmentRow, submission)) {
    return res.status(403).json({ error: "The teacher has not released these results yet." });
  }
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

// Curriculum is locked: a class always teaches the hardwired CAPS preset for
// its subject and grade. Parents cannot replace it, so the upload endpoint was
// removed. A parent who wants extra practice material uses study material.

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
    // Only released, fully-marked work counts towards a parent-visible average;
    // a held assignment must not leak a mark through this roll-up.
    const scoreRows = await db
      .select({
        score: submissionsTable.score,
        markingStatus: submissionsTable.markingStatus,
        closeAt: assignmentsTable.closeAt,
        resultReleasePolicy: assignmentsTable.resultReleasePolicy,
        resultsReleasedAt: assignmentsTable.resultsReleasedAt,
        resultsHeldAt: assignmentsTable.resultsHeldAt,
        resultsHeldForReview: submissionsTable.resultsHeldForReview,
      })
      .from(submissionsTable)
      .innerJoin(assignmentsTable, eq(assignmentsTable.id, submissionsTable.assignmentId))
      .where(eq(submissionsTable.learnerId, learner.id));
    const releasedScores = scoreRows.filter((row) => row.markingStatus === "MARKED" && !row.resultsHeldForReview && resultsReleased(row));
    const scores = releasedScores;
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
        closeAt: assignmentsTable.closeAt,
        resultReleasePolicy: assignmentsTable.resultReleasePolicy,
        resultsReleasedAt: assignmentsTable.resultsReleasedAt,
        resultsHeldAt: assignmentsTable.resultsHeldAt,
        // Focus-mode outcome, so the parent is told the paper was submitted by
        // focus mode (and can ask the teacher to reopen it) rather than by the
        // learner.
        autoSubmitted: submissionsTable.autoSubmitted,
        autoSubmitReason: submissionsTable.autoSubmitReason,
        reopenedAt: submissionsTable.reopenedAt,
        resultsHeldForReview: submissionsTable.resultsHeldForReview,
      })
      .from(submissionsTable)
      .innerJoin(assignmentsTable, eq(assignmentsTable.id, submissionsTable.assignmentId))
      .where(eq(submissionsTable.learnerId, learner.id))
      .orderBy(desc(submissionsTable.submittedAt));
    children.push({
      learner: publicFamilyLearner(learner),
      averageScore,
      submissionCount: scoreRows.length,
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
      assignmentHistory: history.map((row) => {
        const released = resultsReleased(row) && row.markingStatus === "MARKED" && !row.resultsHeldForReview;
        return {
          submissionId: row.submissionId,
          assignmentId: row.assignmentId,
          title: row.title,
          subject: row.subject,
          topic: row.topic,
          score: released ? row.score : null,
          verdict: released ? row.verdict : null,
          markingStatus: row.markingStatus,
          released,
          submittedAt: row.submittedAt.toISOString(),
          // Focus mode ended this paper for the learner; the parent can see that
          // and ask the teacher to reopen it.
          autoSubmitted: row.autoSubmitted,
          autoSubmitReason: row.autoSubmitReason,
          focusNotice: row.autoSubmitted
            ? row.autoSubmitReason === "FOCUS_EXIT_LIMIT"
              ? "Slate submitted this paper because the learner left the page three times during homework. Ask the teacher to reopen it if needed."
              : "Slate submitted this paper because the learner did not return within the time allowed after leaving the page. Ask the teacher to reopen it if needed."
            : null,
        };
      }),
      activity: await learnerActivitySummary(learner.id),
    });
  }
  return res.json({ parent: toPublicParent(parent), children, classes: await classesForOwner("parent", parent.id) });
});

export default router;
