import { randomBytes } from "node:crypto";
import type { Request, Response } from "express";
import { and, eq, gt } from "drizzle-orm";
import { db } from "@workspace/db";
import { usersTable, userSessionsTable, type User } from "@workspace/db/schema";
import { hashPassword, hashSessionToken, verifyPassword } from "./auth";

export const USER_COOKIE = "slate_user_session";
const SESSION_TTL_DAYS = 30;

export type Role = "TEACHER" | "PARENT" | "TUTOR";
export const ROLES: Role[] = ["TEACHER", "PARENT", "TUTOR"];

export type SessionContext = { user: User; activeRole: Role };

// One email, one password, one account. If the email already exists, the
// password must match before a new role is added to the account.
export async function createOrMergeUser(input: {
  email: string;
  password: string;
  fullName: string;
  role: Role;
}): Promise<{ user: User; existed: boolean } | { error: string }> {
  const email = input.email.trim().toLowerCase();
  const [existing] = await db.select().from(usersTable).where(eq(usersTable.email, email)).limit(1);
  if (existing) {
    const ok = await verifyPassword(input.password, existing.passwordHash);
    if (!ok) return { error: "That email is already registered. Sign in with your existing password to add a new role." };
    if (!existing.roles.includes(input.role)) {
      const merged = Array.from(new Set([...existing.roles, input.role]));
      const [updated] = await db.update(usersTable).set({ roles: merged }).where(eq(usersTable.id, existing.id)).returning();
      return { user: updated ?? existing, existed: true };
    }
    return { user: existing, existed: true };
  }
  const [user] = await db
    .insert(usersTable)
    .values({ email, passwordHash: await hashPassword(input.password), fullName: input.fullName.trim(), roles: [input.role] })
    .returning();
  return { user, existed: false };
}

export async function verifyUserLogin(email: string, password: string): Promise<User | null> {
  const [user] = await db.select().from(usersTable).where(eq(usersTable.email, email.trim().toLowerCase())).limit(1);
  if (!user) return null;
  return (await verifyPassword(password, user.passwordHash)) ? user : null;
}

export async function createUserSession(userId: string, activeRole: Role, res: Response) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);
  await db.insert(userSessionsTable).values({ userId, tokenHash: hashSessionToken(token), activeRole, expiresAt });
  res.cookie(USER_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    expires: expiresAt,
    path: "/",
  });
}

export async function destroyUserSession(req: Request, res: Response) {
  const token = req.cookies?.[USER_COOKIE];
  if (token) {
    await db.delete(userSessionsTable).where(eq(userSessionsTable.tokenHash, hashSessionToken(token)));
  }
  res.clearCookie(USER_COOKIE, { path: "/" });
}

export async function getCurrentUserContext(req: Request): Promise<SessionContext | null> {
  const token = req.cookies?.[USER_COOKIE];
  if (!token) return null;
  const [session] = await db
    .select()
    .from(userSessionsTable)
    .where(and(eq(userSessionsTable.tokenHash, hashSessionToken(token)), gt(userSessionsTable.expiresAt, new Date())))
    .limit(1);
  if (!session) return null;
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, session.userId)).limit(1);
  if (!user) return null;
  const activeRole = (user.roles.includes(session.activeRole) ? session.activeRole : user.roles[0]) as Role;
  return { user, activeRole };
}

export async function switchSessionRole(req: Request, role: Role): Promise<boolean> {
  const token = req.cookies?.[USER_COOKIE];
  if (!token) return false;
  const result = await db
    .update(userSessionsTable)
    .set({ activeRole: role })
    .where(eq(userSessionsTable.tokenHash, hashSessionToken(token)))
    .returning({ id: userSessionsTable.id });
  return result.length > 0;
}

export async function requireUserContext(req: Request, res: Response): Promise<SessionContext | null> {
  const context = await getCurrentUserContext(req);
  if (!context) {
    res.status(401).json({ error: "Please sign in to continue." });
    return null;
  }
  return context;
}

export function toPublicUser(user: User) {
  return {
    id: user.id,
    email: user.email,
    fullName: user.fullName,
    roles: user.roles,
    createdAt: user.createdAt.toISOString(),
  };
}
