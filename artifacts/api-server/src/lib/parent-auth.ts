import type { Request, Response } from "express";
import { eq } from "drizzle-orm";
import { db } from "@workspace/db";
import { parentsTable, type Parent } from "@workspace/db/schema";
import { createUserSession, destroyUserSession, getCurrentUserContext } from "./unified-auth";

export const PARENT_COOKIE = "slate_user_session";

export async function parentProfileForUser(userId: string): Promise<Parent | null> {
  const [parent] = await db.select().from(parentsTable).where(eq(parentsTable.userId, userId)).limit(1);
  return parent ?? null;
}

export async function createParentSession(parentId: string, res: Response) {
  const [parent] = await db.select().from(parentsTable).where(eq(parentsTable.id, parentId)).limit(1);
  if (parent?.userId) {
    await createUserSession(parent.userId, "PARENT", res);
  }
}

export async function destroyParentSession(req: Request, res: Response) {
  await destroyUserSession(req, res);
}

export async function getCurrentParent(req: Request): Promise<Parent | null> {
  const context = await getCurrentUserContext(req);
  if (!context || context.activeRole !== "PARENT") return null;
  return parentProfileForUser(context.user.id);
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
