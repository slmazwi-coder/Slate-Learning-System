import { and, eq, gt, inArray } from "drizzle-orm";
import {
  assignmentsTable,
  classLearnersTable,
  classesTable,
  db,
  submissionsTable,
  type TeacherClass,
} from "@workspace/db";
import { generateDefaultSequence } from "./ai";
import { gradeName, presetForSubject } from "./presets";

// A class advances to the next topic in its sequence once its average reaches
// this mark; below it, Slate reissues the current topic as reinforcement.
const ADVANCE_THRESHOLD = 60;

async function classAverageScore(classId: string): Promise<number | null> {
  const classAssignments = await db
    .select({ id: assignmentsTable.id })
    .from(assignmentsTable)
    .where(eq(assignmentsTable.classId, classId));
  if (!classAssignments.length) return null;
  const rows = await db
    .select({ score: submissionsTable.score })
    .from(submissionsTable)
    .where(inArray(submissionsTable.assignmentId, classAssignments.map((row) => row.id)));
  if (!rows.length) return null;
  return Math.round(rows.reduce((total, row) => total + row.score, 0) / rows.length);
}

// Preset classes always carry their hardwired sequence; only fall back to
// Gemini when an older class (created before presets) has no sequence yet.
async function ensureLessonSequence(classRow: TeacherClass): Promise<string[]> {
  if (classRow.lessonSequence.length) return classRow.lessonSequence;
  const preset = classRow.presetSubject
    ? presetForSubject(classRow.presetSubject, classRow.grade)
    : null;
  if (preset) {
    await db.update(classesTable).set({ lessonSequence: preset.sequence }).where(eq(classesTable.id, classRow.id));
    return preset.sequence;
  }
  const sequence = await generateDefaultSequence({ grade: classRow.grade, subject: classRow.subject });
  await db.update(classesTable).set({ lessonSequence: sequence }).where(eq(classesTable.id, classRow.id));
  return sequence;
}

// Keeps an INDEPENDENT-mode class supplied with assignments: when nothing is
// open or upcoming, Slate generates the next assignment from the class lesson
// sequence, adjusting pace from the class average.
export async function ensureIndependentAssignmentsForClass(classRow: TeacherClass): Promise<void> {
  if (classRow.mode !== "INDEPENDENT") return;
  const [active] = await db
    .select({ id: assignmentsTable.id })
    .from(assignmentsTable)
    .where(and(eq(assignmentsTable.classId, classRow.id), gt(assignmentsTable.closeAt, new Date())))
    .limit(1);
  if (active) return;
  const sequence = await ensureLessonSequence(classRow);
  if (!sequence.length) return;
  const average = await classAverageScore(classRow.id);
  let index = Math.min(classRow.currentTopicIndex, sequence.length - 1);
  let reinforcement = false;
  if (average !== null) {
    if (average >= ADVANCE_THRESHOLD) {
      index = Math.min(index + 1, sequence.length - 1);
    } else {
      reinforcement = true;
    }
  }
  const topic = sequence[index];
  const now = Date.now();
  const windowDays = Math.min(30, Math.max(1, classRow.assignmentWindowDays || 7));
  const curriculumContext = [
    classRow.curriculumText
      ? `Curriculum (${classRow.curriculumFileName ?? "uploaded"}): ${classRow.curriculumText.slice(0, 300)}`
      : `${gradeName(classRow.grade)} South African ${classRow.subject} (CAPS): ${topic}.`,
    reinforcement && average !== null
      ? `The class average is ${average}%, below the ${ADVANCE_THRESHOLD}% pace threshold, so reinforce ${topic} with simpler scaffolding before moving on.`
      : `This is step ${index + 1} of ${sequence.length} in the class lesson sequence: ${topic}.`,
  ].filter(Boolean).join(" ").slice(0, 600);
  await db.insert(assignmentsTable).values({
    title: reinforcement ? `Reinforcement: ${topic}` : topic,
    subject: classRow.subject,
    topic,
    curriculumContext,
    openAt: new Date(now),
    closeAt: new Date(now + windowDays * 24 * 60 * 60 * 1000),
    questionCount: 5,
    classId: classRow.id,
  });
  if (index !== classRow.currentTopicIndex) {
    await db.update(classesTable).set({ currentTopicIndex: index }).where(eq(classesTable.id, classRow.id));
  }
}

export async function ensureIndependentAssignmentsForLearner(learnerId: string): Promise<void> {
  const rows = await db
    .select({ classRow: classesTable })
    .from(classLearnersTable)
    .innerJoin(classesTable, eq(classesTable.id, classLearnersTable.classId))
    .where(and(eq(classLearnersTable.learnerId, learnerId), eq(classesTable.mode, "INDEPENDENT")));
  for (const { classRow } of rows) {
    try {
      await ensureIndependentAssignmentsForClass(classRow);
    } catch {
      // Curriculum generation is best-effort; assignment listing must never fail.
    }
  }
}
