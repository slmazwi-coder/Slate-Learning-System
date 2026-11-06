import { eq, inArray } from "drizzle-orm";
import {
  classesTable,
  db,
  parentsTable,
  teachersTable,
  tutorsTable,
  type TeacherClass,
} from "@workspace/db";
import {
  buildConceptEvents,
  classGapAlert,
  classLabel,
  conceptStats,
  loadClassData,
  performanceSeries,
  type ClassData,
} from "./class-insights";
import { resultsReleased, teacherReleaseState } from "./result-release";
import { countZones, hodZoneSummary, type ZoneCounts } from "./zones";

// The HOD sees class-level data only. Every payload built here is stripped of
// learner identity: aggregates, counts and concept labels, never a name or an
// id. The one place a learner's name is shown to an HOD is a marked script,
// and only while the teacher has switched script access on (routes/hod.ts).

type Submission = ClassData["submissions"][number];

function average(values: number[]) {
  if (!values.length) return 0;
  return Math.round(values.reduce((total, value) => total + value, 0) / values.length);
}

// A submission counts towards an HOD's view only when the teacher has released
// its results AND marking completed. Held results (and failed/pending marking)
// never count, which is what keeps a held assignment out of the class average,
// the zones and the trend.
function visibleSubmissions(data: ClassData, now: Date): Submission[] {
  const assignmentById = new Map(data.assignments.map((assignment) => [assignment.id, assignment]));
  return data.submissions.filter((submission) => {
    if (submission.markingStatus !== "MARKED") return false;
    const assignment = assignmentById.get(submission.assignmentId);
    return assignment ? resultsReleased(assignment, now) : false;
  });
}

// A copy of the class data whose submissions and concept timeline contain only
// released, marked results, so the existing concept-gap and trend logic can be
// reused unchanged and stay correct for the HOD.
function releasedData(data: ClassData, now: Date): ClassData {
  const submissions = visibleSubmissions(data, now);
  return {
    ...data,
    submissions,
    conceptEvents: buildConceptEvents({
      submissions,
      remediations: data.remediations,
      sessions: data.sessions,
      assignments: data.assignments,
    }),
  };
}

function classAverage(data: ClassData, now: Date) {
  return average(visibleSubmissions(data, now).map((submission) => submission.score));
}

// Completion rate per assignment: how many of the class's learners submitted,
// as a count and a percentage. No learner ids leave this function.
function assignmentRows(data: ClassData, now: Date) {
  const learnerCount = data.learners.length;
  const visible = new Set(visibleSubmissions(data, now).map((submission) => submission.id));
  return data.assignments
    .slice()
    .sort((a, b) => a.openAt.getTime() - b.openAt.getTime())
    .map((assignment) => {
      const forAssignment = data.submissions.filter((submission) => submission.assignmentId === assignment.id);
      const marked = forAssignment.filter((submission) => submission.markingStatus === "MARKED");
      const visibleScores = forAssignment.filter((submission) => visible.has(submission.id)).map((submission) => submission.score);
      const status = now < assignment.openAt ? "LOCKED" : now >= assignment.closeAt ? "CLOSED" : "OPEN";
      return {
        id: assignment.id,
        title: assignment.title,
        topic: assignment.topic,
        status,
        openAt: assignment.openAt.toISOString(),
        closeAt: assignment.closeAt.toISOString(),
        learnerCount,
        submitted: forAssignment.length,
        completionRate: learnerCount ? Math.round((forAssignment.length / learnerCount) * 100) : 0,
        missed: status === "CLOSED" ? Math.max(0, learnerCount - forAssignment.length) : 0,
        averageScore: average(visibleScores),
        markedCount: marked.length,
        releaseState: teacherReleaseState(assignment) ?? "POLICY",
        resultsVisible: resultsReleased(assignment, now),
      };
    });
}

// The class-level payload shared by the overview and the single-class view.
export async function hodClassSummary(classRow: TeacherClass, options: { includeAssignments?: boolean } = {}) {
  const now = new Date();
  const data = await loadClassData(classRow);
  const released = releasedData(data, now);
  const stats = conceptStats(released);
  const performance = performanceSeries(released);
  const assignments = assignmentRows(data, now);
  // Zones come from the ONE shared service (lib/zones.ts), the same one the
  // teacher view uses. This function never re-implements the arithmetic; it only
  // reduces the result to counts and drops the learner identity.
  const zoneSummary = await hodZoneSummary(classRow.id, now);
  const zones: ZoneCounts = zoneSummary?.counts ?? countZones([]);
  const overallCompletion = assignments.length
    ? Math.round(assignments.reduce((total, row) => total + row.completionRate, 0) / assignments.length)
    : 0;
  return {
    class: {
      id: classRow.id,
      label: classLabel(classRow),
      grade: classRow.grade,
      section: classRow.section,
      subject: classRow.subject,
      schoolName: classRow.schoolName,
      ownerType: classRow.ownerType,
      learnerCount: data.learners.length,
      hodCanViewScripts: classRow.hodCanViewScripts,
      teacherName: await ownerName(classRow),
    },
    classAverage: classAverage(data, now),
    zones,
    // Change since the last term and the intervention coverage for red learners.
    // Counts and percentages only: no learner name or id is in this payload.
    zoneChangeSinceLastTerm: zoneSummary?.changeSinceLastTerm ?? null,
    zoneIntervention: zoneSummary?.intervention ?? { red: 0, withIntervention: 0, share: null },
    zoneTerm: zoneSummary?.term ?? null,
    conceptGaps: stats.map((stat) => ({
      concept: stat.concept,
      learnersAssessed: stat.learnersAssessed,
      strugglingLearners: stat.strugglingLearners,
      strugglingPercentage: stat.strugglingPercentage,
      averageScore: stat.averageScore,
    })),
    gapAlert: classGapAlert(stats),
    trend: performance.trend,
    performance: performance.points.map((point) => ({
      assignmentId: point.assignmentId,
      title: point.title,
      topic: point.topic,
      openAt: point.openAt,
      submissions: point.submissions,
      averageScore: point.averageScore,
      isLowest: point.isLowest,
    })),
    completionRate: overallCompletion,
    assignmentCount: assignments.length,
    ...(options.includeAssignments ? { assignments } : {}),
  };
}

// The class owner's display name. HODs group their classes by teacher, so the
// teacher's name is class-level metadata, not learner data.
export async function ownerName(classRow: Pick<TeacherClass, "ownerType" | "teacherId" | "parentId" | "tutorId">): Promise<string> {
  if (classRow.teacherId) {
    const [teacher] = await db
      .select({ fullName: teachersTable.fullName })
      .from(teachersTable)
      .where(eq(teachersTable.id, classRow.teacherId))
      .limit(1);
    if (teacher) return teacher.fullName;
  }
  if (classRow.parentId) {
    const [parent] = await db
      .select({ fullName: parentsTable.fullName })
      .from(parentsTable)
      .where(eq(parentsTable.id, classRow.parentId))
      .limit(1);
    if (parent) return parent.fullName;
  }
  if (classRow.tutorId) {
    const [tutor] = await db
      .select({ fullName: tutorsTable.fullName })
      .from(tutorsTable)
      .where(eq(tutorsTable.id, classRow.tutorId))
      .limit(1);
    if (tutor) return tutor.fullName;
  }
  return "Class owner";
}

// Every class the HOD supervises, grouped by the teacher who runs it. The
// groups are ordered by teacher name and never ranked by performance.
export async function hodOverview(classRows: TeacherClass[]) {
  const summaries = [];
  for (const classRow of classRows) summaries.push(await hodClassSummary(classRow));
  const byTeacher = new Map<string, { teacherName: string; classes: typeof summaries }>();
  for (const summary of summaries) {
    const key = summary.class.teacherName;
    const group = byTeacher.get(key) ?? { teacherName: key, classes: [] };
    group.classes.push(summary);
    byTeacher.set(key, group);
  }
  const teachers = [...byTeacher.values()].sort((a, b) => a.teacherName.localeCompare(b.teacherName));
  return {
    classes: summaries,
    teachers,
    totals: {
      classes: summaries.length,
      teachers: teachers.length,
      learners: summaries.reduce((total, summary) => total + summary.class.learnerCount, 0),
      classAverage: average(summaries.map((summary) => summary.classAverage).filter((value) => value > 0)),
      zones: summaries.reduce<ZoneCounts>(
        (total, summary) => ({
          green: total.green + summary.zones.green,
          yellow: total.yellow + summary.zones.yellow,
          red: total.red + summary.zones.red,
          grey: total.grey + summary.zones.grey,
          total: total.total + summary.zones.total,
        }),
        { green: 0, yellow: 0, red: 0, grey: 0, total: 0 },
      ),
    },
  };
}

export async function classById(classId: string): Promise<TeacherClass | null> {
  const [row] = await db.select().from(classesTable).where(eq(classesTable.id, classId)).limit(1);
  return row ?? null;
}

export async function classesByIds(ids: string[]): Promise<TeacherClass[]> {
  if (!ids.length) return [];
  return db.select().from(classesTable).where(inArray(classesTable.id, ids));
}
