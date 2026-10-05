import { and, eq, inArray } from "drizzle-orm";
import {
  assignmentSessionsTable,
  assignmentsTable,
  classLearnersTable,
  classMaterialsTable,
  classesTable,
  db,
  learnersTable,
  remediationActivitiesTable,
  submissionsTable,
} from "@workspace/db";
import { classLabel } from "./class-insights";

// Subject-classroom layer. Each class a learner joins (via a teacher's code)
// is one subject classroom; Elena can hold up to eight. "Switching" in and
// out is a client-side navigation concept — this module only assembles the
// per-classroom payload the dashboards render.

export type ClassroomAssignment = {
  id: string;
  title: string;
  subject: string;
  topic: string;
  openAt: string;
  closeAt: string;
  questionCount: number;
  status: "OPEN" | "LOCKED";
};

export type ClassroomStats = {
  averageScore: number | null;
  submissionCount: number;
  openAssignments: number;
  upcomingAssignments: number;
  missedAssignments: number;
  lastActive: string | null;
  topGap: string | null;
  newAssignments: Array<{ id: string; title: string; subject: string; topic: string; closeAt: string }>;
  liveAssignments: ClassroomAssignment[];
  upcomingAssignmentsDetail: ClassroomAssignment[];
  strongestConcept: string | null;
};

export type LearnerClassroom = {
  id: string;
  grade: number;
  section: string;
  subject: string;
  schoolName: string;
  label: string;
  joinedAt: string;
  stats: ClassroomStats;
};

function toIso(value: Date | null | undefined) {
  return value ? value.toISOString() : null;
}

function averageOrNull(values: number[]) {
  if (!values.length) return null;
  return Math.round(values.reduce((total, value) => total + value, 0) / values.length);
}

// Per-classroom roll-up for one learner: average, streak signals, open/upcoming/
// missed work, most recent activity, top concept gap and new assignments in this
// classroom. Used by both the classroom list and the home dashboard summary.
export async function classroomStatsForLearner(classRow: typeof classesTable.$inferSelect, learnerId: string): Promise<ClassroomStats> {
  // Only published work belongs on a learner's dashboard — drafts a teacher is
  // still reviewing must not appear as openable "live" work. Work that closed
  // before the learner joined the class is also excluded, matching the
  // `visibleAssignments` gate so nothing shows as "missed" that they never had.
  const [membership] = await db
    .select({ joinedAt: classLearnersTable.joinedAt })
    .from(classLearnersTable)
    .where(and(eq(classLearnersTable.learnerId, learnerId), eq(classLearnersTable.classId, classRow.id)))
    .limit(1);
  const joinedAt = membership?.joinedAt ?? classRow.createdAt;
  const assignments = (
    await db
      .select()
      .from(assignmentsTable)
      .where(and(eq(assignmentsTable.classId, classRow.id), eq(assignmentsTable.isPublished, true)))
  ).filter((entry) => entry.closeAt >= joinedAt);
  const assignmentIds = assignments.map((entry) => entry.id);
  const submissions = assignmentIds.length
    ? await db
        .select()
        .from(submissionsTable)
        .where(and(eq(submissionsTable.learnerId, learnerId), inArray(submissionsTable.assignmentId, assignmentIds)))
    : [];
  const now = new Date();
  const assignmentById = new Map(assignments.map((entry) => [entry.id, entry]));
  const releasedSubmissions = submissions.filter((submission) => {
    const assignment = assignmentById.get(submission.assignmentId);
    return Boolean(
      assignment
      && submission.markingStatus === "MARKED"
      && (assignment.resultReleasePolicy !== "after_close" || assignment.closeAt <= now),
    );
  });
  const sessionIds = releasedSubmissions.map((entry) => entry.sessionId);
  const sessions = sessionIds.length
    ? await db.select().from(assignmentSessionsTable).where(inArray(assignmentSessionsTable.id, sessionIds))
    : [];
  const questionConcepts = new Map<string, Map<string, string>>();
  for (const session of sessions) {
    const map = new Map<string, string>();
    for (const question of session.questions as Array<{ id: string; concept: string }>) {
      if (question?.id) map.set(question.id, question.concept || "General understanding");
    }
    questionConcepts.set(session.id, map);
  }
  const submittedIds = new Set(submissions.map((entry) => entry.assignmentId));
  const conceptScores = new Map<string, number[]>();
  const conceptEvidence = new Map<string, Set<string>>();
  for (const submission of releasedSubmissions) {
    const concepts = questionConcepts.get(submission.sessionId);
    for (const mark of (submission.marks as Array<{ questionId: string; score: number; gap: string | null }>) ?? []) {
      const concept = mark.gap || concepts?.get(mark.questionId) || "General understanding";
      const list = conceptScores.get(concept) ?? [];
      list.push(mark.score);
      conceptScores.set(concept, list);
      const evidence = conceptEvidence.get(concept) ?? new Set<string>();
      evidence.add(submission.id);
      conceptEvidence.set(concept, evidence);
    }
  }
  const ranked = [...conceptScores.entries()]
    .map(([concept, scores]) => ({ concept, average: averageOrNull(scores) ?? 0, evidenceCount: conceptEvidence.get(concept)?.size ?? 0 }))
    .filter((entry) => entry.evidenceCount >= 2)
    .sort((a, b) => a.average - b.average);
  const recentEvents = [
    ...submissions.map((entry) => entry.submittedAt),
    ...sessions.map((entry) => entry.openedAt),
  ].sort((a, b) => b.getTime() - a.getTime());
  const openAssignments = assignments
    .filter((entry) => entry.openAt <= now && now < entry.closeAt && !submittedIds.has(entry.id))
    .sort((a, b) => a.openAt.getTime() - b.openAt.getTime());
  const serializeClassroomAssignment = (entry: typeof assignmentsTable.$inferSelect, status: ClassroomAssignment["status"]): ClassroomAssignment => ({
    id: entry.id,
    title: entry.title,
    subject: entry.subject,
    topic: entry.topic,
    openAt: entry.openAt.toISOString(),
    closeAt: entry.closeAt.toISOString(),
    questionCount: entry.questionCount,
    status,
  });
  const liveAssignments = openAssignments.map((entry) => serializeClassroomAssignment(entry, "OPEN"));
  const upcoming = assignments
    .filter((entry) => entry.openAt > now)
    .sort((a, b) => a.openAt.getTime() - b.openAt.getTime());
  const upcomingAssignmentsDetail = upcoming.map((entry) => serializeClassroomAssignment(entry, "LOCKED"));
  return {
    averageScore: averageOrNull(releasedSubmissions.map((entry) => entry.score)),
    submissionCount: releasedSubmissions.length,
    openAssignments: openAssignments.length,
    upcomingAssignments: upcoming.length,
    missedAssignments: assignments.filter((entry) => entry.closeAt <= now && !submittedIds.has(entry.id)).length,
    lastActive: toIso(recentEvents[0]),
    topGap: ranked.length ? ranked[0].concept : null,
    newAssignments: openAssignments.slice(0, 3).map((entry) => ({
      id: entry.id,
      title: entry.title,
      subject: entry.subject,
      topic: entry.topic,
      closeAt: entry.closeAt.toISOString(),
    })),
    liveAssignments,
    upcomingAssignmentsDetail,
    strongestConcept: ranked.length > 1 ? ranked[ranked.length - 1].concept : null,
  };
}

export async function learnerClassrooms(learnerId: string): Promise<LearnerClassroom[]> {
  const memberships = await db
    .select({ classId: classLearnersTable.classId, joinedAt: classLearnersTable.joinedAt })
    .from(classLearnersTable)
    .where(eq(classLearnersTable.learnerId, learnerId));
  if (!memberships.length) return [];
  const joinedAt = new Map(memberships.map((entry) => [entry.classId, entry.joinedAt]));
  const rows = await db.select().from(classesTable).where(inArray(classesTable.id, memberships.map((entry) => entry.classId)));
  const withStats = await Promise.all(
    rows.map(async (row) => ({
      id: row.id,
      grade: row.grade,
      section: row.section,
      subject: row.subject,
      schoolName: row.schoolName,
      label: classLabel(row),
      joinedAt: (joinedAt.get(row.id) ?? row.createdAt).toISOString(),
      stats: await classroomStatsForLearner(row, learnerId),
    })),
  );
  return withStats.sort((a, b) => a.subject.localeCompare(b.subject));
}

export type ClassroomMaterial = {
  id: string;
  title: string;
  description: string;
  kind: string;
  fileName: string | null;
  fileType: string | null;
  hasContent: boolean;
  hasFile: boolean;
  createdAt: string;
};

export type LearnerClassroomDetail = {
  id: string;
  grade: number;
  section: string;
  subject: string;
  schoolName: string;
  label: string;
  joinedAt: string;
  stats: ClassroomStats;
  materials: ClassroomMaterial[];
};

// Everything the full-page classroom environment needs in one payload: the
// class header, live and upcoming work (so the learner never has to leave the
// room to see what is open), per-classroom stats and the teacher's uploaded
// study material.
export async function learnerClassroomDetail(learnerId: string, classId: string): Promise<LearnerClassroomDetail | null> {
  const [membership] = await db
    .select({ id: classLearnersTable.id, joinedAt: classLearnersTable.joinedAt })
    .from(classLearnersTable)
    .where(and(eq(classLearnersTable.learnerId, learnerId), eq(classLearnersTable.classId, classId)))
    .limit(1);
  if (!membership) return null;
  const [row] = await db.select().from(classesTable).where(eq(classesTable.id, classId)).limit(1);
  if (!row) return null;
  const stats = await classroomStatsForLearner(row, learnerId);
  const materials = await db
    .select({
      id: classMaterialsTable.id,
      title: classMaterialsTable.title,
      description: classMaterialsTable.description,
      kind: classMaterialsTable.kind,
      content: classMaterialsTable.content,
      fileName: classMaterialsTable.fileName,
      fileType: classMaterialsTable.fileType,
      fileData: classMaterialsTable.fileData,
      createdAt: classMaterialsTable.createdAt,
    })
    .from(classMaterialsTable)
    .where(eq(classMaterialsTable.classId, classId));
  return {
    id: row.id,
    grade: row.grade,
    section: row.section,
    subject: row.subject,
    schoolName: row.schoolName,
    label: classLabel(row),
    joinedAt: (membership.joinedAt ?? row.createdAt).toISOString(),
    stats,
    materials: materials
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .map((material) => ({
        id: material.id,
        title: material.title,
        description: material.description,
        kind: material.kind,
        fileName: material.fileName,
        fileType: material.fileType,
        hasContent: Boolean(material.content && material.content.trim()),
        hasFile: Boolean(material.fileData),
        createdAt: material.createdAt.toISOString(),
      })),
  };
}

export type HomeSubjectRow = {
  subject: string;
  classId: string;
  label: string;
  averageScore: number | null;
  openAssignments: number;
  missedAssignments: number;
  topGap: string | null;
  attention: "OK" | "LOW_AVERAGE" | "GAP" | "INACTIVE";
  lastActive: string | null;
};

export type ReminderItem = {
  id: string;
  title: string;
  subject: string;
  classLabel: string;
  closeAt: string;
  hoursLeft: number;
};

export type ActivityRecommendation = {
  id: string;
  title: string;
  format: string;
  concept: string;
  prompt: string;
  options: string[];
  instruction: string;
  reason: string;
};

// Home dashboard payload: per-subject averages + attention flags, reminders
// for work closing soon, and recommended activities for subjects where the
// learner gravely needs attention.
export async function learnerHomeAnalysis(learner: typeof learnersTable.$inferSelect) {
  const classrooms = await learnerClassrooms(learner.id);
  const now = new Date();
  const subjects: HomeSubjectRow[] = classrooms.map((entry) => {
    let attention: HomeSubjectRow["attention"] = "OK";
    if (!entry.stats.lastActive || now.getTime() - new Date(entry.stats.lastActive).getTime() > 14 * 24 * 60 * 60 * 1000) attention = "INACTIVE";
    if (entry.stats.averageScore !== null && entry.stats.averageScore < 50) attention = "LOW_AVERAGE";
    if (entry.stats.topGap && attention === "OK") attention = "GAP";
    return {
      subject: entry.subject,
      classId: entry.id,
      label: entry.label,
      averageScore: entry.stats.averageScore,
      openAssignments: entry.stats.openAssignments,
      missedAssignments: entry.stats.missedAssignments,
      topGap: entry.stats.topGap,
      attention,
      lastActive: entry.stats.lastActive,
    };
  });
  const reminders: ReminderItem[] = classrooms
    .flatMap((entry) =>
      entry.stats.newAssignments.map((assignment) => {
        const hoursLeft = Math.max(0, Math.round((new Date(assignment.closeAt).getTime() - now.getTime()) / (60 * 60 * 1000)));
        return { ...assignment, classLabel: entry.label, hoursLeft };
      }),
    )
    .sort((a, b) => a.hoursLeft - b.hoursLeft)
    .slice(0, 5);
  const recommended: ActivityRecommendation[] = [];
  for (const entry of classrooms) {
    const needsAttention =
      (entry.stats.submissionCount >= 2 && entry.stats.averageScore !== null && entry.stats.averageScore < 50) ||
      (entry.stats.topGap && (entry.stats.averageScore ?? 100) < 60);
    if (!needsAttention) continue;
    const activityRows = await db
      .select()
      .from(remediationActivitiesTable)
      .where(and(
        eq(remediationActivitiesTable.learnerId, learner.id),
        eq(remediationActivitiesTable.concept, entry.stats.topGap ?? entry.subject),
      ))
      .limit(5);
    let activity: typeof remediationActivitiesTable.$inferSelect | undefined;
    for (const candidate of activityRows) {
      if (!candidate.assignmentId) {
        activity = candidate;
        break;
      }
      const [activityAssignment] = await db
        .select({ closeAt: assignmentsTable.closeAt, resultReleasePolicy: assignmentsTable.resultReleasePolicy })
        .from(assignmentsTable)
        .where(eq(assignmentsTable.id, candidate.assignmentId))
        .limit(1);
      if (
        activityAssignment
        && (activityAssignment.resultReleasePolicy !== "after_close" || activityAssignment.closeAt <= now)
      ) {
        activity = candidate;
        break;
      }
    }
    recommended.push({
      id: activity?.id ?? `suggest-${entry.id}`,
      title: activity?.title ?? `Practice ${entry.stats.topGap ?? entry.subject}`,
      format: activity?.format ?? "QUIZ",
      concept: entry.stats.topGap ?? entry.subject,
      prompt: activity?.prompt ?? `Work through a short ${entry.subject} drill focused on ${entry.stats.topGap ?? "your weakest concept"}.`,
      options: activity?.options ?? [],
      instruction: activity?.instruction ?? "Answer each item carefully; it feeds your learning profile.",
      reason: entry.stats.averageScore !== null && entry.stats.averageScore < 50
        ? `Your ${entry.subject} average is ${entry.stats.averageScore}% — this subject needs attention.`
        : `Weakest measured concept in ${entry.subject}: ${entry.stats.topGap}.`,
    });
  }
  const overallAverage = averageOrNull(subjects.map((entry) => entry.averageScore).filter((value): value is number => value !== null));
  const weakest = subjects
    .filter((entry) => entry.averageScore !== null)
    .sort((a, b) => (a.averageScore ?? 0) - (b.averageScore ?? 0))[0] ?? null;
  return {
    subjects,
    reminders,
    recommended,
    overall: {
      averageScore: overallAverage,
      weakestSubject: weakest ? { subject: weakest.subject, averageScore: weakest.averageScore } : null,
      classrooms: classrooms.length,
      attentionSubjects: subjects.filter((entry) => entry.attention !== "OK").length,
    },
  };
}
