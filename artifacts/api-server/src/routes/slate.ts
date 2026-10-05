import { Router, type IRouter } from "express";
import { and, asc, desc, eq, gte, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { z } from "zod";
import {
  GetAssignmentParams,
  LoginLearnerBody,
  OpenAssignmentParams,
  RegisterLearnerBody,
  RespondToRemediationParams,
  RespondToRemediationBody,
  SubmitAssignmentBody,
  SubmitAssignmentParams,
  UpdateLearnerProfileBody,
} from "@workspace/api-zod";
import {
  assignmentsTable,
  assignmentSessionsTable,
  classLearnersTable,
  classMaterialsTable,
  classesTable,
  db,
  learningActivitiesTable,
  learningProfilesTable,
  learnersTable,
  parentLearnersTable,
  parentsTable,
  presetCurriculaTable,
  remediationActivitiesTable,
  submissionsTable,
  teachersTable,
  tutorsTable,
  usersTable,
  type Learner,
} from "@workspace/db";
import {
  createSession,
  destroySession,
  getCurrentLearner,
  hashPassword,
  requireLearner,
  toPublicLearner,
  verifyPassword,
} from "../lib/auth";
import {
  generateFollowUp,
  generateProblemSet,
  generateRecommendedActivities,
  markAssignment,
  markRemediation,
  type GeneratedQuestion,
  type MarkingResult,
} from "../lib/ai";
import { ensureIndependentAssignmentsForLearner } from "../lib/independent";
import { buildMarkedScript } from "../lib/marked-script";
import { learnerClassroomDetail, learnerClassrooms, learnerHomeAnalysis } from "../lib/learner-classrooms";
import { gradeName, presetForSubject } from "../lib/presets";
import { createOrMergeUser, createUserSession, destroyUserSession, findUserById } from "../lib/unified-auth";

const router: IRouter = Router();
const formats = ["QUIZ", "GAME", "PUZZLE", "CASE_STUDY", "ASSESSMENT"] as const;
const signalLabels: Record<string, string> = {
  QUIZ: "Quiz-responsive",
  GAME: "Game-responsive",
  PUZZLE: "Logic-pattern learner",
  CASE_STUDY: "Contextual learner",
  ASSESSMENT: "Assessment-ready",
};

function isWholeNumber(value: number) {
  return Number.isInteger(value);
}

function assignmentStatus(assignment: typeof assignmentsTable.$inferSelect, submissionExists: boolean) {
  const now = new Date();
  if (submissionExists) return "SUBMITTED" as const;
  if (now < assignment.openAt) return "LOCKED" as const;
  if (now >= assignment.closeAt) return "MISSED" as const;
  return "OPEN" as const;
}

async function getSubmissionMap(learnerId: string, assignmentIds: string[]) {
  if (!assignmentIds.length) return new Set<string>();
  const rows = await db
    .select({ assignmentId: submissionsTable.assignmentId })
    .from(submissionsTable)
    .where(and(eq(submissionsTable.learnerId, learnerId), inArray(submissionsTable.assignmentId, assignmentIds)));
  return new Set(rows.map((row) => row.assignmentId));
}

async function learnerClasses(learnerId: string) {
  return db
    .select({
      id: classesTable.id,
      grade: classesTable.grade,
      section: classesTable.section,
      subject: classesTable.subject,
      schoolName: classesTable.schoolName,
    })
    .from(classLearnersTable)
    .innerJoin(classesTable, eq(classesTable.id, classLearnersTable.classId))
    .where(eq(classLearnersTable.learnerId, learnerId));
}

// Learners see school-wide seed assignments plus assignments set for their own
// classes, minus anything that already closed before they could reach it: work
// that closed before a learner registered, or before they joined that class, is
// not theirs to miss.
async function visibleAssignments(learner: Pick<Learner, "id" | "createdAt">) {
  const memberships = await db
    .select({ classId: classLearnersTable.classId, joinedAt: classLearnersTable.joinedAt })
    .from(classLearnersTable)
    .where(eq(classLearnersTable.learnerId, learner.id));
  const joinedAt = new Map(memberships.map((entry) => [entry.classId, entry.joinedAt]));
  const classIds = memberships.map((entry) => entry.classId);
  const scope = classIds.length
    ? or(isNull(assignmentsTable.classId), inArray(assignmentsTable.classId, classIds))
    : isNull(assignmentsTable.classId);
  const rows = await db.select().from(assignmentsTable).where(scope).orderBy(asc(assignmentsTable.openAt));
  return rows.filter((assignment) => {
    if (!assignment.isPublished) return false;
    const availableFrom = assignment.classId ? joinedAt.get(assignment.classId) : learner.createdAt;
    return !availableFrom || assignment.closeAt >= availableFrom;
  });
}

async function ensureSeedAssignments() {
  const existing = await db.select({ id: assignmentsTable.id }).from(assignmentsTable).limit(1);
  if (existing.length) return;
  const now = Date.now();
  await db.insert(assignmentsTable).values([
    {
      title: "Fractions in the real world",
      subject: "Mathematics",
      topic: "Equivalent fractions",
      curriculumContext: "Grade 8 South African mathematics: fractions, ratios, and practical problem solving.",
      openAt: new Date(now - 60 * 60 * 1000),
      closeAt: new Date(now + 3 * 60 * 60 * 1000),
      questionCount: 4,
    },
    {
      title: "The water cycle, close to home",
      subject: "Natural Sciences",
      topic: "Water and change of state",
      curriculumContext: "Grade 8 South African natural sciences: particle model and changes of state, with local water context.",
      openAt: new Date(now + 24 * 60 * 60 * 1000),
      closeAt: new Date(now + 27 * 60 * 60 * 1000),
      questionCount: 4,
    },
    {
      title: "Patterns and algebra",
      subject: "Mathematics",
      topic: "Number patterns",
      curriculumContext: "Grade 8 South African mathematics: identify and explain arithmetic patterns.",
      openAt: new Date(now - 48 * 60 * 60 * 1000),
      closeAt: new Date(now - 45 * 60 * 60 * 1000),
      questionCount: 3,
    },
  ]);
}

function toPublicQuestions(questions: unknown) {
  return (questions as GeneratedQuestion[]).map(({ answer: _answer, ...question }) => question);
}

function serializeAssignment(assignment: typeof assignmentsTable.$inferSelect, status: string, progress = 0) {
  return {
    id: assignment.id,
    title: assignment.title,
    subject: assignment.subject,
    topic: assignment.topic,
    openAt: assignment.openAt.toISOString(),
    closeAt: assignment.closeAt.toISOString(),
    status,
    questionCount: assignment.questionCount,
    progress,
    resultReleasePolicy: assignment.resultReleasePolicy,
  };
}

async function getAssignmentForLearner(id: string, learnerId: string) {
  const [assignment] = await db.select().from(assignmentsTable).where(eq(assignmentsTable.id, id)).limit(1);
  if (!assignment || !assignment.isPublished) return null;
  let classRow: typeof classesTable.$inferSelect | null = null;
  if (assignment.classId) {
    const [membership] = await db
      .select({ id: classLearnersTable.id })
      .from(classLearnersTable)
      .where(and(eq(classLearnersTable.learnerId, learnerId), eq(classLearnersTable.classId, assignment.classId)))
      .limit(1);
    if (!membership) return null;
    const [row] = await db.select().from(classesTable).where(eq(classesTable.id, assignment.classId)).limit(1);
    classRow = row ?? null;
  }
  const [submission] = await db
    .select({ id: submissionsTable.id, score: submissionsTable.score })
    .from(submissionsTable)
    .where(and(eq(submissionsTable.assignmentId, id), eq(submissionsTable.learnerId, learnerId)))
    .limit(1);
  return {
    assignment,
    classRow,
    status: assignmentStatus(assignment, Boolean(submission)),
    progress: submission ? 100 : 0,
  };
}

// Resolves the per-module assessment guideline for a class's preset subject,
// when one has been uploaded (e.g. a Stadio module guideline).
async function assessmentGuideForClass(classRow: typeof classesTable.$inferSelect | null): Promise<string | undefined> {
  if (!classRow?.presetSubject) return undefined;
  const [row] = await db
    .select({ assessmentGuide: presetCurriculaTable.assessmentGuide })
    .from(presetCurriculaTable)
    .where(
      and(
        eq(presetCurriculaTable.subject, classRow.presetSubject),
        lte(presetCurriculaTable.gradeMin, classRow.grade),
        gte(presetCurriculaTable.gradeMax, classRow.grade),
      ),
    )
    .limit(1);
  return row?.assessmentGuide?.trim() || undefined;
}

async function getOrCreateProfile(learnerId: string) {
  const [profile] = await db.select().from(learningProfilesTable).where(eq(learningProfilesTable.learnerId, learnerId)).limit(1);
  if (profile) return profile;
  const [created] = await db.insert(learningProfilesTable).values({ learnerId }).returning();
  return created;
}

async function updateLearningSignal(learnerId: string, format: string, score: number, gap?: string | null) {
  const profile = await getOrCreateProfile(learnerId);
  const signals = Array.isArray(profile.signals) ? profile.signals as Array<{ format: string; label: string; score: number; sessions: number }> : [];
  const existing = signals.find((signal) => signal.format === format);
  if (existing) {
    existing.score = Math.round((existing.score * existing.sessions + score) / (existing.sessions + 1));
    existing.sessions += 1;
  } else {
    signals.push({ format, label: signalLabels[format] ?? format, score: Math.round(score), sessions: 1 });
  }
  const sorted = [...signals].sort((a, b) => b.score - a.score);
  const primaryStyle = sorted[0]?.label ?? "Discovering";
  const confidence = Math.min(100, sorted[0] ? Math.round((sorted[0].sessions / 5) * 100) : 0);
  const activeGaps = Array.isArray(profile.activeGaps) ? [...profile.activeGaps] : [];
  if (gap && !activeGaps.includes(gap)) activeGaps.unshift(gap);
  await db.update(learningProfilesTable).set({ signals, primaryStyle, confidence, activeGaps: activeGaps.slice(0, 5) }).where(eq(learningProfilesTable.learnerId, learnerId));
}

// Email is required for contact and account recovery, but it is NOT the unique
// identifier: siblings may share a parent's address, and a parent may use their
// own address for every child. Username is the unique login identifier.
const LearnerEmail = z.object({ email: z.string().trim().email() });

router.post("/auth/register", async (req, res) => {
  try {
    const data = RegisterLearnerBody.parse(req.body);
    const email = LearnerEmail.safeParse(req.body).data?.email;
    if (!email) return res.status(400).json({ error: "Enter an email address — you can use a parent's email if the learner doesn't have their own." });
    if (!isWholeNumber(data.grade)) return res.status(400).json({ error: "Grade must be a whole number." });
    const username = data.username.trim().toLowerCase();
    const [existing] = await db.select({ id: learnersTable.id }).from(learnersTable).where(eq(learnersTable.username, username)).limit(1);
    if (existing) return res.status(409).json({ error: "That username is already in use." });
    // A shared email is allowed to belong to several learners; only the
    // username must be unique. We link to the unified identity when it is safe
    // (fresh email, or the same email+password with no learner yet). When the
    // email already belongs to someone else — a parent or a sibling with a
    // different password — the learner still gets a username-based account and
    // registration succeeds, it simply is not merged onto that identity.
    let userId: string | null = null;
    const link = await createOrMergeUser({ email, password: data.password, fullName: data.fullName, role: "LEARNER" });
    if (!("error" in link)) {
      const [linked] = await db.select({ id: learnersTable.id }).from(learnersTable).where(eq(learnersTable.userId, link.user.id)).limit(1);
      if (!linked) userId = link.user.id;
    }
    const [learner] = await db.insert(learnersTable).values({
      username,
      userId,
      email,
      passwordHash: await hashPassword(data.password),
      fullName: data.fullName.trim(),
      grade: data.grade,
      schoolName: data.schoolName.trim(),
      subjects: data.subjects,
    }).returning();
    await getOrCreateProfile(learner.id);
    await createSession(learner.id, res);
    if (userId) await createUserSession(userId, "LEARNER", res);
    return res.status(201).json({ learner: toPublicLearner(learner) });
  } catch (error) {
    req.log.error({ err: error }, "learner registration failed");
    return res.status(400).json({ error: "We could not create that learner profile." });
  }
});

router.post("/auth/login", async (req, res) => {
  try {
    const data = LoginLearnerBody.parse(req.body);
    const [learner] = await db.select().from(learnersTable).where(eq(learnersTable.username, data.username.trim().toLowerCase())).limit(1);
    if (!learner || !(await verifyPassword(data.password, learner.passwordHash))) {
      return res.status(401).json({ error: "That username or password is not correct." });
    }
    await createSession(learner.id, res);
    if (learner.userId) await createUserSession(learner.userId, "LEARNER", res);
    return res.json({ learner: toPublicLearner(learner) });
  } catch (error) {
    req.log.error({ err: error }, "learner login failed");
    return res.status(400).json({ error: "Please check your details and try again." });
  }
});

router.post("/auth/logout", async (req, res) => {
  await destroySession(req, res);
  // Learners signed in via a unified account also hold a slate_user_session;
  // without clearing it the unified fallback keeps them signed in forever.
  await destroyUserSession(req, res);
  return res.status(204).send();
});

// Shared-email recovery, step 1: many accounts may share one address (siblings
// on a parent's email, or a parent's own address reused for every child), so the
// requester chooses which account to reset. Each entry names the account and
// says whether it is a learner, parent, teacher or tutor, so an automated email
// can state exactly which one it refers to.
const RecoverLookupBody = z.object({ email: z.string().trim().email() });

type RecoverKind = "learner" | "parent" | "teacher" | "tutor";
type RecoverAccount = {
  kind: RecoverKind;
  id: string;
  username: string;
  fullName: string;
  email: string;
};

// A learner's email is the one on their own row; parent-created children may
// have no email of their own, in which case the parent's address is what the
// family knows them by. We surface both so a child is never invisible just
// because the optional email field was left blank.
async function learnerRecoverAccounts(email: string): Promise<RecoverAccount[]> {
  const byId = new Map<string, RecoverAccount>();
  const direct = await db
    .select({ id: learnersTable.id, username: learnersTable.username, fullName: learnersTable.fullName, email: learnersTable.email })
    .from(learnersTable)
    .where(eq(learnersTable.email, email));
  for (const row of direct) {
    byId.set(row.id, { kind: "learner", id: row.id, username: row.username, fullName: row.fullName, email: email });
  }
  const viaParent = await db
    .select({ id: learnersTable.id, username: learnersTable.username, fullName: learnersTable.fullName, email: learnersTable.email })
    .from(parentLearnersTable)
    .innerJoin(learnersTable, eq(learnersTable.id, parentLearnersTable.learnerId))
    .innerJoin(parentsTable, eq(parentsTable.id, parentLearnersTable.parentId))
    .where(eq(parentsTable.email, email));
  for (const row of viaParent) {
    if (byId.has(row.id)) continue;
    byId.set(row.id, { kind: "learner", id: row.id, username: row.username, fullName: row.fullName, email: row.email ?? email });
  }
  // Learners who registered before email was stored on the learner row: their
  // address lives on the linked unified identity, so match through user_id too.
  const viaIdentity = await db
    .select({ id: learnersTable.id, username: learnersTable.username, fullName: learnersTable.fullName, email: learnersTable.email })
    .from(learnersTable)
    .innerJoin(usersTable, eq(usersTable.id, learnersTable.userId))
    .where(eq(usersTable.email, email));
  for (const row of viaIdentity) {
    if (byId.has(row.id)) continue;
    byId.set(row.id, { kind: "learner", id: row.id, username: row.username, fullName: row.fullName, email: row.email ?? email });
  }
  // Insurance for children created before the link table existed: the legacy
  // parent_id column still points at the parent holding this address.
  const viaLegacy = await db
    .select({ id: learnersTable.id, username: learnersTable.username, fullName: learnersTable.fullName, email: learnersTable.email })
    .from(learnersTable)
    .innerJoin(parentsTable, eq(parentsTable.id, learnersTable.parentId))
    .where(eq(parentsTable.email, email));
  for (const row of viaLegacy) {
    if (byId.has(row.id)) continue;
    byId.set(row.id, { kind: "learner", id: row.id, username: row.username, fullName: row.fullName, email: row.email ?? email });
  }
  return [...byId.values()];
}

// Adults sign in with their email plus a unified identity password. If their
// address is shared with their children, this lets them reset their own login.
async function adultRecoverAccounts(email: string): Promise<RecoverAccount[]> {
  const accounts: RecoverAccount[] = [];
  const [parent] = await db.select({ id: parentsTable.id, fullName: parentsTable.fullName }).from(parentsTable).where(eq(parentsTable.email, email)).limit(1);
  if (parent) accounts.push({ kind: "parent", id: parent.id, username: email, fullName: parent.fullName, email });
  const [teacher] = await db.select({ id: teachersTable.id, fullName: teachersTable.fullName }).from(teachersTable).where(eq(teachersTable.email, email)).limit(1);
  if (teacher) accounts.push({ kind: "teacher", id: teacher.id, username: email, fullName: teacher.fullName, email });
  const [tutor] = await db.select({ id: tutorsTable.id, fullName: tutorsTable.fullName }).from(tutorsTable).where(eq(tutorsTable.email, email)).limit(1);
  if (tutor) accounts.push({ kind: "tutor", id: tutor.id, username: email, fullName: tutor.fullName, email });
  return accounts;
}

router.post("/auth/recover/lookup", async (req, res) => {
  const parsed = RecoverLookupBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Enter the email address on the account." });
  const email = parsed.data.email.toLowerCase();
  const accounts = [...(await learnerRecoverAccounts(email)), ...(await adultRecoverAccounts(email))];
  const seen = new Set<string>();
  return res.json({
    email,
    accounts: accounts.filter((account) => {
      const key = `${account.kind}:${account.id}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }),
  });
});

const RecoverResetBody = z.object({
  email: z.string().trim().email(),
  kind: z.enum(["learner", "parent", "teacher", "tutor"]).default("learner"),
  // The username disambiguates siblings sharing the address. Adults are
  // identified by the email itself, so their username is the address.
  username: z.string().trim().min(3).max(160),
  password: z.string().min(8).max(128),
});

// Recovery, step 2: set a new password on the chosen account and keep any
// linked unified identity in step, so the same password works wherever that
// person signs in.
router.post("/auth/recover/reset", async (req, res) => {
  const parsed = RecoverResetBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Enter the account's username and a new password of at least 8 characters." });
  const email = parsed.data.email.toLowerCase();
  const username = parsed.data.username.trim().toLowerCase();
  const passwordHash = await hashPassword(parsed.data.password);

  if (parsed.data.kind === "learner") {
    const [learner] = await db
      .select()
      .from(learnersTable)
      .where(and(eq(learnersTable.email, email), eq(learnersTable.username, username)))
      .limit(1);
    // A parent-linked child may have no email of their own; match on username
    // alone when that child is reachable through a parent holding the address.
    // The same applies to a learner whose address lives only on their unified
    // identity (registered before email moved onto the learner row).
    const target = learner
      ?? (await db
        .select({ learner: learnersTable })
        .from(parentLearnersTable)
        .innerJoin(learnersTable, eq(learnersTable.id, parentLearnersTable.learnerId))
        .innerJoin(parentsTable, eq(parentsTable.id, parentLearnersTable.parentId))
        .where(and(eq(parentsTable.email, email), eq(learnersTable.username, username)))
        .limit(1))[0]?.learner
      ?? (await db
        .select({ learner: learnersTable })
        .from(learnersTable)
        .innerJoin(usersTable, eq(usersTable.id, learnersTable.userId))
        .where(and(eq(usersTable.email, email), eq(learnersTable.username, username)))
        .limit(1))[0]?.learner;
    if (!target) return res.status(404).json({ error: "No learner account matches that email and username." });
    await db.update(learnersTable).set({ passwordHash }).where(eq(learnersTable.id, target.id));
    if (target.userId) {
      await db.update(usersTable).set({ passwordHash }).where(eq(usersTable.id, target.userId));
    }
    return res.json({ reset: true, username: target.username, fullName: target.fullName, kind: "learner" });
  }

  // Adult accounts: verify the profile owns the address, then reset the unified
  // identity password (which is what every adult login verifies against).
  const table = parsed.data.kind === "parent" ? parentsTable : parsed.data.kind === "teacher" ? teachersTable : tutorsTable;
  const [profile] = await db.select({ id: table.id, userId: table.userId, fullName: table.fullName }).from(table).where(eq(table.email, email)).limit(1);
  if (!profile) return res.status(404).json({ error: "No account matches that email address." });
  if (!profile.userId) return res.status(404).json({ error: "That account has no login to reset." });
  await db.update(usersTable).set({ passwordHash }).where(eq(usersTable.id, profile.userId));
  return res.json({ reset: true, username: email, fullName: profile.fullName, kind: parsed.data.kind });
});

router.get("/auth/me", async (req, res) => {
  const learner = await getCurrentLearner(req);
  return res.json({ learner: learner ? toPublicLearner(learner) : null });
});

router.patch("/learners/me", async (req, res) => {
  const learner = await requireLearner(req, res);
  if (!learner) return;
  try {
    const data = UpdateLearnerProfileBody.parse(req.body);
    if (data.grade !== undefined && !isWholeNumber(data.grade)) return res.status(400).json({ error: "Grade must be a whole number." });
    const [updated] = await db.update(learnersTable).set({
      ...(data.fullName === undefined ? {} : { fullName: data.fullName.trim() }),
      ...(data.grade === undefined ? {} : { grade: data.grade }),
      ...(data.schoolName === undefined ? {} : { schoolName: data.schoolName.trim() }),
      ...(data.subjects === undefined ? {} : { subjects: data.subjects }),
    }).where(eq(learnersTable.id, learner.id)).returning();
    return res.json(toPublicLearner(updated));
  } catch (error) {
    req.log.error({ err: error }, "learner profile update failed");
    return res.status(400).json({ error: "We could not save those changes." });
  }
});

const LinkAccountBody = z.object({
  email: z.string().trim().email(),
  password: z.string().min(8),
});

// Attach an existing learner to a unified slate_users identity, so the same
// email can also hold teacher / parent / tutor roles and switch between them.
router.get("/learners/me/account", async (req, res) => {
  const learner = await requireLearner(req, res);
  if (!learner) return;
  if (!learner.userId) return res.json({ linked: false, email: null, roles: [] as string[] });
  const user = await findUserById(learner.userId);
  if (!user) return res.json({ linked: false, email: null, roles: [] as string[] });
  return res.json({ linked: true, email: user.email, roles: user.roles });
});

router.post("/learners/me/account", async (req, res) => {
  const learner = await requireLearner(req, res);
  if (!learner) return;
  if (learner.userId) return res.status(409).json({ error: "This learner is already linked to a Slate account." });
  const parsed = LinkAccountBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Enter a valid email and a password of at least 8 characters." });
  const result = await createOrMergeUser({
    email: parsed.data.email,
    password: parsed.data.password,
    fullName: learner.fullName,
    role: "LEARNER",
  });
  if ("error" in result) return res.status(409).json({ error: result.error });
  const [alreadyLinked] = await db
    .select({ id: learnersTable.id })
    .from(learnersTable)
    .where(eq(learnersTable.userId, result.user.id))
    .limit(1);
  if (alreadyLinked) return res.status(409).json({ error: "That account already has a learner profile." });
  await db.update(learnersTable).set({ userId: result.user.id }).where(eq(learnersTable.id, learner.id));
  await createUserSession(result.user.id, "LEARNER", res);
  return res.status(201).json({ linked: true, email: result.user.email, roles: result.user.roles });
});

const JoinClassBody = z.object({ joinCode: z.string().trim().min(4).max(12) });

// Every subject classroom the learner belongs to, with per-classroom stats.
// Each classroom is a subject classroom (up to eight); "switching" between
// them is client-side navigation, so this returns everything both the home
// dashboard and the classroom views need.
router.get("/classes/mine", async (req, res) => {
  const learner = await requireLearner(req, res);
  if (!learner) return;
  return res.json(await learnerClassrooms(learner.id));
});

// One classroom's full dashboard: header, live + upcoming work, stats and the
// teacher's uploaded study material. Membership is the access gate.
router.get("/classrooms/:classId", async (req, res) => {
  const learner = await requireLearner(req, res);
  if (!learner) return;
  const classId = req.params.classId;
  if (!classId) return res.status(400).json({ error: "Choose a classroom." });
  await ensureSeedAssignments();
  await ensureIndependentAssignmentsForLearner(learner.id).catch(() => undefined);
  const detail = await learnerClassroomDetail(learner.id, classId);
  if (!detail) return res.status(404).json({ error: "That classroom is not one of yours." });
  return res.json(detail);
});

// Streams one study material: an uploaded file as-is, or inline notes as text.
// Restricted to learners who belong to the class.
router.get("/classrooms/:classId/materials/:materialId/file", async (req, res) => {
  const learner = await requireLearner(req, res);
  if (!learner) return;
  const { classId, materialId } = req.params;
  const [membership] = await db
    .select({ id: classLearnersTable.id })
    .from(classLearnersTable)
    .where(and(eq(classLearnersTable.learnerId, learner.id), eq(classLearnersTable.classId, classId)))
    .limit(1);
  if (!membership) return res.status(404).json({ error: "That classroom is not one of yours." });
  const [material] = await db
    .select()
    .from(classMaterialsTable)
    .where(and(eq(classMaterialsTable.id, materialId), eq(classMaterialsTable.classId, classId)))
    .limit(1);
  if (!material) return res.status(404).json({ error: "That material is no longer available." });
  if (material.fileData) {
    const buffer = Buffer.from(material.fileData, "base64");
    res.setHeader("Content-Type", material.fileType || "application/octet-stream");
    res.setHeader("Content-Disposition", `inline; filename="${(material.fileName || "material").replace(/"/g, "")}"`);
    return res.send(buffer);
  }
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  return res.send(material.content ?? "");
});

router.post("/classes/join", async (req, res) => {
  const learner = await requireLearner(req, res);
  if (!learner) return;
  const parsed = JoinClassBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Enter the class code your teacher gave you." });
  const [classRow] = await db
    .select()
    .from(classesTable)
    .where(eq(classesTable.joinCode, parsed.data.joinCode.trim().toUpperCase()))
    .limit(1);
  if (!classRow) return res.status(404).json({ error: "That class code does not match any class." });
  const [existing] = await db
    .select()
    .from(classLearnersTable)
    .where(and(eq(classLearnersTable.learnerId, learner.id), eq(classLearnersTable.subject, classRow.subject)))
    .limit(1);
  if (existing && existing.classId !== classRow.id) {
    // A learner belongs to one class per subject, so joining a new one moves them.
    await db.update(classLearnersTable).set({ classId: classRow.id }).where(eq(classLearnersTable.id, existing.id));
  } else if (!existing) {
    await db.insert(classLearnersTable).values({ classId: classRow.id, learnerId: learner.id, subject: classRow.subject });
  }
  const subjects = learner.subjects.includes(classRow.subject) ? learner.subjects : [...learner.subjects, classRow.subject];
  await db.update(learnersTable).set({ subjects, grade: classRow.grade }).where(eq(learnersTable.id, learner.id));
  return res.status(201).json({
    class: {
      id: classRow.id,
      grade: classRow.grade,
      section: classRow.section,
      subject: classRow.subject,
      schoolName: classRow.schoolName,
      label: `${gradeName(classRow.grade)}${classRow.section} · ${classRow.subject}`,
    },
  });
});

router.get("/dashboard/summary", async (req, res) => {
  const learner = await requireLearner(req, res);
  if (!learner) return;
  await ensureSeedAssignments();
  await ensureIndependentAssignmentsForLearner(learner.id).catch(() => undefined);
  const assignments = await visibleAssignments(learner);
  const submissionRows = await db.select({ score: submissionsTable.score, assignmentId: submissionsTable.assignmentId, markingStatus: submissionsTable.markingStatus }).from(submissionsTable).where(eq(submissionsTable.learnerId, learner.id));
  const submittedIds = new Set(submissionRows.map((row) => row.assignmentId));
  const statuses = assignments.map((assignment) => assignmentStatus(assignment, submittedIds.has(assignment.id)));
  const profile = await getOrCreateProfile(learner.id);
  const releasedAssignmentIds = new Set(assignments.filter((assignment) => assignment.resultReleasePolicy !== "after_close" || new Date() >= assignment.closeAt).map((assignment) => assignment.id));
  const releasedSubmissionRows = submissionRows.filter((row) => row.markingStatus === "MARKED" && releasedAssignmentIds.has(row.assignmentId));
  const activities = await db.select().from(remediationActivitiesTable).where(and(eq(remediationActivitiesTable.learnerId, learner.id), sql`${remediationActivitiesTable.completedAt} is null`)).orderBy(desc(remediationActivitiesTable.createdAt));
  const nextActivity = activities.find((activity) => !activity.assignmentId || releasedAssignmentIds.has(activity.assignmentId)) ?? null;
  const avg = releasedSubmissionRows.length ? Math.round(releasedSubmissionRows.reduce((sum, row) => sum + row.score, 0) / releasedSubmissionRows.length) : 0;
  const analysis = await learnerHomeAnalysis(learner);
  return res.json({
    learner: toPublicLearner(learner),
    assignments: {
      open: statuses.filter((status) => status === "OPEN").length,
      upcoming: statuses.filter((status) => status === "LOCKED").length,
      completed: statuses.filter((status) => status === "SUBMITTED").length,
      missed: statuses.filter((status) => status === "MISSED").length,
    },
    streakDays: Math.min(7, releasedSubmissionRows.length + (profile.confidence > 0 ? 1 : 0)),
    averageScore: avg,
    nextFocus: profile.activeGaps[0] ?? null,
    nextActivity: nextActivity ? {
      id: nextActivity.id,
      format: nextActivity.format,
      title: nextActivity.title,
      concept: nextActivity.concept,
      prompt: nextActivity.prompt,
      options: nextActivity.options,
      instruction: nextActivity.instruction,
    } : null,
    // Home dashboard: per-subject average and attention flags, reminders for
    // new assignments closing soon, and activities for subjects needing attention.
    subjects: analysis.subjects,
    reminders: analysis.reminders,
    recommended: analysis.recommended,
    overall: analysis.overall,
  });
});

router.get("/assignments", async (req, res) => {
  const learner = await requireLearner(req, res);
  if (!learner) return;
  await ensureSeedAssignments();
  await ensureIndependentAssignmentsForLearner(learner.id).catch(() => undefined);
  const assignments = await visibleAssignments(learner);
  const submittedIds = await getSubmissionMap(learner.id, assignments.map((assignment) => assignment.id));
  return res.json(assignments.map((assignment) => serializeAssignment(assignment, assignmentStatus(assignment, submittedIds.has(assignment.id)), submittedIds.has(assignment.id) ? 100 : 0)));
});

router.get("/assignments/:assignmentId", async (req, res) => {
  const learner = await requireLearner(req, res);
  if (!learner) return;
  const params = GetAssignmentParams.parse(req.params);
  const result = await getAssignmentForLearner(params.assignmentId, learner.id);
  if (!result) return res.status(404).json({ error: "Assignment not found." });
  return res.json(serializeAssignment(result.assignment, result.status, result.progress));
});

router.post("/assignments/:assignmentId/open", async (req, res) => {
  const learner = await requireLearner(req, res);
  if (!learner) return;
  const params = OpenAssignmentParams.parse(req.params);
  const result = await getAssignmentForLearner(params.assignmentId, learner.id);
  if (!result) return res.status(404).json({ error: "Assignment not found." });
  if (result.status !== "OPEN") return res.status(403).json({ error: "This assignment is not open. Its time lock cannot be changed." });
  // Every learner's question set is generated uniquely the first time they
  // open the assignment, then persisted and reused on every re-open. This
  // holds for both Teacher-Dependent and Independent assignments.
  const [existingSession] = await db.select().from(assignmentSessionsTable).where(and(eq(assignmentSessionsTable.assignmentId, params.assignmentId), eq(assignmentSessionsTable.learnerId, learner.id))).orderBy(desc(assignmentSessionsTable.openedAt)).limit(1);
  if (existingSession) {
    let session = existingSession;
    if (new Date() >= existingSession.expiresAt) {
      const expiresAt = new Date(Math.min(result.assignment.closeAt.getTime(), Date.now() + 60 * 60 * 1000));
      const [refreshed] = await db.update(assignmentSessionsTable).set({ expiresAt }).where(eq(assignmentSessionsTable.id, existingSession.id)).returning();
      session = refreshed ?? existingSession;
    }
    return res.json({ assignment: serializeAssignment(result.assignment, result.status, result.progress), sessionId: session.id, questions: toPublicQuestions(session.questions), expiresAt: session.expiresAt.toISOString() });
  }
  try {
    let questions: GeneratedQuestion[];
    if (result.assignment.questionSource === "manual" || result.assignment.questionSource === "pdf") {
      const authoredQuestions = result.assignment.questionBlueprint as GeneratedQuestion[] | null;
      if (!Array.isArray(authoredQuestions) || authoredQuestions.length !== result.assignment.questionCount) {
        return res.status(409).json({ error: "This teacher-authored question set is incomplete. Ask your teacher to review it again." });
      }
      // Manual and PDF-derived questions are delivered as approved, not
      // rewritten by the per-learner generator.
      questions = authoredQuestions.map((question, index) => ({ ...question, id: `q${index + 1}` }));
    } else {
      questions = await generateProblemSet({
        learnerId: learner.id,
        grade: learner.grade,
        gradeLabel: gradeName(result.classRow?.grade ?? learner.grade),
        subject: result.assignment.subject,
        topic: result.assignment.topic,
        curriculumContext: result.assignment.curriculumContext,
        questionCount: result.assignment.questionCount,
        uniquenessSeed: `${learner.id}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        questionTypes: result.assignment.questionTypes,
        questionBlueprint: (result.assignment.questionBlueprint as GeneratedQuestion[] | null) ?? undefined,
      });
    }
    const expiresAt = new Date(Math.min(result.assignment.closeAt.getTime(), Date.now() + 60 * 60 * 1000));
    const [session] = await db.insert(assignmentSessionsTable).values({
      assignmentId: params.assignmentId,
      learnerId: learner.id,
      questions,
      expiresAt,
    }).returning();
    return res.json({ assignment: serializeAssignment(result.assignment, result.status, result.progress), sessionId: session.id, questions: toPublicQuestions(questions), expiresAt: expiresAt.toISOString() });
  } catch (error) {
    req.log.error({ err: error }, "problem set generation failed");
    return res.status(502).json({ error: "Your unique problem set could not be generated right now. Please try again." });
  }
});

router.post("/assignments/:assignmentId/submit", async (req, res) => {
  const learner = await requireLearner(req, res);
  if (!learner) return;
  const params = SubmitAssignmentParams.parse(req.params);
  const body = SubmitAssignmentBody.parse(req.body);
  const result = await getAssignmentForLearner(params.assignmentId, learner.id);
  if (!result) return res.status(404).json({ error: "Assignment not found." });
  if (result.status !== "OPEN") return res.status(403).json({ error: "This assignment is closed and cannot accept a late submission." });
  const [session] = await db.select().from(assignmentSessionsTable).where(and(eq(assignmentSessionsTable.id, body.sessionId), eq(assignmentSessionsTable.assignmentId, params.assignmentId), eq(assignmentSessionsTable.learnerId, learner.id))).limit(1);
  if (!session || new Date() >= session.expiresAt) return res.status(403).json({ error: "This assignment session has expired." });
  try {
    const questions = session.questions as GeneratedQuestion[];
    const markingMode = result.assignment.markingMode ?? "auto";
    const clampScore = (value: number | null) => (value === null ? null : Math.max(0, Math.min(100, Math.round(value))));

    // AUTO: Gemini marks every question immediately (existing behaviour).
    // SELECTIVE: indices in autoMarkQuestions go to Gemini; the rest are held
    // for the teacher. MANUAL: everything is held for the teacher.
    let marks: Array<{ questionId: string; verdict: string; explanation: string; score: number | null; gap: string | null }>;
    let markingStatus: string = "MARKED";
    let score = 0;
    let overallVerdict = "PENDING_REVIEW";
    let feedback = "Held for teacher review.";
    let remediation: NonNullable<MarkingResult["remediation"]> | null = null;

    const assessmentGuide = await assessmentGuideForClass(result.classRow);
    if (markingMode === "auto") {
      const marking = await markAssignment({ subject: result.assignment.subject, topic: result.assignment.topic, questions, answers: body.answers, assessmentGuide });
      marks = marking.marks.slice(0, questions.length).map((mark) => ({ ...mark, gap: mark.gap ?? null, score: Math.max(0, Math.min(100, Math.round(mark.score))) }));
      score = Math.max(0, Math.min(100, Math.round(marking.score)));
      overallVerdict = marking.overallVerdict;
      feedback = marking.feedback;
      remediation = marking.remediation;
    } else {
      const autoSet = new Set(markingMode === "manual" ? [] : (result.assignment.autoMarkQuestions ?? []));
      const heldForTeacher = questions.map((question, index) => ({ question, index })).filter((entry) => !autoSet.has(entry.index));
      const autoSubset = questions.filter((_, index) => autoSet.has(index));
      let autoMarking: MarkingResult | null = null;
      if (autoSubset.length) {
        const autoAnswers = autoSubset.map((question) => body.answers.find((entry) => entry.questionId === question.id) ?? { questionId: question.id, answer: "" });
        autoMarking = await markAssignment({ subject: result.assignment.subject, topic: result.assignment.topic, questions: autoSubset, answers: autoAnswers, assessmentGuide });
      }
      marks = questions.map((question, index) => {
        if (heldForTeacher.some((entry) => entry.question.id === question.id)) {
          return { questionId: question.id, verdict: "PENDING_TEACHER_REVIEW", explanation: "Held for teacher marking.", score: null, gap: null };
        }
        const entry = autoMarking?.marks.find((mark) => mark.questionId === question.id);
        return {
          questionId: question.id,
          verdict: entry?.verdict ?? "PENDING_TEACHER_REVIEW",
          explanation: entry?.explanation ?? "",
          score: entry ? clampScore(entry.score) : null,
          gap: entry?.gap ?? null,
        };
      });
      const autoScores = marks.filter((mark) => mark.score !== null).map((mark) => mark.score as number);
      score = autoScores.length ? Math.max(0, Math.min(100, Math.round(autoScores.reduce((total, value) => total + value, 0) / autoScores.length))) : 0;
      if (autoMarking) {
        overallVerdict = autoMarking.overallVerdict;
        feedback = autoMarking.feedback;
        remediation = autoMarking.remediation;
      }
      if (heldForTeacher.length > 0) markingStatus = "PENDING_TEACHER_REVIEW";
    }

    const [submission] = await db.insert(submissionsTable).values({
      assignmentId: params.assignmentId,
      learnerId: learner.id,
      sessionId: body.sessionId,
      score,
      overallVerdict,
      feedback,
      marks,
      answers: body.answers,
      markingStatus,
    }).returning();

    const resultsReleased = markingStatus === "MARKED" && (
      result.assignment.resultReleasePolicy !== "after_close" || new Date() >= result.assignment.closeAt
    );
    const publicRemediation = remediation && formats.includes(remediation.format) ? remediation : null;
    let publicRemediationPayload = null;
    if (publicRemediation) {
      const [created] = await db.insert(remediationActivitiesTable).values({
        learnerId: learner.id,
        assignmentId: params.assignmentId,
        format: publicRemediation.format,
        title: publicRemediation.title,
        concept: publicRemediation.concept,
        prompt: publicRemediation.prompt,
        options: publicRemediation.options ?? [],
        instruction: publicRemediation.instruction,
        expectedAnswer: publicRemediation.expectedAnswer,
      }).returning();
      publicRemediationPayload = {
        id: created.id,
        format: created.format,
        title: created.title,
        concept: created.concept,
        prompt: created.prompt,
        options: created.options,
        instruction: created.instruction,
      };
      const firstGap = marks.find((mark) => mark.gap)?.gap;
      await updateLearningSignal(learner.id, publicRemediation.format, score, firstGap);
    }
    if (resultsReleased) {
      await db.insert(learningActivitiesTable).values({
        learnerId: learner.id,
        label: `Completed ${result.assignment.title}`,
        subject: result.assignment.subject,
        score,
        detail: feedback,
      });
    }
    if (!resultsReleased) {
      return res.json({
        submissionId: submission.id,
        score: null,
        overallVerdict: null,
        feedback: null,
        marks: [],
        markingStatus,
        released: false,
        statusMessage: result.assignment.resultReleasePolicy === "after_close"
          ? "Submitted. Your result will be available after the assignment closes."
          : "Submitted. Your result will be available once every question is marked.",
        remediation: null,
      });
    }
    return res.json({ submissionId: submission.id, score, overallVerdict, feedback, marks, markingStatus, released: true, remediation: publicRemediationPayload });
  } catch (error) {
    req.log.error({ err: error }, "assignment marking failed");
    return res.status(502).json({ error: "Your answers could not be marked right now. Please try again." });
  }
});

// Read-only per-question result view. Unlocks only once every question
// (auto, selective or manual) is fully marked; answers are never editable.
router.get("/assignments/:assignmentId/review", async (req, res) => {
  const learner = await requireLearner(req, res);
  if (!learner) return;
  const params = GetAssignmentParams.parse(req.params);
  const result = await getAssignmentForLearner(params.assignmentId, learner.id);
  if (!result) return res.status(404).json({ error: "Assignment not found." });
  const [submission] = await db
    .select()
    .from(submissionsTable)
    .where(and(eq(submissionsTable.assignmentId, params.assignmentId), eq(submissionsTable.learnerId, learner.id)))
    .orderBy(desc(submissionsTable.submittedAt))
    .limit(1);
  if (!submission) return res.status(404).json({ error: "You have not submitted this assignment." });
  if (result.assignment.resultReleasePolicy === "after_close" && new Date() < result.assignment.closeAt) {
    return res.status(403).json({ error: "Your result will unlock after the assignment closes." });
  }
  if (submission.markingStatus !== "MARKED") {
    return res.status(403).json({ error: "Results unlock once your teacher finishes marking every question." });
  }
  const script = await buildMarkedScript(submission);
  if (!script) return res.status(404).json({ error: "Your question set could not be found." });
  const [activity] = await db.select()
    .from(remediationActivitiesTable)
    .where(and(
      eq(remediationActivitiesTable.assignmentId, params.assignmentId),
      eq(remediationActivitiesTable.learnerId, learner.id),
      isNull(remediationActivitiesTable.completedAt),
    ))
    .orderBy(desc(remediationActivitiesTable.createdAt))
    .limit(1);
  return res.json({
    assignment: serializeAssignment(result.assignment, "SUBMITTED", 100),
    score: script.score,
    overallVerdict: script.overallVerdict,
    feedback: script.feedback,
    markingStatus: script.markingStatus,
    released: true,
    remediation: activity ? {
      id: activity.id,
      format: activity.format,
      title: activity.title,
      concept: activity.concept,
      prompt: activity.prompt,
      options: activity.options,
      instruction: activity.instruction,
    } : null,
    questions: script.questions,
  });
});

router.get("/learning-profile", async (req, res) => {
  const learner = await requireLearner(req, res);
  if (!learner) return;
  const profile = await getOrCreateProfile(learner.id);
  return res.json({
    learnerId: profile.learnerId,
    primaryStyle: profile.primaryStyle,
    confidence: profile.confidence,
    signals: profile.signals,
    activeGaps: profile.activeGaps,
  });
});

router.get("/activity", async (req, res) => {
  const learner = await requireLearner(req, res);
  if (!learner) return;
  const rows = await db.select().from(learningActivitiesTable).where(eq(learningActivitiesTable.learnerId, learner.id)).orderBy(desc(learningActivitiesTable.timestamp)).limit(12);
  return res.json(rows.map((row) => ({ id: row.id, label: row.label, subject: row.subject, score: row.score, timestamp: row.timestamp.toISOString(), detail: row.detail })));
});

router.post("/remediation/:activityId/respond", async (req, res) => {
  const learner = await requireLearner(req, res);
  if (!learner) return;
  const params = RespondToRemediationParams.parse(req.params);
  const body = RespondToRemediationBody.parse(req.body);
  const [activity] = await db.select().from(remediationActivitiesTable).where(and(eq(remediationActivitiesTable.id, params.activityId), eq(remediationActivitiesTable.learnerId, learner.id))).limit(1);
  if (!activity) return res.status(404).json({ error: "This learning activity is no longer available." });
  try {
    const marked = await markRemediation({ concept: activity.concept, format: activity.format, prompt: activity.prompt, expectedAnswer: activity.expectedAnswer, answer: body.answer });
    const activityScore = Math.max(0, Math.min(100, Math.round(marked.score)));
    await db.update(remediationActivitiesTable).set({ completedAt: new Date(), score: activityScore }).where(eq(remediationActivitiesTable.id, activity.id));
    await updateLearningSignal(learner.id, activity.format, marked.score, activity.concept);
    const followUp = await generateFollowUp({ concept: activity.concept });
    return res.json({
      correct: Boolean(marked.correct),
      feedback: marked.feedback,
      score: activityScore,
      followUpQuestion: body.followUp === true ? null : { id: followUp.id, prompt: followUp.prompt, type: followUp.type, concept: followUp.concept, options: followUp.options },
      improved: null,
    });
  } catch (error) {
    req.log.error({ err: error }, "remediation marking failed");
    return res.status(502).json({ error: "This activity could not be checked right now. Please try again." });
  }
});

const CompleteActivityBody = z.object({
  score: z.number().int().min(0).max(100),
});

type PublicActivity = {
  id: string;
  type: string;
  title: string;
  concept: string;
  prompt: string;
  options: string[];
  instruction: string;
  createdAt?: string;
  score?: number | null;
};

function publicActivity(row: Pick<typeof remediationActivitiesTable.$inferSelect, "id" | "format" | "title" | "concept" | "prompt" | "options" | "instruction" | "createdAt" | "completedAt" | "score">): PublicActivity {
  return {
    id: row.id,
    type: row.format,
    title: row.title,
    concept: row.concept,
    prompt: row.prompt,
    options: row.options,
    instruction: row.instruction,
    createdAt: row.createdAt.toISOString(),
    score: row.completedAt ? row.score : null,
  };
}

async function generateActivitiesForLearner(learner: typeof learnersTable.$inferSelect, count = 3): Promise<typeof remediationActivitiesTable.$inferSelect[]> {
  const profile = await getOrCreateProfile(learner.id);
  const generated = await generateRecommendedActivities({
    learnerName: learner.fullName,
    grade: learner.grade,
    style: profile.primaryStyle,
    gaps: profile.activeGaps,
    subjects: learner.subjects,
    count,
  });
  if (!generated.length) throw new Error("No activities were generated.");
  const inserted = await db.insert(remediationActivitiesTable).values(
    generated.map((activity) => ({
      learnerId: learner.id,
      assignmentId: null as string | null,
      format: activity.type.toUpperCase(),
      title: activity.title,
      concept: activity.concept,
      prompt: activity.content.prompt,
      options: activity.content.options ?? [],
      instruction: activity.content.instruction,
      expectedAnswer: activity.content.expectedAnswer,
    })),
  ).returning();
  return inserted;
}

// Gap-driven activities engine: recommend 3, complete with a score feeding
// CLIP, and refresh to mint a replacement.
router.get("/activities/recommended", async (req, res) => {
  const learner = await requireLearner(req, res);
  if (!learner) return;
  try {
    const openRows = await db
      .select()
      .from(remediationActivitiesTable)
      .where(and(eq(remediationActivitiesTable.learnerId, learner.id), isNull(remediationActivitiesTable.completedAt)))
      .orderBy(asc(remediationActivitiesTable.createdAt))
      .limit(3);
    let rows = openRows;
    if (!openRows.length) {
      rows = await generateActivitiesForLearner(learner);
    }
    return res.json({ activities: rows.map(publicActivity) });
  } catch (error) {
    req.log.error({ err: error }, "activity recommendation failed");
    return res.status(502).json({ error: "We could not build new activities right now. Please try again." });
  }
});

router.post("/activities/:activityId/complete", async (req, res) => {
  const learner = await requireLearner(req, res);
  if (!learner) return;
  const parsed = CompleteActivityBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Send a whole-number score between 0 and 100." });
  const [activity] = await db
    .select()
    .from(remediationActivitiesTable)
    .where(and(eq(remediationActivitiesTable.id, req.params.activityId), eq(remediationActivitiesTable.learnerId, learner.id)))
    .limit(1);
  if (!activity) return res.status(404).json({ error: "That activity is no longer available." });
  const score = parsed.data.score;
  const gap = score < 40 ? activity.concept : null;
  await db
    .update(remediationActivitiesTable)
    .set({ completedAt: new Date(), score })
    .where(eq(remediationActivitiesTable.id, activity.id));
  await updateLearningSignal(learner.id, activity.format, score, gap);
  return res.json({ activity: { ...publicActivity(activity), score }, score });
});

router.get("/activities/refresh", async (req, res) => {
  const learner = await requireLearner(req, res);
  if (!learner) return;
  try {
    const [replacement] = await generateActivitiesForLearner(learner, 1);
    return res.json({ activity: publicActivity(replacement) });
  } catch (error) {
    req.log.error({ err: error }, "activity refresh failed");
    return res.status(502).json({ error: "A new activity could not be built right now. Please try again." });
  }
});

export default router;