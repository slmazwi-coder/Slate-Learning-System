import { createHash, createHmac, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import type { Request, Response } from "express";
import { and, eq, gt, isNull, lte } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  authSessionsTable,
  learnerSessionActivityTable,
  learnersTable,
  type Learner,
} from "@workspace/db/schema";

const scrypt = promisify(scryptCallback);
const SESSION_COOKIE = "slate_session";
const SESSION_TTL_DAYS = 30;

function sessionSecret() {
  const value = process.env.SESSION_SECRET;
  if (!value) throw new Error("SESSION_SECRET must be configured");
  return value;
}

export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const derived = (await scrypt(password, salt, 64)) as Buffer;
  return `${salt}:${derived.toString("hex")}`;
}

export async function verifyPassword(password: string, encoded: string) {
  const [salt, stored] = encoded.split(":");
  if (!salt || !stored) return false;
  const derived = (await scrypt(password, salt, 64)) as Buffer;
  const storedBuffer = Buffer.from(stored, "hex");
  return storedBuffer.length === derived.length && timingSafeEqual(storedBuffer, derived);
}

export function hashSessionToken(token: string) {
  return createHmac("sha256", sessionSecret()).update(token).digest("hex");
}

function minutesBetween(start: Date, end: Date) {
  return Math.max(0, Math.floor((end.getTime() - start.getTime()) / 60_000));
}

export async function createSession(learnerId: string, res: Response) {
  const token = randomBytes(32).toString("base64url");
  const loginAt = new Date();
  const expiresAt = new Date(loginAt.getTime() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);
  const [session] = await db.insert(authSessionsTable).values({
    learnerId,
    tokenHash: hashSessionToken(token),
    expiresAt,
  }).returning({ id: authSessionsTable.id, createdAt: authSessionsTable.createdAt });
  await db.insert(learnerSessionActivityTable).values({
    learnerId,
    authSessionId: session.id,
    loginAt: session.createdAt ?? loginAt,
  });
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    expires: expiresAt,
    path: "/",
  });
}

export async function destroySession(req: Request, res: Response) {
  const token = req.cookies?.[SESSION_COOKIE];
  if (token) {
    const [session] = await db
      .select({
        id: authSessionsTable.id,
        expiresAt: authSessionsTable.expiresAt,
      })
      .from(authSessionsTable)
      .where(eq(authSessionsTable.tokenHash, hashSessionToken(token)))
      .limit(1);
    if (session) {
      const [activity] = await db
        .select({ id: learnerSessionActivityTable.id, loginAt: learnerSessionActivityTable.loginAt })
        .from(learnerSessionActivityTable)
        .where(eq(learnerSessionActivityTable.authSessionId, session.id))
        .limit(1);
      if (activity) {
        const logoutAt = new Date(Math.min(Date.now(), session.expiresAt.getTime()));
        await db
          .update(learnerSessionActivityTable)
          .set({ logoutAt, durationMinutes: minutesBetween(activity.loginAt, logoutAt) })
          .where(and(eq(learnerSessionActivityTable.id, activity.id), isNull(learnerSessionActivityTable.logoutAt)));
      }
      await db.delete(authSessionsTable).where(eq(authSessionsTable.id, session.id));
    }
  }
  res.clearCookie(SESSION_COOKIE, { path: "/" });
}

export async function closeExpiredLearnerSessions(learnerId?: string) {
  const now = new Date();
  const conditions = [
    isNull(learnerSessionActivityTable.logoutAt),
    lte(authSessionsTable.expiresAt, now),
  ];
  if (learnerId) conditions.push(eq(learnerSessionActivityTable.learnerId, learnerId));
  const expired = await db
    .select({
      activityId: learnerSessionActivityTable.id,
      loginAt: learnerSessionActivityTable.loginAt,
      expiresAt: authSessionsTable.expiresAt,
    })
    .from(learnerSessionActivityTable)
    .innerJoin(authSessionsTable, eq(authSessionsTable.id, learnerSessionActivityTable.authSessionId))
    .where(and(...conditions));
  for (const session of expired) {
    await db
      .update(learnerSessionActivityTable)
      .set({
        logoutAt: session.expiresAt,
        durationMinutes: minutesBetween(session.loginAt, session.expiresAt),
      })
      .where(and(
        eq(learnerSessionActivityTable.id, session.activityId),
        isNull(learnerSessionActivityTable.logoutAt),
      ));
  }
}

export async function revokeLearnerSessions(learnerId: string) {
  const logoutAt = new Date();
  const openActivities = await db
    .select({ id: learnerSessionActivityTable.id, loginAt: learnerSessionActivityTable.loginAt })
    .from(learnerSessionActivityTable)
    .where(and(
      eq(learnerSessionActivityTable.learnerId, learnerId),
      isNull(learnerSessionActivityTable.logoutAt),
    ));
  for (const activity of openActivities) {
    await db
      .update(learnerSessionActivityTable)
      .set({ logoutAt, durationMinutes: minutesBetween(activity.loginAt, logoutAt) })
      .where(and(eq(learnerSessionActivityTable.id, activity.id), isNull(learnerSessionActivityTable.logoutAt)));
  }
  await db.delete(authSessionsTable).where(eq(authSessionsTable.learnerId, learnerId));
}

export async function getCurrentLearner(req: Request): Promise<Learner | null> {
  const token = req.cookies?.[SESSION_COOKIE];
  if (!token) return await learnerFromUnifiedSession(req);
  const [session] = await db
    .select({ learnerId: authSessionsTable.learnerId })
    .from(authSessionsTable)
    .where(and(eq(authSessionsTable.tokenHash, hashSessionToken(token)), gt(authSessionsTable.expiresAt, new Date())))
    .limit(1);
  if (!session) {
    const [expired] = await db
      .select({ learnerId: authSessionsTable.learnerId })
      .from(authSessionsTable)
      .where(eq(authSessionsTable.tokenHash, hashSessionToken(token)))
      .limit(1);
    if (expired) await closeExpiredLearnerSessions(expired.learnerId);
    return await learnerFromUnifiedSession(req);
  }
  const [learner] = await db.select().from(learnersTable).where(eq(learnersTable.id, session.learnerId)).limit(1);
  return learner ?? null;
}

// A unified account holding the LEARNER role can reach the learner app by
// switching roles, without a separate username login.
async function learnerFromUnifiedSession(req: Request): Promise<Learner | null> {
  // Imported lazily: unified-auth depends on this module's password helpers.
  const { getCurrentUserContext } = await import("./unified-auth");
  const context = await getCurrentUserContext(req);
  if (!context || context.activeRole !== "LEARNER") return null;
  const [learner] = await db.select().from(learnersTable).where(eq(learnersTable.userId, context.user.id)).limit(1);
  return learner ?? null;
}

export async function requireLearner(req: Request, res: Response) {
  const learner = await getCurrentLearner(req);
  if (!learner) {
    res.status(401).json({ error: "Please sign in to continue." });
    return null;
  }
  return learner;
}

export function toPublicLearner(learner: Learner) {
  return {
    id: learner.id,
    username: learner.username,
    fullName: learner.fullName,
    grade: learner.grade,
    schoolName: learner.schoolName,
    subjects: learner.subjects,
    createdAt: learner.createdAt.toISOString(),
  };
}

export { SESSION_COOKIE };