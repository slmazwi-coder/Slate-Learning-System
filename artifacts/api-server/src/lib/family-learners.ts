import { randomBytes } from "node:crypto";
import { and, eq } from "drizzle-orm";
import {
  classLearnersTable,
  classesTable,
  db,
  learningProfilesTable,
  learnersTable,
  type Learner,
  type TeacherClass,
} from "@workspace/db";
import { hashPassword } from "./auth";
import { serializeClassesWithCounts } from "./class-views";

// Parents and tutors create learner accounts for their children/students; the
// credentials are returned once so the adult can hand them to the learner.
export function generateLearnerPassword() {
  return `slate-${randomBytes(4).toString("hex")}`;
}

async function generateUsername(fullName: string) {
  const base = fullName.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 12) || "learner";
  for (let attempt = 0; attempt < 10; attempt++) {
    const candidate = `${base}-${randomBytes(2).toString("hex")}`;
    const [existing] = await db.select({ id: learnersTable.id }).from(learnersTable).where(eq(learnersTable.username, candidate)).limit(1);
    if (!existing) return candidate;
  }
  return `${base}-${randomBytes(4).toString("hex")}`;
}

type OwnerKind = "parent" | "tutor";

function generateJoinCode() {
  return randomBytes(4).toString("hex").toUpperCase().slice(0, 6);
}

async function classesForOwner(kind: OwnerKind, ownerId: string) {
  const condition = kind === "parent" ? eq(classesTable.parentId, ownerId) : eq(classesTable.tutorId, ownerId);
  const rows = await db.select().from(classesTable).where(condition);
  return serializeClassesWithCounts(rows);
}

// Finds (or creates) the owner's class for a grade+subject pair and moves the
// learner's membership for that subject into it.
async function enrollInOwnerClass(kind: OwnerKind, ownerId: string, learnerId: string, grade: number, subject: string, windowDays: number, schoolName: string) {
  const ownerFilter = kind === "parent" ? eq(classesTable.parentId, ownerId) : eq(classesTable.tutorId, ownerId);
  const [existing] = await db
    .select()
    .from(classesTable)
    .where(and(ownerFilter, eq(classesTable.grade, grade), eq(classesTable.section, ""), eq(classesTable.subject, subject)))
    .limit(1);
  let classRow = existing;
  if (!classRow) {
    const [created] = await db
      .insert(classesTable)
      .values({
        ownerType: kind,
        parentId: kind === "parent" ? ownerId : null,
        tutorId: kind === "tutor" ? ownerId : null,
        grade,
        section: "",
        subject,
        schoolName,
        joinCode: generateJoinCode(),
        mode: "INDEPENDENT",
        assignmentWindowDays: windowDays,
      })
      .returning();
    classRow = created;
  }
  await db.delete(classLearnersTable).where(and(eq(classLearnersTable.learnerId, learnerId), eq(classLearnersTable.subject, subject)));
  await db.insert(classLearnersTable).values({ classId: classRow.id, learnerId, subject });
  return classRow;
}

export async function createFamilyLearner(input: {
  kind: OwnerKind;
  ownerId: string;
  fullName: string;
  grade: number;
  subjects: string[];
  assignmentWindowDays?: number;
}) {
  const username = await generateUsername(input.fullName);
  const password = generateLearnerPassword();
  const schoolName = input.kind === "parent" ? "Home" : "Tutoring";
  const [learner] = await db
    .insert(learnersTable)
    .values({
      username,
      passwordHash: await hashPassword(password),
      fullName: input.fullName.trim(),
      grade: input.grade,
      schoolName,
      subjects: input.subjects,
      parentId: input.kind === "parent" ? input.ownerId : null,
      tutorId: input.kind === "tutor" ? input.ownerId : null,
    })
    .returning();
  await db.insert(learningProfilesTable).values({ learnerId: learner.id });
  const windowDays = input.assignmentWindowDays ?? 7;
  const classes: TeacherClass[] = [];
  for (const subject of input.subjects) {
    classes.push(await enrollInOwnerClass(input.kind, input.ownerId, learner.id, input.grade, subject, windowDays, schoolName));
  }
  return {
    learner: publicFamilyLearner(learner),
    credentials: { username, password },
    classes: await classesForOwner(input.kind, input.ownerId),
  };
}

export async function updateFamilyLearner(input: {
  kind: OwnerKind;
  ownerId: string;
  learner: Learner;
  grade?: number;
  subjects?: string[];
  assignmentWindowDays?: number;
}) {
  const nextSubjects = input.subjects ?? input.learner.subjects;
  const nextGrade = input.grade ?? input.learner.grade;
  const removedSubjects = input.learner.subjects.filter((subject) => !nextSubjects.includes(subject));
  for (const subject of removedSubjects) {
    await db.delete(classLearnersTable).where(and(eq(classLearnersTable.learnerId, input.learner.id), eq(classLearnersTable.subject, subject)));
  }
  if (input.assignmentWindowDays !== undefined) {
    const ownerFilter = input.kind === "parent" ? eq(classesTable.parentId, input.ownerId) : eq(classesTable.tutorId, input.ownerId);
    const memberships = await db
      .select({ classId: classLearnersTable.classId })
      .from(classLearnersTable)
      .innerJoin(classesTable, and(eq(classesTable.id, classLearnersTable.classId), ownerFilter))
      .where(eq(classLearnersTable.learnerId, input.learner.id));
    for (const membership of memberships) {
      await db.update(classesTable).set({ assignmentWindowDays: input.assignmentWindowDays }).where(eq(classesTable.id, membership.classId));
    }
  }
  if (input.subjects !== undefined || input.grade !== undefined) {
    const schoolName = input.learner.schoolName;
    for (const subject of nextSubjects) {
      await enrollInOwnerClass(input.kind, input.ownerId, input.learner.id, nextGrade, subject, input.assignmentWindowDays ?? 7, schoolName);
    }
  }
  const [updated] = await db
    .update(learnersTable)
    .set({ grade: nextGrade, subjects: nextSubjects })
    .where(eq(learnersTable.id, input.learner.id))
    .returning();
  return {
    learner: publicFamilyLearner(updated),
    classes: await classesForOwner(input.kind, input.ownerId),
  };
}

export function publicFamilyLearner(learner: Learner) {
  return {
    id: learner.id,
    username: learner.username,
    fullName: learner.fullName,
    grade: learner.grade,
    schoolName: learner.schoolName,
    subjects: learner.subjects,
    parentId: learner.parentId,
    tutorId: learner.tutorId,
    createdAt: learner.createdAt.toISOString(),
  };
}

export { classesForOwner };
