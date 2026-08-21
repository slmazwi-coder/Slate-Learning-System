import { randomBytes } from "node:crypto";
import type { Request, Response } from "express";
import { and, eq, gt } from "drizzle-orm";
import { db } from "@workspace/db";
import { tutorsTable, tutorSessionsTable, type Tutor } from "@workspace/db/schema";
import { hashSessionToken } from "./auth";

const TUTOR_COOKIE = "slate_tutor_session";
const SESSION_TTL_DAYS = 30;

export async function createTutorSession(tutorId: string, res: Response) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);
  await db.insert(tutorSessionsTable).values({ tutorId, tokenHash: hashSessionToken(token), expiresAt });
  res.cookie(TUTOR_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    expires: expiresAt,
    path: "/",
  });
}

export async function destroyTutorSession(req: Request, res: Response) {
  const token = req.cookies?.[TUTOR_COOKIE];
  if (token) {
    await db.delete(tutorSessionsTable).where(eq(tutorSessionsTable.tokenHash, hashSessionToken(token)));
  }
  res.clearCookie(TUTOR_COOKIE, { path: "/" });
}

export async function getCurrentTutor(req: Request): Promise<Tutor | null> {
  const token = req.cookies?.[TUTOR_COOKIE];
  if (!token) return null;
  const [session] = await db
    .select({ tutorId: tutorSessionsTable.tutorId })
    .from(tutorSessionsTable)
    .where(and(eq(tutorSessionsTable.tokenHash, hashSessionToken(token)), gt(tutorSessionsTable.expiresAt, new Date())))
    .limit(1);
  if (!session) return null;
  const [tutor] = await db.select().from(tutorsTable).where(eq(tutorsTable.id, session.tutorId)).limit(1);
  return tutor ?? null;
}

export async function requireTutor(req: Request, res: Response) {
  const tutor = await getCurrentTutor(req);
  if (!tutor) {
    res.status(401).json({ error: "Please sign in to your tutor account to continue." });
    return null;
  }
  return tutor;
}

export function toPublicTutor(tutor: Tutor) {
  return {
    id: tutor.id,
    email: tutor.email,
    fullName: tutor.fullName,
    createdAt: tutor.createdAt.toISOString(),
  };
}

export { TUTOR_COOKIE };
