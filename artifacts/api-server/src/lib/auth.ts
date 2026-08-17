import { createHash, createHmac, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import type { Request, Response } from "express";
import { and, eq, gt } from "drizzle-orm";
import { db } from "@workspace/db";
import { authSessionsTable, learnersTable, type Learner } from "@workspace/db/schema";

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

function hashSessionToken(token: string) {
  return createHmac("sha256", sessionSecret()).update(token).digest("hex");
}

export async function createSession(learnerId: string, res: Response) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);
  await db.insert(authSessionsTable).values({
    learnerId,
    tokenHash: hashSessionToken(token),
    expiresAt,
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
    await db.delete(authSessionsTable).where(eq(authSessionsTable.tokenHash, hashSessionToken(token)));
  }
  res.clearCookie(SESSION_COOKIE, { path: "/" });
}

export async function getCurrentLearner(req: Request): Promise<Learner | null> {
  const token = req.cookies?.[SESSION_COOKIE];
  if (!token) return null;
  const [session] = await db
    .select({ learnerId: authSessionsTable.learnerId })
    .from(authSessionsTable)
    .where(and(eq(authSessionsTable.tokenHash, hashSessionToken(token)), gt(authSessionsTable.expiresAt, new Date())))
    .limit(1);
  if (!session) return null;
  const [learner] = await db.select().from(learnersTable).where(eq(learnersTable.id, session.learnerId)).limit(1);
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