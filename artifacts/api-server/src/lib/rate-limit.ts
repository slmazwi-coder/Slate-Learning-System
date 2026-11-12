import { createHash } from "node:crypto";
import type { Request } from "express";
import { pool } from "@workspace/db";

// PostgreSQL provides one atomic counter across serverless instances. Identifiers
// are hashed so the limiter does not retain raw email addresses or IPs.
export function clientIp(req: Request): string {
  return req.ip ?? req.socket.remoteAddress ?? "unknown";
}

export type RateLimitOptions = {
  limit?: number;
  windowMs?: number;
  usernameField?: string;
  scope: string;
};

export function rateLimit(options: RateLimitOptions) {
  const limit = options.limit ?? 10;
  const windowMs = options.windowMs ?? 15 * 60 * 1000;
  const usernameField = options.usernameField ?? "username";
  return async (req: Request, res: import("express").Response, next: import("express").NextFunction) => {
    try {
      const raw = (req.body as Record<string, unknown> | undefined)?.[usernameField];
      const username = typeof raw === "string" ? raw.trim().toLowerCase() : "";
      const keys = [`${options.scope}:ip:${clientIp(req)}`];
      if (username) keys.push(`${options.scope.endsWith("-login") ? "login" : options.scope}:user:${username}`);
      const hashes = keys.map((key) => createHash("sha256").update(key).digest("hex"));
      const { rows } = await pool.query<{ count: number; retry_seconds: number }>(`
        INSERT INTO slate_rate_limits (key, count, expires_at)
        SELECT key, 1, now() + ($2::bigint * interval '1 millisecond') FROM unnest($1::text[]) AS key
        ON CONFLICT (key) DO UPDATE SET
          count = CASE WHEN slate_rate_limits.expires_at <= now() THEN 1 ELSE slate_rate_limits.count + 1 END,
          expires_at = CASE WHEN slate_rate_limits.expires_at <= now() THEN now() + ($2::bigint * interval '1 millisecond') ELSE slate_rate_limits.expires_at END
        RETURNING count, GREATEST(1, CEIL(EXTRACT(EPOCH FROM (expires_at - now()))))::integer AS retry_seconds
      `, [hashes, windowMs]);
      if (Math.random() < 0.01) await pool.query("DELETE FROM slate_rate_limits WHERE expires_at < now()");
      const limited = rows.filter((row) => row.count > limit);
      if (limited.length) {
        res.setHeader("Retry-After", String(Math.max(...limited.map((row) => row.retry_seconds))));
        return res.status(429).json({ error: "Too many attempts. Please wait a few minutes and try again." });
      }
      return next();
    } catch (error) {
      // Fail closed if the shared limiter is unavailable.
      return next(error);
    }
  };
}
