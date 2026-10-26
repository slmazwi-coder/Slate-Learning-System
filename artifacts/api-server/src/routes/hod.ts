import { Router, type IRouter } from "express";
import { and, desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { classHodsTable, classesTable, db, assignmentsTable, learnersTable, submissionsTable } from "@workspace/db";
import { recordAudit } from "../lib/audit";
import { rateLimit } from "../lib/rate-limit";
import {
  createHodSession,
  destroyHodSession,
  getCurrentHod,
  hodClassIds,
  hodSupervises,
  requireHod,
  toPublicHod,
} from "../lib/hod-auth";
import { buildMarkedScript, submissionById } from "../lib/marked-script";
import { loadMemo } from "../lib/memos";
import { redactScriptForAudience } from "../lib/script-export";
import { classesByIds, classById, hodClassSummary, hodOverview } from "../lib/hod-views";
import { createOrMergeUser, verifyUserLogin } from "../lib/unified-auth";

const router: IRouter = Router();

const RegisterHodBody = z.object({
  fullName: z.string().trim().min(2).max(120),
  email: z.string().trim().email(),
  password: z.string().min(8).max(128),
});

const LoginHodBody = z.object({
  email: z.string().trim().email(),
  password: z.string().min(1),
});

const JoinHodBody = z.object({
  code: z.string().trim().min(4).max(12),
});

// HOD accounts have no profile table: the unified account IS the identity, so
// registration only needs to add the HOD role to (or create) the identity.
router.post("/hod/auth/register", rateLimit({ scope: "hod-register", usernameField: "email" }), async (req, res) => {
  const parsed = RegisterHodBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Please complete every field. Passwords need at least 8 characters." });
  try {
    const result = await createOrMergeUser({
      email: parsed.data.email,
      password: parsed.data.password,
      fullName: parsed.data.fullName,
      role: "HOD",
    });
    if ("error" in result) return res.status(401).json({ error: result.error });
    await createHodSession(result.user.id, res);
    return res.status(201).json({ hod: toPublicHod(result.user), classes: [] });
  } catch (error) {
    req.log.error({ err: error }, "hod registration failed");
    return res.status(400).json({ error: "We could not create that HOD account." });
  }
});

router.post("/hod/auth/login", rateLimit({ scope: "hod-login", usernameField: "email" }), async (req, res) => {
  const parsed = LoginHodBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Enter your email address and password." });
  const user = await verifyUserLogin(parsed.data.email, parsed.data.password);
  if (!user || !user.roles.includes("HOD")) {
    return res.status(401).json({ error: "That email or password is not correct." });
  }
  await createHodSession(user.id, res);
  return res.json({ hod: toPublicHod(user), classes: await classesByIds(await hodClassIds(user.id)) });
});

router.post("/hod/auth/logout", async (req, res) => {
  await destroyHodSession(req, res);
  return res.status(204).send();
});

router.get("/hod/auth/me", async (req, res) => {
  const hod = await getCurrentHod(req);
  if (!hod) return res.json({ hod: null, classes: [] });
  return res.json({ hod: toPublicHod(hod), classes: await classesByIds(await hodClassIds(hod.id)) });
});

// Join a class at HOD level using the class's HOD code. Rate limited because it
// is an unauthenticated-guessable token like a learner join code.
router.post("/hod/join", rateLimit({ scope: "hod-join", usernameField: "code" }), async (req, res) => {
  const hod = await requireHod(req, res);
  if (!hod) return;
  const parsed = JoinHodBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Enter the HOD code your school gave you." });
  const [classRow] = await db
    .select()
    .from(classesTable)
    .where(eq(classesTable.hodJoinCode, parsed.data.code.trim().toUpperCase()))
    .limit(1);
  if (!classRow) return res.status(404).json({ error: "That HOD code does not match any class." });
  const [active] = await db
    .select()
    .from(classHodsTable)
    .where(and(
      eq(classHodsTable.classId, classRow.id),
      eq(classHodsTable.hodUserId, hod.id),
      isNull(classHodsTable.leftAt),
      isNull(classHodsTable.removedAt),
    ))
    .limit(1);
  if (active) {
    return res.status(200).json({ ...(await hodClassSummary(classRow)), alreadySupervising: true });
  }
  // Revive a previous membership rather than piling up rows; the audit log is
  // the durable history.
  const [previous] = await db
    .select()
    .from(classHodsTable)
    .where(and(eq(classHodsTable.classId, classRow.id), eq(classHodsTable.hodUserId, hod.id)))
    .orderBy(desc(classHodsTable.joinedAt))
    .limit(1);
  if (previous) {
    await db
      .update(classHodsTable)
      .set({ leftAt: null, removedAt: null, removedBy: null, removalReason: null, joinedAt: new Date() })
      .where(eq(classHodsTable.id, previous.id));
  } else {
    await db.insert(classHodsTable).values({ classId: classRow.id, hodUserId: hod.id });
  }
  await recordAudit({
    actorUserId: hod.id,
    actorRole: "HOD",
    action: "hod_join",
    classId: classRow.id,
    memberId: hod.id,
    memberType: "hod",
    detail: `HOD joined ${classRow.subject} (grade ${classRow.grade}${classRow.section || ""}) at supervisory level.`,
  });
  return res.status(201).json(await hodClassSummary(classRow));
});

// Only the HOD can leave a class. There is no teacher or support equivalent
// exposed over HTTP.
router.post("/hod/classes/:classId/leave", async (req, res) => {
  const hod = await requireHod(req, res);
  if (!hod) return;
  const classRow = await classById(req.params.classId);
  if (!classRow || !(await hodSupervises(hod.id, classRow.id))) {
    return res.status(404).json({ error: "You do not supervise that class." });
  }
  await db
    .update(classHodsTable)
    .set({ leftAt: new Date() })
    .where(and(
      eq(classHodsTable.classId, classRow.id),
      eq(classHodsTable.hodUserId, hod.id),
      isNull(classHodsTable.leftAt),
      isNull(classHodsTable.removedAt),
    ));
  await recordAudit({
    actorUserId: hod.id,
    actorRole: "HOD",
    action: "hod_leave",
    classId: classRow.id,
    memberId: hod.id,
    memberType: "hod",
    detail: `HOD left ${classRow.subject} (grade ${classRow.grade}${classRow.section || ""}).`,
  });
  return res.json({ classes: await classesByIds(await hodClassIds(hod.id)) });
});

// The HOD's classes grouped by teacher, with class averages, zone counts,
// completion rate and trend. Teachers are grouped and named, never ranked.
router.get("/hod/overview", async (req, res) => {
  const hod = await requireHod(req, res);
  if (!hod) return;
  const classRows = await classesByIds(await hodClassIds(hod.id));
  return res.json(await hodOverview(classRows));
});

// A read-only teacher-dashboard view with the learner panels removed: class
// average, concept-gap alerts, zone counts and trend only.
router.get("/hod/classes/:classId", async (req, res) => {
  const hod = await requireHod(req, res);
  if (!hod) return;
  const classRow = await classById(req.params.classId);
  // Membership is checked server-side; a class the HOD has not joined is
  // indistinguishable from one that does not exist.
  if (!classRow || !(await hodSupervises(hod.id, classRow.id))) {
    return res.status(404).json({ error: "You do not supervise that class." });
  }
  return res.json(await hodClassSummary(classRow, { includeAssignments: true }));
});

// Script access is the teacher's switch. While it is off the HOD sees 403, and
// while it is on the HOD may read the class's marked scripts (never write).
router.get("/hod/classes/:classId/assignments/:assignmentId/submissions", async (req, res) => {
  const hod = await requireHod(req, res);
  if (!hod) return;
  const classRow = await classById(req.params.classId);
  if (!classRow || !(await hodSupervises(hod.id, classRow.id))) {
    return res.status(404).json({ error: "You do not supervise that class." });
  }
  if (!classRow.hodCanViewScripts) {
    return res.status(403).json({ error: "Script access is switched off for this class. Ask the teacher to enable it." });
  }
  const summary = await hodClassSummary(classRow, { includeAssignments: true });
  const assignment = summary.assignments?.find((row) => row.id === req.params.assignmentId);
  if (!assignment) return res.status(404).json({ error: "That assignment is not in this class." });
  await recordAudit({
    actorUserId: hod.id,
    actorRole: "HOD",
    action: "hod_script_view",
    classId: classRow.id,
    memberId: hod.id,
    memberType: "hod",
    detail: `HOD opened the submission list for assignment ${assignment.id} (${assignment.title}).`,
  });
  return res.json({
    class: summary.class,
    assignment,
    // Read-only index of the scripts the HOD may open. The learner's name is
    // shown here and on the script itself, and only while script access is on.
    submissions: await submissionIndex(classRow.id, req.params.assignmentId),
  });
});

router.get("/hod/submissions/:submissionId", async (req, res) => {
  const hod = await requireHod(req, res);
  if (!hod) return;
  const submission = await submissionById(req.params.submissionId);
  if (!submission) return res.status(404).json({ error: "That submission was not found." });
  const script = await buildMarkedScript(submission, { editable: false });
  if (!script?.class) return res.status(404).json({ error: "That marked script could not be found." });
  // Resolve the class from the submission itself, never from the request, then
  // check both membership and the teacher's script-access switch.
  const classRow = await classById(script.class.id);
  if (!classRow || !(await hodSupervises(hod.id, classRow.id))) {
    return res.status(404).json({ error: "You do not supervise that class." });
  }
  if (!classRow.hodCanViewScripts) {
    return res.status(403).json({ error: "Script access is switched off for this class. Ask the teacher to enable it." });
  }
  await recordAudit({
    actorUserId: hod.id,
    actorRole: "HOD",
    action: "hod_script_view",
    classId: classRow.id,
    memberId: hod.id,
    memberType: "hod",
    detail: `HOD opened submission ${submission.id} (read-only).`,
  });
  // An HOD moderates the memo, not the marking: the teacher-only derived
  // expected answer and the marker's reasoning are stripped before the script
  // leaves the server.
  return res.json({ ...redactScriptForAudience(script), editable: false });
});

// Read-only submission index for one assignment. A learner's name is shown
// here (and on the script itself) only because this path is behind the
// teacher's script-access switch; no learner id is emitted.
async function submissionIndex(classId: string, assignmentId: string) {
  const rows = await db
    .select({
      id: submissionsTable.id,
      learnerName: learnersTable.fullName,
      score: submissionsTable.score,
      markingStatus: submissionsTable.markingStatus,
      submittedAt: submissionsTable.submittedAt,
    })
    .from(submissionsTable)
    .innerJoin(learnersTable, eq(learnersTable.id, submissionsTable.learnerId))
    .innerJoin(assignmentsTable, eq(assignmentsTable.id, submissionsTable.assignmentId))
    .where(and(eq(submissionsTable.assignmentId, assignmentId), eq(assignmentsTable.classId, classId)))
    .orderBy(desc(submissionsTable.submittedAt));
  return rows.map((row) => ({
    submissionId: row.id,
    learnerName: row.learnerName,
    score: row.score,
    markingStatus: row.markingStatus,
    submittedAt: row.submittedAt.toISOString(),
  }));
}

// HODs may read an assignment's memorandum for moderation (read-only). They
// never see a learner's script through this route, and the memo is the teacher's
// authored document, not learner data.
router.get("/hod/classes/:classId/assignments/:assignmentId/memo", async (req, res) => {
  const hod = await requireHod(req, res);
  if (!hod) return;
  const classRow = await classById(req.params.classId);
  if (!classRow || !(await hodSupervises(hod.id, classRow.id))) {
    return res.status(404).json({ error: "You do not supervise that class." });
  }
  const [assignment] = await db.select().from(assignmentsTable).where(and(eq(assignmentsTable.id, req.params.assignmentId), eq(assignmentsTable.classId, classRow.id))).limit(1);
  if (!assignment) return res.status(404).json({ error: "That assignment is not in this class." });
  const loaded = await loadMemo(assignment.id);
  await recordAudit({
    actorUserId: hod.id,
    actorRole: "HOD",
    action: "hod_script_view",
    classId: classRow.id,
    memberId: hod.id,
    memberType: "hod",
    detail: `HOD opened the memorandum for "${assignment.title}" (read-only moderation).`,
  });
  return res.json({
    assignmentId: assignment.id,
    title: assignment.title,
    memo: loaded ? {
      status: loaded.memo.status,
      source: loaded.memo.source,
      version: loaded.memo.version,
      confirmedAt: loaded.memo.confirmedAt?.toISOString() ?? null,
      items: loaded.items.map((item) => ({
        questionNumber: item.questionNumber,
        modelAnswer: item.modelAnswer,
        markingGuide: item.markingGuide,
        acceptableAlternatives: item.acceptableAlternatives,
      })),
    } : null,
  });
});


export default router;
