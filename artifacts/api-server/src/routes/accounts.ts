import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, learnersTable } from "@workspace/db";
import {
  getCurrentUserContext,
  requireUserContext,
  ROLES,
  switchSessionRole,
  toPublicUser,
  type Role,
} from "../lib/unified-auth";
import { listPresetCurricula } from "../lib/presets";
import { ATP_DEFAULT_YEAR, listAnnualTeachingPlans } from "../lib/atp";
import {
  ATP_INDEX_URL,
  latestPublishedYear,
  listCurriculumDirectives,
  reviewCurriculum,
} from "../lib/curriculum-directives";
import { requireHostAfricaAdmin } from "../lib/hostafrica";
import { searchLearners } from "../lib/slate-search";
import { CONSENT_SUMMARY, PRIVACY_NOTICE_VERSION } from "../lib/privacy";

const router: IRouter = Router();

const SwitchRoleBody = z.object({
  role: z.enum(["TEACHER", "PARENT", "TUTOR", "LEARNER", "HOD"]),
});

// Adult roles that may look up an existing learner to add to a class or link.
// HOD is deliberately absent: an HOD sees class-level data only and must never
// be able to look a learner up by name or SLATE ID.
const ADULT_ROLES: Role[] = ["TEACHER", "PARENT", "TUTOR"];

// Unified session probe for every role. Learners keep their username session
// under /auth/me, and also appear here when their profile carries an email.
router.get("/auth/user", async (req, res) => {
  const context = await getCurrentUserContext(req);
  if (!context) return res.json({ user: null, roles: [] as string[], activeRole: null, learnerId: null });
  const [learner] = await db
    .select({ id: learnersTable.id })
    .from(learnersTable)
    .where(eq(learnersTable.userId, context.user.id))
    .limit(1);
  return res.json({
    user: toPublicUser(context.user),
    roles: context.user.roles,
    activeRole: context.activeRole,
    learnerId: learner?.id ?? null,
  });
});

// POST /api/auth/switch-role — sets the active role on the unified session.
router.post("/auth/switch-role", async (req, res) => {
  const context = await requireUserContext(req, res);
  if (!context) return;
  const parsed = SwitchRoleBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Choose one of Teacher, Parent, Tutor, HOD or Learner." });
  const role = parsed.data.role as Role;
  if (!context.user.roles.includes(role)) {
    return res.status(403).json({ error: `This account does not hold the ${role.toLowerCase()} role.` });
  }
  const switched = await switchSessionRole(req, role);
  if (!switched) return res.status(401).json({ error: "Please sign in to continue." });
  return res.json({ roles: context.user.roles, activeRole: role });
});

// Hardwired preset curriculum catalog. Class creation only accepts subjects
// listed here — the dropdown in the create-class UIs is fed by this endpoint.
router.get("/curriculum/presets", async (req, res) => {
  return res.json({ presets: await listPresetCurricula() });
});

// Annual Teaching Plans: the departmental yearly directives that override the
// CAPS-derived sequence for a subject+grade. Public (no auth) because the same
// catalog feeds the class-creation dropdowns and the learner-facing syllabus.
router.get("/curriculum/atp", async (req, res) => {
  const year = typeof req.query.year === "string" ? req.query.year : undefined;
  return res.json({ year: year ?? ATP_DEFAULT_YEAR, plans: await listAnnualTeachingPlans(year) });
});

// Departmental curriculum directives, one row per teaching year. Public because
// the plan in force for a class is not sensitive; it tells a user which circular
// the syllabus they are following comes from.
router.get("/curriculum/directives", async (_req, res) => {
  return res.json({ directives: await listCurriculumDirectives(), atpIndexUrl: ATP_INDEX_URL });
});

// Operator view: compares the directives on record against the plans actually
// loaded, so a departmental update shows up as a review item (a stale plan or a
// named subject with nothing loaded) instead of as silent drift. Platform-admin
// only, since it is an operational report rather than product data.
router.get("/curriculum/review", async (req, res) => {
  const context = await requireHostAfricaAdmin(req, res);
  if (!context) return;
  const year = typeof req.query.year === "string" ? req.query.year : latestPublishedYear();
  return res.json({ review: reviewCurriculum(year), directives: await listCurriculumDirectives() });
});

// POPIA privacy notice. Public (no auth): linked from every registration screen
// and shown in the consent step when an adult creates a child account.
router.get("/privacy-notice", async (_req, res) => {
  return res.json({
    version: PRIVACY_NOTICE_VERSION,
    consentSummary: CONSENT_SUMMARY,
    stored: [
      "Name",
      "Grade",
      "School",
      "Date of birth",
      "Gender",
      "Home language",
      "Answers to assignments and activities",
      "Learning profile (detected learning style, confidence and active concept gaps)",
    ],
    externalProcessing:
      "Answers and any files uploaded for the learner are processed by an external AI service (Google Gemini) to generate questions, mark answers and produce feedback.",
    rights:
      "A parent or guardian may export the child's data as JSON or delete the child's account and all linked data at any time from the parent dashboard.",
  });
});

// Shared SLATE ID / name lookup for teachers, parents and tutors. A SLATE ID
// returns at most one learner; a name returns every match, each carrying its
// SLATE ID so namesakes can be told apart.
router.get("/learners/search", async (req, res) => {
  const context = await getCurrentUserContext(req);
  if (!context || !context.user.roles.some((role) => ADULT_ROLES.includes(role as Role))) {
    return res.status(403).json({ error: "Only teachers, parents and tutors can search for learners." });
  }
  const query = typeof req.query.q === "string" ? req.query.q : "";
  return res.json({ learners: await searchLearners(query) });
});

export default router;
