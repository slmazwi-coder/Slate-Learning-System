import { inArray } from "drizzle-orm";
import { classLearnersTable, classesTable, db, type TeacherClass } from "@workspace/db";
import {
  assignmentProgressWithStarts,
  classGapAlert,
  classLabel,
  conceptStats,
  learnerDrillDown,
  learnerRows,
  loadClassData,
  performanceSeries,
} from "./class-insights";

export function serializeClass(row: TeacherClass, learnerCount = 0) {
  return {
    id: row.id,
    grade: row.grade,
    section: row.section,
    subject: row.subject,
    schoolName: row.schoolName,
    joinCode: row.joinCode,
    label: classLabel(row),
    learnerCount,
    ownerType: row.ownerType,
    mode: row.mode,
    curriculumFileName: row.curriculumFileName,
    hasCurriculum: Boolean(row.curriculumText || row.curriculumFileName),
    lessonSequence: row.lessonSequence,
    currentTopicIndex: row.currentTopicIndex,
    assignmentWindowDays: row.assignmentWindowDays,
  };
}

export function sortClasses(rows: TeacherClass[]) {
  return [...rows].sort((a, b) => a.grade - b.grade || a.section.localeCompare(b.section) || a.subject.localeCompare(b.subject));
}

export async function serializeClassesWithCounts(rows: TeacherClass[]) {
  const ordered = sortClasses(rows);
  const counts = new Map<string, number>();
  if (ordered.length) {
    const memberships = await db
      .select({ classId: classLearnersTable.classId })
      .from(classLearnersTable)
      .where(inArray(classLearnersTable.classId, ordered.map((row) => row.id)));
    for (const membership of memberships) counts.set(membership.classId, (counts.get(membership.classId) ?? 0) + 1);
  }
  return ordered.map((row) => serializeClass(row, counts.get(row.id) ?? 0));
}

// Cross-class summary: one aggregate row per class.
export async function buildClassSummary(rows: TeacherClass[]) {
  const classes = [];
  for (const row of sortClasses(rows)) {
    const data = await loadClassData(row);
    const stats = conceptStats(data);
    const learners = learnerRows(data);
    const performance = performanceSeries(data);
    classes.push({
      ...serializeClass(row, data.learners.length),
      classAverage: performance.classAverage,
      trend: performance.trend,
      learnersWithGaps: learners.filter((learner) => learner.flags.length > 0).length,
      topStrugglingConcept: stats[0]?.concept ?? null,
      topStrugglingPercentage: stats[0]?.strugglingPercentage ?? 0,
      gapAlert: classGapAlert(stats),
    });
  }
  return classes;
}

export async function buildClassOverview(classRow: TeacherClass) {
  const data = await loadClassData(classRow);
  const stats = conceptStats(data);
  const learnerById = new Map(data.learners.map((learner) => [learner.id, learner]));
  const assignmentById = new Map(data.assignments.map((assignment) => [assignment.id, assignment]));
  const sessionById = new Map(data.sessions.map((session) => [session.id, session]));
  const pendingMarking = data.submissions
    .filter((submission) => submission.markingStatus === "PENDING_TEACHER_REVIEW")
    .map((submission) => {
      const learner = learnerById.get(submission.learnerId);
      const assignment = assignmentById.get(submission.assignmentId);
      const session = sessionById.get(submission.sessionId);
      const questions = (session?.questions as Array<{ id: string; prompt: string; concept: string }> | undefined) ?? [];
      const answers = submission.answers ?? [];
      const marks = (submission.marks as Array<{ questionId: string; verdict: string; explanation: string; score: number | null; gap: string | null }>) ?? [];
      return {
        submissionId: submission.id,
        learnerId: submission.learnerId,
        learnerName: learner?.fullName ?? "Learner",
        assignmentId: submission.assignmentId,
        assignmentTitle: assignment?.title ?? "Assignment",
        submittedAt: submission.submittedAt.toISOString(),
        questions: questions.map((question, index) => ({
          index,
          questionId: question.id,
          prompt: question.prompt,
          concept: question.concept,
          learnerAnswer: answers.find((answer) => answer.questionId === question.id)?.answer ?? "",
          mark: marks.find((mark) => mark.questionId === question.id) ?? null,
        })),
      };
    });
  return {
    class: serializeClass(classRow, data.learners.length),
    learners: learnerRows(data),
    conceptGaps: stats,
    gapAlert: classGapAlert(stats),
    assignments: await assignmentProgressWithStarts(data),
    performance: performanceSeries(data),
    pendingMarking,
  };
}

export async function buildLearnerDrillDown(classRow: TeacherClass, learnerId: string) {
  const data = await loadClassData(classRow);
  const drillDown = learnerDrillDown(data, learnerId);
  if (!drillDown) return null;
  return { class: serializeClass(classRow, data.learners.length), ...drillDown };
}
