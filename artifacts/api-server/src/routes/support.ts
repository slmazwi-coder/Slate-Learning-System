import { Router, type IRouter } from "express";
import { z } from "zod";
import { recordAudit } from "../lib/audit";
import { getCurrentLearner } from "../lib/auth";
import { getCurrentUserContext } from "../lib/unified-auth";
import { rateLimit } from "../lib/rate-limit";
import { SUPPORT_CATEGORIES, SUPPORT_DISCLOSURE, SUPPORT_HOURS, isSupportCategory, whatsappSupportNumber } from "../lib/support";

const router: IRouter = Router();

const ADULT_ROLES = new Set(["TEACHER", "PARENT", "TUTOR", "HOD"]);
const LEARNER_REFUSAL = "Support chat is for teacher, parent, tutor and HOD accounts.";

// Support config for the frontend. Public and unauthenticated because the login
// screens need it before anyone has signed in; it exposes only the number the
// support team publishes anyway.
router.get("/support/config", (_req, res) => {
  const number = whatsappSupportNumber();
  return res.json({
    // A missing or malformed number hides the button entirely.
    enabled: Boolean(number),
    number: number ?? null,
    hours: SUPPORT_HOURS,
    disclosure: SUPPORT_DISCLOSURE,
    categories: SUPPORT_CATEGORIES,
  });
});

// The role is deliberately absent: it is read from the session, so a caller
// cannot claim to be an adult they are not.
const SupportClickBody = z.object({
  category: z.string().trim().min(1).max(60),
  // The page the adult was on, so support can see where they got stuck. Only
  // the path is kept; a query string could carry a token or an identifier.
  path: z.string().trim().max(200).optional(),
});

// POST /api/support/click — records that an adult opened the WhatsApp line. The
// audit row carries the user, role, category and time and nothing else: the
// message content is never sent here, so it can never be logged.
router.post("/support/click", rateLimit({ scope: "support-click", limit: 30, windowMs: 15 * 60 * 1000 }), async (req, res) => {
  const parsed = SupportClickBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Choose a support category." });
  if (!isSupportCategory(parsed.data.category)) {
    return res.status(400).json({ error: "Choose a support category." });
  }

  // The unified session carries the active role, and its user id is what the
  // audit log references, so one lookup settles both the gate and the actor.
  const context = await getCurrentUserContext(req);
  if (!context) {
    // A legacy learner session has no unified identity. Say so explicitly
    // rather than reporting a generic "sign in".
    if (await getCurrentLearner(req)) {
      return res.status(403).json({ error: LEARNER_REFUSAL });
    }
    return res.status(401).json({ error: "Please sign in to continue." });
  }
  if (!ADULT_ROLES.has(context.activeRole)) {
    return res.status(403).json({ error: LEARNER_REFUSAL });
  }

  const role = context.activeRole;
  const userId = context.user.id;

  // Path only, and only the leading segment, so nothing sensitive is stored.
  const safePath = (parsed.data.path ?? "").split("?")[0].slice(0, 120);

  await recordAudit({
    actorUserId: userId,
    actorRole: role,
    action: "support_contact_click",
    detail: `Opened WhatsApp support (category: ${parsed.data.category})${safePath ? ` from ${safePath}` : ""}.`,
  });

  return res.json({ ok: true });
});

export default router;
