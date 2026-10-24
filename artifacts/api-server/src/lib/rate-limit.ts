import type { NextFunction, Request, Response } from "express";

// In-memory sliding-window rate limiter for authentication routes. Limits are
// applied per client IP and per submitted username, so one attacker cannot
// exhaust an account's allowance from many IPs and one IP cannot spray many
// accounts. Messages never reveal whether an account exists.
type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

function hit(key: string, limit: number, windowMs: number): { limited: boolean; retryAfterSeconds: number } {
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { limited: false, retryAfterSeconds: 0 };
  }
  bucket.count += 1;
  if (bucket.count > limit) {
    return { limited: true, retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)) };
  }
  return { limited: false, retryAfterSeconds: 0 };
}

export function resetRateLimits() {
  buckets.clear();
}

export function clientIp(req: Request): string {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim()) return forwarded.split(",")[0].trim();
  return req.ip ?? req.socket.remoteAddress ?? "unknown";
}

export type RateLimitOptions = {
  // Requests allowed per window, per IP and per username.
  limit?: number;
  windowMs?: number;
  // Reads the submitted username/email from the body so the limit can be
  // applied per account as well as per IP.
  usernameField?: string;
  // Identifier for the route group, so different routes do not share a bucket.
  scope: string;
};

// A generic limiter. Every auth route should use it; the lockout message is
// deliberately identical for known and unknown accounts.
export function rateLimit(options: RateLimitOptions) {
  const limit = options.limit ?? 10;
  const windowMs = options.windowMs ?? 15 * 60 * 1000;
  const usernameField = options.usernameField ?? "username";
  return (req: Request, res: Response, next: NextFunction) => {
    const ip = clientIp(req);
    const raw = (req.body as Record<string, unknown> | undefined)?.[usernameField];
    const username = typeof raw === "string" ? raw.trim().toLowerCase() : "";
    const ipResult = hit(`${options.scope}:ip:${ip}`, limit, windowMs);
    const userResult = username ? hit(`${options.scope}:user:${username}`, limit, windowMs) : { limited: false, retryAfterSeconds: 0 };
    if (ipResult.limited || userResult.limited) {
      const retryAfter = Math.max(ipResult.retryAfterSeconds, userResult.retryAfterSeconds);
      res.setHeader("Retry-After", String(retryAfter));
      return res.status(429).json({
        error: "Too many attempts. Please wait a few minutes and try again.",
      });
    }
    return next();
  };
}
