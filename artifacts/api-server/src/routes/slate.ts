import { Router, type IRouter } from "express";
import { and, asc, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
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
  classesTable,
  db,
  learningActivitiesTable,
  learningProfilesTable,
  learnersTable,
  remediationActivitiesTable,
  submissionsTable,
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
import { learnerClassrooms, learnerHomeAnalysis } from "../lib/learner-classrooms";
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
  };
}

async function getAssignmentForLearner(id: string, learnerId: string) {
  const [assignment] = await db.select().from(assignmentsTable).where(eq(assignmentsTable.id, id)).limit(1);
  if (!assignment) return null;
  if (assignment.classId) {
    const [membership] = await db
      .select({ id: classLearnersTable.id })
      .from(classLearnersTable)
      .where(and(eq(classLearnersTable.learnerId, learnerId), eq(classLearnersTable.classId, assignment.classId)))
      .limit(1);
    if (!membership) return null;
  }
  const [submission] = await db
    .select({ id: submissionsTable.id, score: submissionsTable.score })
    .from(submissionsTable)
    .where(and(eq(submissionsTable.assignmentId, id), eq(submissionsTable.learnerId, learnerId)))
    .limit(1);
  return {
    assignment,
    status: assignmentStatus(assignment, Boolean(submission)),
    progress: submission ? 100 : 0,
  };
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

// Email is optional on the learner form: supplying one links the learner to a
// unified slate_users identity (LEARNER role) so the same person can also hold
// teacher, parent or tutor roles on a single account and switch between them.
const LearnerEmail = z.object({ email: z.string().trim().email().optional() });

router.post("/auth/register", async (req, res) => {
  try {
    const data = RegisterLearnerBody.parse(req.body);
    const email = LearnerEmail.safeParse(req.body).data?.email;
    if (!isWholeNumber(data.grade)) return res.status(400).json({ error: "Grade must be a whole number." });
    const username = data.username.trim().toLowerCase();
    const [existing] = await db.select({ id: learnersTable.id }).from(learnersTable).where(eq(learnersTable.username, username)).limit(1);
    if (existing) return res.status(409).json({ error: "That username is already in use." });
    let userId: string | null = null;
    if (email) {
      const result = await createOrMergeUser({ email, password: data.password, fullName: data.fullName, role: "LEARNER" });
      if ("error" in result) return res.status(409).json({ error: result.error });
      const [linked] = await db.select({ id: learnersTable.id }).from(learnersTable).where(eq(learnersTable.userId, result.user.id)).limit(1);
      if (linked) return res.status(409).json({ error: "That email already has a learner profile." });
      userId = result.user.id;
    }
    const [learner] = await db.insert(learnersTable).values({
      username,
      userId,
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
      label: `Grade ${classRow.grade}${classRow.section} · ${classRow.subject}`,
    },
  });
});

router.get("/dashboard/summary", async (req, res) => {
  const learner = await requireLearner(req, res);
  if (!learner) return;
  await ensureSeedAssignments();
  await ensureIndependentAssignmentsForLearner(learner.id).catch(() => undefined);
  const assignments = await visibleAssignments(learner);
  const submissionRows = await db.select({ score: submissionsTable.score, assignmentId: submissionsTable.assignmentId }).from(submissionsTable).where(eq(submissionsTable.learnerId, learner.id));
  const submittedIds = new Set(submissionRows.map((row) => row.assignmentId));
  const statuses = assignments.map((assignment) => assignmentStatus(assignment, submittedIds.has(assignment.id)));
  const profile = await getOrCreateProfile(learner.id);
  const [nextActivity] = await db.select().from(remediationActivitiesTable).where(and(eq(remediationActivitiesTable.learnerId, learner.id), sql`${remediationActivitiesTable.completedAt} is null`)).orderBy(desc(remediationActivitiesTable.createdAt)).limit(1);
  const avg = submissionRows.length ? Math.round(submissionRows.reduce((sum, row) => sum + row.score, 0) / submissionRows.length) : 0;
  const analysis = await learnerHomeAnalysis(learner);
  return res.json({
    learner: toPublicLearner(learner),
    assignments: {
      open: statuses.filter((status) => status === "OPEN").length,
      upcoming: statuses.filter((status) => status === "LOCKED").length,
      completed: statuses.filter((status) => status === "SUBMITTED").length,
      missed: statuses.filter((status) => status === "MISSED").length,
    },
    streakDays: Math.min(7, submissionRows.length + (profile.confidence > 0 ? 1 : 0)),
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
    const questions = await generateProblemSet({
      learnerId: learner.id,
      learnerName: learner.fullName,
      grade: learner.grade,
      subject: result.assignment.subject,
      topic: result.assignment.topic,
      curriculumContext: result.assignment.curriculumContext,
      questionCount: result.assignment.questionCount,
      uniquenessSeed: `${learner.id}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    });
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

    if (markingMode === "auto") {
      const marking = await markAssignment({ subject: result.assignment.subject, topic: result.assignment.topic, questions, answers: body.answers });
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
        autoMarking = await markAssignment({ subject: result.assignment.subject, topic: result.assignment.topic, questions: autoSubset, answers: autoAnswers });
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
    await db.insert(learningActivitiesTable).values({
      learnerId: learner.id,
      label: `Completed ${result.assignment.title}`,
      subject: result.assignment.subject,
      score,
      detail: feedback,
    });
    return res.json({ submissionId: submission.id, score, overallVerdict, feedback, marks, markingStatus, remediation: publicRemediationPayload });
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
  if (submission.markingStatus !== "MARKED") {
    return res.status(403).json({ error: "Results unlock once your teacher finishes marking every question." });
  }
  const [session] = await db.select().from(assignmentSessionsTable).where(eq(assignmentSessionsTable.id, submission.sessionId)).limit(1);
  if (!session) return res.status(404).json({ error: "Your question set could not be found." });
  const questions = session.questions as GeneratedQuestion[];
  const marks = (submission.marks as Array<{ questionId: string; verdict: string; explanation: string; score: number | null; gap: string | null }>) ?? [];
  const answers = submission.answers ?? [];
  return res.json({
    assignment: serializeAssignment(result.assignment, "SUBMITTED", 100),
    score: submission.score,
    overallVerdict: submission.overallVerdict,
    feedback: submission.feedback,
    markingStatus: submission.markingStatus,
    questions: questions.map((question) => {
      const mark = marks.find((entry) => entry.questionId === question.id);
      const learnerAnswer = answers.find((entry) => entry.questionId === question.id)?.answer ?? null;
      return {
        questionId: question.id,
        prompt: question.prompt,
        type: question.type,
        options: question.options ?? [],
        concept: question.concept,
        learnerAnswer,
        verdict: mark?.verdict ?? null,
        score: mark?.score ?? null,
        correctAnswer: question.answer,
        explanation: mark?.explanation ?? "",
        gap: mark?.gap ?? null,
      };
    }),
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