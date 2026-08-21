import type { Request, Response } from "express";
import { eq } from "drizzle-orm";
import { db } from "@workspace/db";
import { tutorsTable, type Tutor } from "@workspace/db/schema";
import { createUserSession, destroyUserSession, getCurrentUserContext } from "./unified-auth";

export const TUTOR_COOKIE = "slate_user_session";

export async function tutorProfileForUser(userId: string): Promise<Tutor | null> {
  const [tutor] = await db.select().from(tutorsTable).where(eq(tutorsTable.userId, userId)).limit(1);
  return tutor ?? null;
}

export async function createTutorSession(tutorId: string, res: Response) {
  const [tutor] = await db.select().from(tutorsTable).where(eq(tutorsTable.id, tutorId)).limit(1);
  if (tutor?.userId) {
    await createUserSession(tutor.userId, "TUTOR", res);
  }
}

export async function destroyTutorSession(req: Request, res: Response) {
  await destroyUserSession(req, res);
}

export async function getCurrentTutor(req: Request): Promise<Tutor | null> {
  const context = await getCurrentUserContext(req);
  if (!context || context.activeRole !== "TUTOR") return null;
  return tutorProfileForUser(context.user.id);
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
