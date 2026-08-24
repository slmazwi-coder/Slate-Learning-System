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

const router: IRouter = Router();

const SwitchRoleBody = z.object({
  role: z.enum(["TEACHER", "PARENT", "TUTOR", "LEARNER"]),
});

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
  if (!parsed.success) return res.status(400).json({ error: "Choose one of Teacher, Parent, Tutor or Learner." });
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

export default router;
