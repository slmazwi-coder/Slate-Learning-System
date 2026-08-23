import { Router, type IRouter } from "express";
import { z } from "zod";
import {
  getCurrentUserContext,
  requireUserContext,
  ROLES,
  switchSessionRole,
  toPublicUser,
  type Role,
} from "../lib/unified-auth";

const router: IRouter = Router();

const SwitchRoleBody = z.object({
  role: z.enum(["TEACHER", "PARENT", "TUTOR"]),
});

// Unified session probe for teachers / parents / tutors. Learner sessions
// continue to live under /auth/me on the learner router.
router.get("/auth/user", async (req, res) => {
  const context = await getCurrentUserContext(req);
  if (!context) return res.json({ user: null, roles: [] as string[], activeRole: null });
  return res.json({ user: toPublicUser(context.user), roles: context.user.roles, activeRole: context.activeRole });
});

// POST /api/auth/switch-role — sets the active role on the unified session.
router.post("/auth/switch-role", async (req, res) => {
  const context = await requireUserContext(req, res);
  if (!context) return;
  const parsed = SwitchRoleBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Choose one of Teacher, Parent or Tutor." });
  const role = parsed.data.role as Role;
  if (!context.user.roles.includes(role)) {
    return res.status(403).json({ error: `This account does not hold the ${role.toLowerCase()} role.` });
  }
  const switched = await switchSessionRole(req, role);
  if (!switched) return res.status(401).json({ error: "Please sign in to continue." });
  return res.json({ roles: context.user.roles, activeRole: role });
});

export default router;
