import { and, eq, inArray } from "drizzle-orm";
import {
  assignmentSessionsTable,
  assignmentsTable,
  classLearnersTable,
  classesTable,
  db,
  learnersTable,
  remediationActivitiesTable,
  submissionsTable,
} from "@workspace/db";
import type { GeneratedQuestion } from "./ai";

export type ClassRow = typeof classesTable.$inferSelect;

type Mark = { questionId: string; verdict: string; explanation: string; score: number; gap: string | null };

export type ConceptEvent = {
  concept: string;
  score: number;
  at: Date;
  source: string;
  label: string;
};

export type ClassData = {
  classRow: ClassRow;
  learners: Array<typeof learnersTable.$inferSelect>;
  assignments: Array<typeof assignmentsTable.$inferSelect>;
  submissions: Array<typeof submissionsTable.$inferSelect>;
  remediations: Array<typeof remediationActivitiesTable.$inferSelect>;
  conceptEvents: Map<string, ConceptEvent[]>;
};

const STRUGGLE_SCORE = 60;
const MASTERY_SCORE = 70;
const CLASS_GAP_SHARE = 0.5;

export function classLabel(classRow: Pick<ClassRow, "grade" | "section" | "subject">) {
  return `Grade ${classRow.grade}${classRow.section} · ${classRow.subject}`;
}

function average(values: number[]) {
  if (!values.length) return 0;
  return Math.round(values.reduce((total, value) => total + value, 0) / values.length);
}

export async function loadClassData(classRow: ClassRow): Promise<ClassData> {
  const memberships = await db
    .select({ learnerId: classLearnersTable.learnerId })
    .from(classLearnersTable)
    .where(eq(classLearnersTable.classId, classRow.id));
  const learnerIds = memberships.map((row) => row.learnerId);
  const learners = learnerIds.length
    ? await db.select().from(learnersTable).where(inArray(learnersTable.id, learnerIds))
    : [];
  const assignments = await db.select().from(assignmentsTable).where(eq(assignmentsTable.classId, classRow.id));
  const assignmentIds = assignments.map((assignment) => assignment.id);
  const submissions = learnerIds.length && assignmentIds.length
    ? await db
        .select()
        .from(submissionsTable)
        .where(and(inArray(submissionsTable.learnerId, learnerIds), inArray(submissionsTable.assignmentId, assignmentIds)))
    : [];
  const remediations = learnerIds.length
    ? await db.select().from(remediationActivitiesTable).where(inArray(remediationActivitiesTable.learnerId, learnerIds))
    : [];
  const sessionIds = submissions.map((submission) => submission.sessionId);
  const sessions = sessionIds.length
    ? await db.select().from(assignmentSessionsTable).where(inArray(assignmentSessionsTable.id, sessionIds))
    : [];
  const questionConcepts = new Map<string, Map<string, string>>();
  for (const session of sessions) {
    const map = new Map<string, string>();
    for (const question of session.questions as GeneratedQuestion[]) {
      if (question?.id) map.set(question.id, question.concept || "General understanding");
    }
    questionConcepts.set(session.id, map);
  }
  const assignmentTitles = new Map(assignments.map((assignment) => [assignment.id, assignment.title]));

  const conceptEvents = new Map<string, ConceptEvent[]>();
  const push = (learnerId: string, event: ConceptEvent) => {
    const list = conceptEvents.get(learnerId) ?? [];
    list.push(event);
    conceptEvents.set(learnerId, list);
  };
  for (const submission of submissions) {
    const concepts = questionConcepts.get(submission.sessionId);
    for (const mark of (submission.marks as Mark[]) ?? []) {
      const concept = mark.gap || concepts?.get(mark.questionId) || "General understanding";
      push(submission.learnerId, {
        concept,
        score: mark.score,
        at: submission.submittedAt,
        source: "ASSIGNMENT",
        label: assignmentTitles.get(submission.assignmentId) ?? "Assignment",
      });
    }
  }
  for (const remediation of remediations) {
    if (!remediation.completedAt || remediation.score === null) continue;
    push(remediation.learnerId, {
      concept: remediation.concept,
      score: remediation.score,
      at: remediation.completedAt,
      source: remediation.format,
      label: remediation.title,
    });
  }
  for (const [, events] of conceptEvents) events.sort((a, b) => a.at.getTime() - b.at.getTime());

  return { classRow, learners, assignments, submissions, remediations, conceptEvents };
}

export function conceptStats(data: ClassData) {
  const perConcept = new Map<string, Map<string, number[]>>();
  for (const [learnerId, events] of data.conceptEvents) {
    for (const event of events) {
      if (event.source !== "ASSIGNMENT") continue;
      const learnerScores = perConcept.get(event.concept) ?? new Map<string, number[]>();
      const scores = learnerScores.get(learnerId) ?? [];
      scores.push(event.score);
      learnerScores.set(learnerId, scores);
      perConcept.set(event.concept, learnerScores);
    }
  }
  const stats = [...perConcept.entries()].map(([concept, learnerScores]) => {
    const learnerAverages = [...learnerScores.entries()].map(([learnerId, scores]) => ({ learnerId, score: average(scores) }));
    const struggling = learnerAverages.filter((entry) => entry.score < STRUGGLE_SCORE);
    return {
      concept,
      learnersAssessed: learnerAverages.length,
      strugglingLearners: struggling.length,
      strugglingPercentage: learnerAverages.length ? Math.round((struggling.length / learnerAverages.length) * 100) : 0,
      averageScore: average(learnerAverages.map((entry) => entry.score)),
    };
  });
  return stats.sort((a, b) => b.strugglingPercentage - a.strugglingPercentage || a.averageScore - b.averageScore);
}

export function classGapAlert(stats: ReturnType<typeof conceptStats>) {
  const alert = stats.find((stat) => stat.learnersAssessed > 0 && stat.strugglingPercentage >= CLASS_GAP_SHARE * 100);
  if (!alert) return null;
  return {
    concept: alert.concept,
    strugglingPercentage: alert.strugglingPercentage,
    strugglingLearners: alert.strugglingLearners,
    learnersAssessed: alert.learnersAssessed,
    averageScore: alert.averageScore,
    message: `CLASS GAP DETECTED: ${alert.concept} — ${alert.strugglingPercentage}% of your learners are struggling with this`,
  };
}

// Consecutive days with learning activity, counting back from today (a quiet
// today does not break a streak that ran until yesterday).
function streakDays(events: ConceptEvent[]) {
  const days = new Set(events.map((event) => event.at.toISOString().slice(0, 10)));
  if (!days.size) return 0;
  const cursor = new Date();
  if (!days.has(cursor.toISOString().slice(0, 10))) cursor.setDate(cursor.getDate() - 1);
  let streak = 0;
  while (days.has(cursor.toISOString().slice(0, 10))) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

export function learnerRows(data: ClassData) {
  const now = new Date();
  return data.learners
    .map((learner) => {
      const learnerSubmissions = data.submissions.filter((submission) => submission.learnerId === learner.id);
      const submittedAssignmentIds = new Set(learnerSubmissions.map((submission) => submission.assignmentId));
      const missedAssignments = data.assignments.filter(
        (assignment) => assignment.closeAt < now && !submittedAssignmentIds.has(assignment.id),
      ).length;
      const events = data.conceptEvents.get(learner.id) ?? [];
      const conceptAverages = new Map<string, number[]>();
      for (const event of events) {
        const scores = conceptAverages.get(event.concept) ?? [];
        scores.push(event.score);
        conceptAverages.set(event.concept, scores);
      }
      const ranked = [...conceptAverages.entries()]
        .map(([concept, scores]) => ({ concept, score: average(scores) }))
        .sort((a, b) => b.score - a.score);
      const averageScore = average(learnerSubmissions.map((submission) => submission.score));
      const lastActive = [...learnerSubmissions.map((submission) => submission.submittedAt), ...events.map((event) => event.at)]
        .sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
      const flags: string[] = [];
      if (missedAssignments >= 2) flags.push("MISSED_WORK");
      if (learnerSubmissions.length > 0 && averageScore < 50) flags.push("LOW_AVERAGE");
      return {
        id: learner.id,
        fullName: learner.fullName,
        username: learner.username,
        averageScore,
        submissionCount: learnerSubmissions.length,
        missedAssignments,
        lastActive: lastActive ? lastActive.toISOString() : null,
        streakDays: streakDays(events),
        strongestConcept: ranked[0]?.concept ?? null,
        weakestConcept: ranked.length > 1 ? ranked[ranked.length - 1].concept : null,
        flags,
      };
    })
    .sort((a, b) => a.fullName.localeCompare(b.fullName));
}

export function assignmentProgress(data: ClassData) {
  const now = new Date();
  const learnerCount = data.learners.length;
  const learnerIds = new Set(data.learners.map((learner) => learner.id));
  return data.assignments
    .slice()
    .sort((a, b) => a.openAt.getTime() - b.openAt.getTime())
    .map((assignment) => {
      const submissions = data.submissions.filter((submission) => submission.assignmentId === assignment.id);
      const submitted = submissions.length;
      const status = now < assignment.openAt ? "LOCKED" : now >= assignment.closeAt ? "CLOSED" : "OPEN";
      return {
        id: assignment.id,
        title: assignment.title,
        subject: assignment.subject,
        topic: assignment.topic,
        openAt: assignment.openAt.toISOString(),
        closeAt: assignment.closeAt.toISOString(),
        questionCount: assignment.questionCount,
        status,
        learnerCount,
        submitted,
        started: 0,
        missed: status === "CLOSED" ? Math.max(0, learnerCount - submitted) : 0,
        averageScore: average(submissions.map((submission) => submission.score)),
        learnerIds: [...learnerIds],
      };
    });
}

export async function assignmentProgressWithStarts(data: ClassData) {
  const rows = assignmentProgress(data);
  const assignmentIds = rows.map((row) => row.id);
  const learnerIds = data.learners.map((learner) => learner.id);
  const sessions = assignmentIds.length && learnerIds.length
    ? await db
        .select({ assignmentId: assignmentSessionsTable.assignmentId, learnerId: assignmentSessionsTable.learnerId })
        .from(assignmentSessionsTable)
        .where(and(inArray(assignmentSessionsTable.assignmentId, assignmentIds), inArray(assignmentSessionsTable.learnerId, learnerIds)))
    : [];
  return rows.map(({ learnerIds: _learnerIds, ...row }) => {
    const starters = new Set(sessions.filter((session) => session.assignmentId === row.id).map((session) => session.learnerId));
    return { ...row, started: starters.size, notStarted: Math.max(0, row.learnerCount - starters.size) };
  });
}

export function performanceSeries(data: ClassData) {
  const points = data.assignments
    .slice()
    .sort((a, b) => a.openAt.getTime() - b.openAt.getTime())
    .map((assignment) => {
      const submissions = data.submissions.filter((submission) => submission.assignmentId === assignment.id);
      return {
        assignmentId: assignment.id,
        title: assignment.title,
        topic: assignment.topic,
        openAt: assignment.openAt.toISOString(),
        submissions: submissions.length,
        averageScore: average(submissions.map((submission) => submission.score)),
      };
    })
    .filter((point) => point.submissions > 0);
  const lowest = points.length ? Math.min(...points.map((point) => point.averageScore)) : 0;
  const first = points[0]?.averageScore ?? 0;
  const last = points[points.length - 1]?.averageScore ?? 0;
  const trend = points.length < 2 ? "NOT_ENOUGH_DATA" : last - first >= 5 ? "IMPROVING" : first - last >= 5 ? "DECLINING" : "STAGNATING";
  return {
    trend,
    classAverage: average(points.map((point) => point.averageScore)),
    points: points.map((point) => ({ ...point, isLowest: points.length > 0 && point.averageScore === lowest })),
  };
}

export function learnerDrillDown(data: ClassData, learnerId: string) {
  const learner = data.learners.find((entry) => entry.id === learnerId);
  if (!learner) return null;
  const events = data.conceptEvents.get(learnerId) ?? [];
  const submissions = data.submissions
    .filter((submission) => submission.learnerId === learnerId)
    .sort((a, b) => a.submittedAt.getTime() - b.submittedAt.getTime());
  const assignmentTitles = new Map(data.assignments.map((assignment) => [assignment.id, assignment]));
  const conceptScores = new Map<string, number[]>();
  for (const event of events) {
    const scores = conceptScores.get(event.concept) ?? [];
    scores.push(event.score);
    conceptScores.set(event.concept, scores);
  }
  const concepts = [...conceptScores.entries()].map(([concept, scores]) => ({
    concept,
    averageScore: average(scores),
    attempts: scores.length,
    mastered: average(scores) >= MASTERY_SCORE,
  }));
  const persistentGaps = [...conceptScores.keys()]
    .map((concept) => {
      const failures = events.filter((event) => event.concept === concept && event.score < STRUGGLE_SCORE);
      const formats = new Set(failures.map((failure) => failure.source));
      return { concept, failures: failures.length, formats: [...formats] };
    })
    .filter((entry) => entry.failures >= 3 && entry.formats.length >= 2);
  const activities = data.remediations
    .filter((remediation) => remediation.learnerId === learnerId)
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
    .map((remediation) => {
      const completedAt = remediation.completedAt;
      const before = completedAt
        ? events.filter((event) => event.concept === remediation.concept && event.at < completedAt).map((event) => event.score)
        : [];
      const after = completedAt
        ? events.filter((event) => event.concept === remediation.concept && event.at > completedAt).map((event) => event.score)
        : [];
      return {
        id: remediation.id,
        format: remediation.format,
        title: remediation.title,
        concept: remediation.concept,
        completedAt: completedAt ? completedAt.toISOString() : null,
        score: remediation.score,
        helped: before.length && after.length ? average(after) > average(before) : null,
      };
    });
  const formatScores = new Map<string, number[]>();
  for (const event of events) {
    const scores = formatScores.get(event.source) ?? [];
    scores.push(event.score);
    formatScores.set(event.source, scores);
  }
  return {
    learner: {
      id: learner.id,
      fullName: learner.fullName,
      username: learner.username,
      grade: learner.grade,
      schoolName: learner.schoolName,
    },
    assignmentHistory: submissions.map((submission) => ({
      assignmentId: submission.assignmentId,
      title: assignmentTitles.get(submission.assignmentId)?.title ?? "Assignment",
      topic: assignmentTitles.get(submission.assignmentId)?.topic ?? "",
      score: submission.score,
      verdict: submission.overallVerdict,
      submittedAt: submission.submittedAt.toISOString(),
    })),
    conceptsMastered: concepts.filter((concept) => concept.mastered),
    conceptsDeveloping: concepts.filter((concept) => !concept.mastered),
    learningStyle: [...formatScores.entries()]
      .map(([format, scores]) => ({ format, averageScore: average(scores), attempts: scores.length }))
      .sort((a, b) => b.averageScore - a.averageScore),
    activities,
    persistentGaps,
  };
}
