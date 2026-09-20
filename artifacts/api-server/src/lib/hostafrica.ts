import type { Request, Response } from "express";
import {
  HostAfricaClient,
  HostAfricaError,
  isHostAfricaConfigured,
} from "@workspace/hostafrica";
import { logger } from "./logger";
import { requireUserContext, type SessionContext } from "./unified-auth";

// HostAfrica account management is a platform-operator concern, not a
// teacher/parent/tutor role: only signed-in users whose email appears in
// HOSTAFRICA_ADMIN_EMAILS (comma-separated) may reach these routes.
function adminEmails(): Set<string> {
  return new Set(
    (process.env.HOSTAFRICA_ADMIN_EMAILS ?? "")
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  );
}

export async function requireHostAfricaAdmin(
  req: Request,
  res: Response,
): Promise<SessionContext | null> {
  const context = await requireUserContext(req, res);
  if (!context) return null;
  if (!adminEmails().has(context.user.email.toLowerCase())) {
    res
      .status(403)
      .json({
        error:
          "HostAfrica management is restricted to platform administrators.",
      });
    return null;
  }
  if (!isHostAfricaConfigured()) {
    res
      .status(503)
      .json({
        error: "HostAfrica integration is not configured on this server.",
      });
    return null;
  }
  return context;
}

let cachedClient: HostAfricaClient | null = null;
export function hostAfricaClient(): HostAfricaClient {
  if (!cachedClient) cachedClient = new HostAfricaClient();
  return cachedClient;
}

// Upstream 4xx errors are the caller's problem (bad record, unknown zone) and
// are relayed with the HostAfrica message; anything else becomes a 502.
export function sendHostAfricaError(
  res: Response,
  err: unknown,
  action: string,
) {
  if (err instanceof HostAfricaError) {
    const upstream = err.httpStatus;
    const relay =
      upstream !== null &&
      upstream >= 400 &&
      upstream < 500 &&
      upstream !== 401;
    logger.warn(
      { endpoint: err.endpoint, upstream, action },
      "HostAfrica request failed",
    );
    return res.status(relay ? upstream : 502).json({ error: err.message });
  }
  logger.error({ err, action }, "HostAfrica request crashed");
  return res
    .status(502)
    .json({ error: "HostAfrica is unavailable right now." });
}
