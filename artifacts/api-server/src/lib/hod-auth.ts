import type { Request, Response } from "express";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@workspace/db";
import { classHodsTable, classesTable, type TeacherClass, type User } from "@workspace/db/schema";
import { createUserSession, destroyUserSession, getCurrentUserContext } from "./unified-auth";

export const HOD_COOKIE = "slate_user_session";

// An HOD has no profile table of its own: the identity IS the unified account,
// because the supervisory role carries no data beyond the class memberships in
// slate_class_hods. That keeps the HOD out of the legacy per-role tables while
// still giving them one account, one password and a role switcher entry.
export async function createHodSession(userId: string, res: Response) {
  await createUserSession(userId, "HOD", res);
}

export async function destroyHodSession(req: Request, res: Response) {
  await destroyUserSession(req, res);
}

// The unified user behind the current HOD session, or null. Returns the raw
// user so callers can read roles without a second lookup.
export async function getCurrentHod(req: Request): Promise<User | null> {
  const context = await getCurrentUserContext(req);
  if (!context || context.activeRole !== "HOD") return null;
  return context.user;
}

export async function requireHod(req: Request, res: Response): Promise<User | null> {
  const hod = await getCurrentHod(req);
  if (!hod) {
    res.status(401).json({ error: "Please sign in to your HOD account to continue." });
    return null;
  }
  return hod;
}

// The class ids an HOD currently supervises: joined and not since left or
// removed. Every HOD route resolves membership through this, so a client can
// never widen its own scope by supplying a classId.
export async function hodClassIds(hodUserId: string): Promise<string[]> {
  const rows = await db
    .select({ classId: classHodsTable.classId })
    .from(classHodsTable)
    .where(and(
      eq(classHodsTable.hodUserId, hodUserId),
      isNull(classHodsTable.leftAt),
      isNull(classHodsTable.removedAt),
    ));
  return rows.map((row) => row.classId);
}

export async function hodClasses(hodUserId: string): Promise<TeacherClass[]> {
  const ids = await hodClassIds(hodUserId);
  if (!ids.length) return [];
  return db.select().from(classesTable).where(inArray(classesTable.id, ids));
}

// Membership check for a single class. Server-side, always: an HOD route must
// never trust a client-supplied classId.
export async function hodSupervises(hodUserId: string, classId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: classHodsTable.id })
    .from(classHodsTable)
    .where(and(
      eq(classHodsTable.classId, classId),
      eq(classHodsTable.hodUserId, hodUserId),
      isNull(classHodsTable.leftAt),
      isNull(classHodsTable.removedAt),
    ))
    .limit(1);
  return Boolean(row);
}

export function toPublicHod(user: User) {
  return {
    id: user.id,
    email: user.email,
    fullName: user.fullName,
    roles: user.roles,
    createdAt: user.createdAt.toISOString(),
  };
}
