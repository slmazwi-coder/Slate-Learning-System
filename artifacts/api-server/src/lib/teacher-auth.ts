import { randomBytes } from "node:crypto";
import type { Request, Response } from "express";
import { and, eq, gt } from "drizzle-orm";
import { db } from "@workspace/db";
import { teacherSessionsTable, teachersTable, type Teacher } from "@workspace/db/schema";
import { hashSessionToken } from "./auth";

const TEACHER_COOKIE = "slate_teacher_session";
const SESSION_TTL_DAYS = 30;

export async function createTeacherSession(teacherId: string, res: Response) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);
  await db.insert(teacherSessionsTable).values({ teacherId, tokenHash: hashSessionToken(token), expiresAt });
  res.cookie(TEACHER_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    expires: expiresAt,
    path: "/",
  });
}

export async function destroyTeacherSession(req: Request, res: Response) {
  const token = req.cookies?.[TEACHER_COOKIE];
  if (token) {
    await db.delete(teacherSessionsTable).where(eq(teacherSessionsTable.tokenHash, hashSessionToken(token)));
  }
  res.clearCookie(TEACHER_COOKIE, { path: "/" });
}

export async function getCurrentTeacher(req: Request): Promise<Teacher | null> {
  const token = req.cookies?.[TEACHER_COOKIE];
  if (!token) return null;
  const [session] = await db
    .select({ teacherId: teacherSessionsTable.teacherId })
    .from(teacherSessionsTable)
    .where(and(eq(teacherSessionsTable.tokenHash, hashSessionToken(token)), gt(teacherSessionsTable.expiresAt, new Date())))
    .limit(1);
  if (!session) return null;
  const [teacher] = await db.select().from(teachersTable).where(eq(teachersTable.id, session.teacherId)).limit(1);
  return teacher ?? null;
}

export async function requireTeacher(req: Request, res: Response) {
  const teacher = await getCurrentTeacher(req);
  if (!teacher) {
    res.status(401).json({ error: "Please sign in to your TIS account to continue." });
    return null;
  }
  return teacher;
}

export function toPublicTeacher(teacher: Teacher) {
  return {
    id: teacher.id,
    email: teacher.email,
    fullName: teacher.fullName,
    schoolName: teacher.schoolName,
    createdAt: teacher.createdAt.toISOString(),
  };
}

export { TEACHER_COOKIE };
