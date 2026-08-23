import type { Request, Response } from "express";
import { eq } from "drizzle-orm";
import { db } from "@workspace/db";
import { teachersTable, type Teacher } from "@workspace/db/schema";
import { createUserSession, destroyUserSession, getCurrentUserContext } from "./unified-auth";

export const TEACHER_COOKIE = "slate_user_session";

export async function teacherProfileForUser(userId: string): Promise<Teacher | null> {
  const [teacher] = await db.select().from(teachersTable).where(eq(teachersTable.userId, userId)).limit(1);
  return teacher ?? null;
}

export async function createTeacherSession(teacherId: string, res: Response) {
  const [teacher] = await db.select().from(teachersTable).where(eq(teachersTable.id, teacherId)).limit(1);
  if (teacher?.userId) {
    await createUserSession(teacher.userId, "TEACHER", res);
  }
}

export async function destroyTeacherSession(req: Request, res: Response) {
  await destroyUserSession(req, res);
}

export async function getCurrentTeacher(req: Request): Promise<Teacher | null> {
  const context = await getCurrentUserContext(req);
  if (!context || context.activeRole !== "TEACHER") return null;
  return teacherProfileForUser(context.user.id);
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
