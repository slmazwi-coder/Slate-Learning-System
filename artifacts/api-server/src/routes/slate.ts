import { Router, type IRouter } from "express";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
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
  db,
  learningActivitiesTable,
  learningProfilesTable,
  learnersTable,
  remediationActivitiesTable,
  submissionsTable,
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
  markAssignment,
  markRemediation,
  type GeneratedQuestion,
} from "../lib/ai";

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

router.post("/auth/register", async (req, res) => {
  try {
    const data = RegisterLearnerBody.parse(req.body);
    if (!isWholeNumber(data.grade)) return res.status(400).json({ error: "Grade must be a whole number." });
    const username = data.username.trim().toLowerCase();
    const [existing] = await db.select({ id: learnersTable.id }).from(learnersTable).where(eq(learnersTable.username, username)).limit(1);
    if (existing) return res.status(409).json({ error: "That username is already in use." });
    const [learner] = await db.insert(learnersTable).values({
      username,
      passwordHash: await hashPassword(data.password),
      fullName: data.fullName.trim(),
      grade: data.grade,
      schoolName: data.schoolName.trim(),
      subjects: data.subjects,
    }).returning();
    await getOrCreateProfile(learner.id);
    await createSession(learner.id, res);
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
    return res.json({ learner: toPublicLearner(learner) });
  } catch (error) {
    req.log.error({ err: error }, "learner login failed");
    return res.status(400).json({ error: "Please check your details and try again." });
  }
});

router.post("/auth/logout", async (req, res) => {
  await destroySession(req, res);
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

router.get("/dashboard/summary", async (req, res) => {
  const learner = await requireLearner(req, res);
  if (!learner) return;
  await ensureSeedAssignments();
  const assignments = await db.select().from(assignmentsTable).orderBy(asc(assignmentsTable.openAt));
  const submissionRows = await db.select({ score: submissionsTable.score, assignmentId: submissionsTable.assignmentId }).from(submissionsTable).where(eq(submissionsTable.learnerId, learner.id));
  const submittedIds = new Set(submissionRows.map((row) => row.assignmentId));
  const statuses = assignments.map((assignment) => assignmentStatus(assignment, submittedIds.has(assignment.id)));
  const profile = await getOrCreateProfile(learner.id);
  const [nextActivity] = await db.select().from(remediationActivitiesTable).where(and(eq(remediationActivitiesTable.learnerId, learner.id), sql`${remediationActivitiesTable.completedAt} is null`)).orderBy(desc(remediationActivitiesTable.createdAt)).limit(1);
  const avg = submissionRows.length ? Math.round(submissionRows.reduce((sum, row) => sum + row.score, 0) / submissionRows.length) : 0;
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
  });
});

router.get("/assignments", async (req, res) => {
  const learner = await requireLearner(req, res);
  if (!learner) return;
  await ensureSeedAssignments();
  const assignments = await db.select().from(assignmentsTable).orderBy(asc(assignmentsTable.openAt));
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
  const [existingSession] = await db.select().from(assignmentSessionsTable).where(and(eq(assignmentSessionsTable.assignmentId, params.assignmentId), eq(assignmentSessionsTable.learnerId, learner.id))).orderBy(desc(assignmentSessionsTable.openedAt)).limit(1);
  if (existingSession && new Date() < existingSession.expiresAt) {
    return res.json({ assignment: serializeAssignment(result.assignment, result.status, result.progress), sessionId: existingSession.id, questions: existingSession.questions, expiresAt: existingSession.expiresAt.toISOString() });
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
    const publicQuestions = questions.map(({ answer: _answer, ...question }) => question);
    return res.json({ assignment: serializeAssignment(result.assignment, result.status, result.progress), sessionId: session.id, questions: publicQuestions, expiresAt: expiresAt.toISOString() });
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
    const marking = await markAssignment({ subject: result.assignment.subject, topic: result.assignment.topic, questions, answers: body.answers });
    const marks = marking.marks.slice(0, questions.length).map((mark) => ({ ...mark, score: Math.max(0, Math.min(100, Math.round(mark.score))) }));
    const score = Math.max(0, Math.min(100, Math.round(marking.score)));
    const [submission] = await db.insert(submissionsTable).values({
      assignmentId: params.assignmentId,
      learnerId: learner.id,
      sessionId: body.sessionId,
      score,
      overallVerdict: marking.overallVerdict,
      feedback: marking.feedback,
      marks,
    }).returning();
    const remediation = marking.remediation && formats.includes(marking.remediation.format) ? marking.remediation : null;
    let publicRemediation = null;
    if (remediation) {
      const [created] = await db.insert(remediationActivitiesTable).values({
        learnerId: learner.id,
        assignmentId: params.assignmentId,
        format: remediation.format,
        title: remediation.title,
        concept: remediation.concept,
        prompt: remediation.prompt,
        options: remediation.options ?? [],
        instruction: remediation.instruction,
        expectedAnswer: remediation.expectedAnswer,
      }).returning();
      publicRemediation = {
        id: created.id,
        format: created.format,
        title: created.title,
        concept: created.concept,
        prompt: created.prompt,
        options: created.options,
        instruction: created.instruction,
      };
      const firstGap = marks.find((mark) => mark.gap)?.gap;
      await updateLearningSignal(learner.id, remediation.format, score, firstGap);
    }
    await db.insert(learningActivitiesTable).values({
      learnerId: learner.id,
      label: `Completed ${result.assignment.title}`,
      subject: result.assignment.subject,
      score,
      detail: marking.feedback,
    });
    return res.json({ submissionId: submission.id, score, overallVerdict: marking.overallVerdict, feedback: marking.feedback, marks, remediation: publicRemediation });
  } catch (error) {
    req.log.error({ err: error }, "assignment marking failed");
    return res.status(502).json({ error: "Your answers could not be marked right now. Please try again." });
  }
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
    await db.update(remediationActivitiesTable).set({ completedAt: new Date() }).where(eq(remediationActivitiesTable.id, activity.id));
    await updateLearningSignal(learner.id, activity.format, marked.score, activity.concept);
    const followUp = await generateFollowUp({ concept: activity.concept });
    return res.json({
      correct: Boolean(marked.correct),
      feedback: marked.feedback,
      score: Math.max(0, Math.min(100, Math.round(marked.score))),
      followUpQuestion: body.followUp === true ? null : { id: followUp.id, prompt: followUp.prompt, type: followUp.type, concept: followUp.concept, options: followUp.options },
      improved: null,
    });
  } catch (error) {
    req.log.error({ err: error }, "remediation marking failed");
    return res.status(502).json({ error: "This activity could not be checked right now. Please try again." });
  }
});

export default router;