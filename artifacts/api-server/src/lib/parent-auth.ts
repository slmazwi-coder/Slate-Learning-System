import { randomBytes } from "node:crypto";
import type { Request, Response } from "express";
import { and, eq, gt } from "drizzle-orm";
import { db } from "@workspace/db";
import { parentsTable, parentSessionsTable, type Parent } from "@workspace/db/schema";
import { hashSessionToken } from "./auth";

const PARENT_COOKIE = "slate_parent_session";
const SESSION_TTL_DAYS = 30;

export async function createParentSession(parentId: string, res: Response) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);
  await db.insert(parentSessionsTable).values({ parentId, tokenHash: hashSessionToken(token), expiresAt });
  res.cookie(PARENT_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    expires: expiresAt,
    path: "/",
  });
}

export async function destroyParentSession(req: Request, res: Response) {
  const token = req.cookies?.[PARENT_COOKIE];
  if (token) {
    await db.delete(parentSessionsTable).where(eq(parentSessionsTable.tokenHash, hashSessionToken(token)));
  }
  res.clearCookie(PARENT_COOKIE, { path: "/" });
}

export async function getCurrentParent(req: Request): Promise<Parent | null> {
  const token = req.cookies?.[PARENT_COOKIE];
  if (!token) return null;
  const [session] = await db
    .select({ parentId: parentSessionsTable.parentId })
    .from(parentSessionsTable)
    .where(and(eq(parentSessionsTable.tokenHash, hashSessionToken(token)), gt(parentSessionsTable.expiresAt, new Date())))
    .limit(1);
  if (!session) return null;
  const [parent] = await db.select().from(parentsTable).where(eq(parentsTable.id, session.parentId)).limit(1);
  return parent ?? null;
}

export async function requireParent(req: Request, res: Response) {
  const parent = await getCurrentParent(req);
  if (!parent) {
    res.status(401).json({ error: "Please sign in to your parent account to continue." });
    return null;
  }
  return parent;
}

export function toPublicParent(parent: Parent) {
  return {
    id: parent.id,
    email: parent.email,
    fullName: parent.fullName,
    createdAt: parent.createdAt.toISOString(),
  };
}

export { PARENT_COOKIE };
