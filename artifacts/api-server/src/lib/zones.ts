import { and, eq, inArray, isNull } from "drizzle-orm";
import {
  assignmentsTable,
  classLearnersTable,
  classesTable,
  db,
  interventionsTable,
  learnersTable,
  markingResultsTable,
  submissionsTable,
  termsTable,
  zoneAlertsTable,
  zoneSettingsTable,
  type TeacherClass,
} from "@workspace/db";
import { submissionResultsVisible } from "./result-release";
import { recordAudit } from "./audit";

// ---- The zone engine --------------------------------------------------------
//
// ONE service, shared by the teacher view and the HOD view. There is no second
// copy of this arithmetic anywhere: routes/tis.ts and routes/hod.ts both call
// computeClassZones and then decide what to show.
//
// A zone is the band of a learner's average over their most recent results in
// one class. It is INDICATIVE ONLY. It is never a promotion decision, never a
// pass/fail and never a label a learner carries between classes — the UI says so
// wherever a zone is shown.
//
// What counts, and what does not:
//   - Only RELEASED, MARKED results. A held result, a submission still flagged
//     needsTeacherReview, and a submission whose marking failed are all excluded.
//   - Missed work is NEVER counted as zero. It is simply absent from the score,
//     and two missed in a row raises an engagement flag instead.
//   - Formal (exam) assignments carry double weight.

export const ZONE_DEFAULTS = {
  greenMin: 60,
  yellowMin: 40,
  minResults: 3,
  windowSize: 5,
  formalWeight: 2,
  trendDropFlag: 15,
  missedInRowFlag: 2,
} as const;

export type Zone = "green" | "yellow" | "red" | "grey";
export type Trend = "up" | "flat" | "down";

// The settings actually used for a class: the class row when present, the
// defaults otherwise. A class created before this feature has no row, so it
// keeps exactly the 60 / 40 / 3 / 5 behaviour it had before.
export type ResolvedZoneSettings = {
  greenMin: number;
  yellowMin: number;
  minResults: number;
  windowSize: number;
  formalWeight: number;
  trendDropFlag: number;
  missedInRowFlag: number;
};

export type ZoneSettingsInput = Partial<Record<keyof ResolvedZoneSettings, number | null>> | null | undefined;

export function resolveZoneSettings(row: ZoneSettingsInput): ResolvedZoneSettings {
  return {
    greenMin: row?.greenMin ?? ZONE_DEFAULTS.greenMin,
    yellowMin: row?.yellowMin ?? ZONE_DEFAULTS.yellowMin,
    minResults: row?.minResults ?? ZONE_DEFAULTS.minResults,
    windowSize: row?.windowSize ?? ZONE_DEFAULTS.windowSize,
    formalWeight: row?.formalWeight ?? ZONE_DEFAULTS.formalWeight,
    trendDropFlag: row?.trendDropFlag ?? ZONE_DEFAULTS.trendDropFlag,
    missedInRowFlag: row?.missedInRowFlag ?? ZONE_DEFAULTS.missedInRowFlag,
  };
}

// Parent-facing wording lives here and ONLY here, so the plain phrases can be
// reviewed in one place. A parent never sees a number, a colour, a zone name or
// another learner. These are deliberately gentle and non-diagnostic.
export const PARENT_ZONE_WORDING: Record<Zone, string> = {
  red: "needs extra support",
  yellow: "keep practising",
  green: "on track",
  // A parent is never told "not enough data" as a judgement; the phrase is
  // neutral and simply says the picture is still forming.
  grey: "still building a picture",
};

export const ZONE_LABELS: Record<Zone, string> = {
  red: "Needs support",
  yellow: "Watch",
  green: "On track",
  grey: "Not enough data",
};

export type ZoneCounts = { green: number; yellow: number; red: number; grey: number; total: number };

// ---- Pure arithmetic --------------------------------------------------------
// Everything below is pure so it can be tested without a database.

export type ResultEntry = { score: number; formal: boolean; submittedAt: Date };

function round1(value: number) {
  return Math.round(value * 10) / 10;
}

// Formal work counts double. A learner with no results has no average at all
// (null), which is different from an average of zero — an average of zero would
// be a judgement, and there is nothing to judge yet.
export function weightedAverage(entries: ResultEntry[], formalWeight: number): number | null {
  if (!entries.length) return null;
  let numerator = 0;
  let denominator = 0;
  for (const entry of entries) {
    const weight = entry.formal ? formalWeight : 1;
    numerator += entry.score * weight;
    denominator += weight;
  }
  return denominator ? numerator / denominator : null;
}

// The zone for a score. Fewer than minResults results is "grey" and NEVER red:
// too little evidence is not the same as doing badly.
export function zoneForScore(score: number | null, resultCount: number, settings: ResolvedZoneSettings): Zone {
  if (resultCount < settings.minResults || score === null) return "grey";
  if (score >= settings.greenMin) return "green";
  if (score >= settings.yellowMin) return "yellow";
  return "red";
}

// Trend compares the current window with the window before it. With no previous
// window there is nothing to compare, so the trend is flat rather than invented.
export function trendOf(
  current: number | null,
  previous: number | null,
  settings: ResolvedZoneSettings,
): { trend: Trend; earlyWarning: boolean } {
  if (current === null || previous === null) return { trend: "flat", earlyWarning: false };
  const change = round1(current) - round1(previous);
  const trend: Trend = change > 0 ? "up" : change < 0 ? "down" : "flat";
  // A drop of trendDropFlag points or more is an early warning even when the
  // learner is still green or yellow — the point is to catch a slide early.
  return { trend, earlyWarning: change <= -settings.trendDropFlag };
}

// The run of consecutive missed assignments ending at the most recent closed
// assignment. Missed work never scores zero; it raises a flag instead.
export function consecutiveMissed(flagsNewestFirst: boolean[]): number {
  let run = 0;
  for (const missed of flagsNewestFirst) {
    if (!missed) break;
    run += 1;
  }
  return run;
}

// The alert rule: the two most recent results are both below the red line.
// "Below the red line" means below the yellow floor, i.e. in the red band.
export function twoMostRecentBelowRed(resultsNewestFirst: ResultEntry[], settings: ResolvedZoneSettings): boolean {
  if (resultsNewestFirst.length < 2) return false;
  return resultsNewestFirst[0].score < settings.yellowMin && resultsNewestFirst[1].score < settings.yellowMin;
}

export type LearnerZone = {
  learnerId: string;
  learnerName: string;
  zone: Zone;
  score: number | null;
  resultCount: number;
  trend: Trend;
  earlyWarning: boolean;
  engagementFlag: boolean;
  missedInARow: number;
};

export type LearnerZoneInput = {
  learnerId: string;
  learnerName: string;
  results: ResultEntry[];
  // Newest first: whether each closed assignment in turn was missed.
  missedNewestFirst: boolean[];
  settings: ResolvedZoneSettings;
};

// One learner's zone. `results` may arrive in any order; the window is taken
// from the most recent by submittedAt.
export function computeLearnerZone(input: LearnerZoneInput): LearnerZone {
  const { settings } = input;
  const ordered = [...input.results].sort((a, b) => b.submittedAt.getTime() - a.submittedAt.getTime());
  const currentWindow = ordered.slice(0, settings.windowSize);
  const previousWindow = ordered.slice(settings.windowSize, settings.windowSize * 2);

  const score = weightedAverage(currentWindow, settings.formalWeight);
  const previousScore = weightedAverage(previousWindow, settings.formalWeight);
  const { trend, earlyWarning } = trendOf(score, previousScore, settings);
  const missedInARow = consecutiveMissed(input.missedNewestFirst);

  return {
    learnerId: input.learnerId,
    learnerName: input.learnerName,
    zone: zoneForScore(score, currentWindow.length, settings),
    score: score === null ? null : round1(score),
    resultCount: currentWindow.length,
    trend,
    earlyWarning,
    engagementFlag: missedInARow >= settings.missedInRowFlag,
    missedInARow,
  };
}

export function countZones(learners: Array<Pick<LearnerZone, "zone">>): ZoneCounts {
  const counts: ZoneCounts = { green: 0, yellow: 0, red: 0, grey: 0, total: learners.length };
  for (const learner of learners) counts[learner.zone] += 1;
  return counts;
}

// The teacher's priority list: red first, then anyone with an early warning,
// then yellow. Within a group the lowest score comes first, because that is the
// learner who needs the teacher soonest. Grey learners are never "prioritised"
// on too little evidence, but a grey learner with an engagement flag is listed
// so missed work is still visible.
export function priorityOrder(learners: LearnerZone[]): LearnerZone[] {
  const rank = (learner: LearnerZone) => {
    if (learner.zone === "red") return 0;
    if (learner.earlyWarning) return 1;
    if (learner.zone === "yellow") return 2;
    if (learner.engagementFlag) return 3;
    return 4;
  };
  return [...learners].sort((a, b) => {
    const byRank = rank(a) - rank(b);
    if (byRank !== 0) return byRank;
    const scoreA = a.score ?? Number.POSITIVE_INFINITY;
    const scoreB = b.score ?? Number.POSITIVE_INFINITY;
    if (scoreA !== scoreB) return scoreA - scoreB;
    return a.learnerName.localeCompare(b.learnerName);
  });
}

export function classZoneAverage(learners: LearnerZone[]): number | null {
  const scored = learners.map((learner) => learner.score).filter((score): score is number => score !== null);
  if (!scored.length) return null;
  return round1(scored.reduce((total, score) => total + score, 0) / scored.length);
}

// ---- Data loading -----------------------------------------------------------

export type ClassZoneReport = {
  classId: string;
  settings: ResolvedZoneSettings;
  // Null when no CONFIRMED term covers `now`. A placeholder term never restricts
  // the window: until real dates are entered, behaviour is unchanged.
  term: { id: string; year: number; termNo: number; status: string; label: string } | null;
  learners: LearnerZone[];
  counts: ZoneCounts;
  priority: LearnerZone[];
  classAverage: number | null;
};

type ZoneData = {
  classRow: TeacherClass;
  settings: ResolvedZoneSettings;
  term: ClassZoneReport["term"];
  learners: Array<{ id: string; fullName: string }>;
  results: Map<string, ResultEntry[]>;
  missed: Map<string, boolean[]>;
  belowRed: Set<string>;
};

// A term only shapes the window once its dates are confirmed. Placeholder rows
// exist so the school can fill them in, but a placeholder must never silently
// hide a learner's real results.
function termFor(rows: Array<{ id: string; year: number; termNo: number; startDate: Date; endDate: Date; status: string }>, now: Date) {
  const confirmed = rows.find(
    (row) => row.status === "confirmed" && row.startDate.getTime() <= now.getTime() && row.endDate.getTime() >= now.getTime(),
  );
  if (!confirmed) return null;
  return {
    id: confirmed.id,
    year: confirmed.year,
    termNo: confirmed.termNo,
    status: confirmed.status,
    label: `Term ${confirmed.termNo} ${confirmed.year}`,
  };
}

async function loadZoneData(classRow: TeacherClass, now: Date): Promise<ZoneData> {
  const [settingsRow] = await db.select().from(zoneSettingsTable).where(eq(zoneSettingsTable.classId, classRow.id)).limit(1);
  const settings = resolveZoneSettings(settingsRow);

  const termRows = await db.select().from(termsTable);
  const term = termFor(termRows, now);

  const memberships = await db
    .select({ learnerId: classLearnersTable.learnerId, joinedAt: classLearnersTable.joinedAt })
    .from(classLearnersTable)
    .where(eq(classLearnersTable.classId, classRow.id));
  const learnerIds = memberships.map((row) => row.learnerId);
  const joinedById = new Map(memberships.map((row) => [row.learnerId, row.joinedAt]));

  const learners = learnerIds.length
    ? (await db.select({ id: learnersTable.id, fullName: learnersTable.fullName }).from(learnersTable).where(inArray(learnersTable.id, learnerIds)))
        .sort((a, b) => a.fullName.localeCompare(b.fullName))
    : [];

  const assignments = await db.select().from(assignmentsTable).where(eq(assignmentsTable.classId, classRow.id));
  const assignmentIds = assignments.map((assignment) => assignment.id);

  const submissions = learnerIds.length && assignmentIds.length
    ? await db
        .select()
        .from(submissionsTable)
        .where(and(inArray(submissionsTable.learnerId, learnerIds), inArray(submissionsTable.assignmentId, assignmentIds)))
    : [];

  // A submission flagged needsTeacherReview is excluded outright. One query for
  // every flagged submission in the class keeps this to a single round trip.
  const submissionIds = submissions.map((submission) => submission.id);
  const flagged = submissionIds.length
    ? await db
        .select({ submissionId: markingResultsTable.submissionId })
        .from(markingResultsTable)
        .where(and(inArray(markingResultsTable.submissionId, submissionIds), eq(markingResultsTable.needsTeacherReview, true)))
    : [];
  const needsReview = new Set(flagged.map((row) => row.submissionId));

  const assignmentById = new Map(assignments.map((assignment) => [assignment.id, assignment]));
  const results = new Map<string, ResultEntry[]>();
  const submittedByLearner = new Map<string, Set<string>>();
  const belowRed = new Set<string>();

  for (const submission of submissions) {
    const assignment = assignmentById.get(submission.assignmentId);
    if (!assignment) continue;
    // Published, released, fully marked, not held for review and not flagged:
    // anything else is invisible to a zone.
    if (!assignment.isPublished) continue;
    if (submission.markingStatus !== "MARKED") continue;
    if (!submissionResultsVisible(assignment, submission, now)) continue;
    if (needsReview.has(submission.id)) continue;
    // Inside the term, once a term is confirmed.
    if (term) {
      const start = termRows.find((row) => row.id === term.id)?.startDate;
      const end = termRows.find((row) => row.id === term.id)?.endDate;
      if (start && submission.submittedAt.getTime() < start.getTime()) continue;
      if (end && submission.submittedAt.getTime() > end.getTime()) continue;
    }
    const list = results.get(submission.learnerId) ?? [];
    list.push({ score: submission.score, formal: assignment.isFormal, submittedAt: submission.submittedAt });
    results.set(submission.learnerId, list);

    const seen = submittedByLearner.get(submission.learnerId) ?? new Set<string>();
    seen.add(submission.assignmentId);
    submittedByLearner.set(submission.learnerId, seen);
  }

  // Missed work: published, closed, after the learner joined, and never
  // submitted. Counted as a run of consecutive misses, never as a zero score.
  const missed = new Map<string, boolean[]>();
  const closed = assignments
    .filter((assignment) => assignment.isPublished && assignment.closeAt.getTime() < now.getTime())
    .sort((a, b) => b.closeAt.getTime() - a.closeAt.getTime());
  for (const learnerId of learnerIds) {
    const joinedAt = joinedById.get(learnerId) ?? classRow.createdAt;
    const submitted = submittedByLearner.get(learnerId) ?? new Set<string>();
    missed.set(
      learnerId,
      closed
        .filter((assignment) => assignment.closeAt.getTime() >= joinedAt.getTime())
        .map((assignment) => !submitted.has(assignment.id)),
    );
  }

  for (const [learnerId, list] of results) {
    const ordered = [...list].sort((a, b) => b.submittedAt.getTime() - a.submittedAt.getTime());
    if (twoMostRecentBelowRed(ordered, settings)) belowRed.add(learnerId);
  }

  return { classRow, settings, term, learners, results, missed, belowRed };
}

// The one entry point both the teacher and the HOD use. No caller re-implements
// the window, the weighting, the trend or the missed run.
export async function computeClassZones(classId: string, now: Date = new Date()): Promise<ClassZoneReport | null> {
  const [classRow] = await db.select().from(classesTable).where(eq(classesTable.id, classId)).limit(1);
  if (!classRow) return null;
  const data = await loadZoneData(classRow, now);

  const learners = data.learners.map((learner) =>
    computeLearnerZone({
      learnerId: learner.id,
      learnerName: learner.fullName,
      results: data.results.get(learner.id) ?? [],
      missedNewestFirst: data.missed.get(learner.id) ?? [],
      settings: data.settings,
    }),
  );

  return {
    classId,
    settings: data.settings,
    term: data.term,
    learners,
    counts: countZones(learners),
    priority: priorityOrder(learners),
    classAverage: classZoneAverage(learners),
  };
}

// Learners whose two most recent results are both below the red line. Returned
// separately because the alert is stored, not just displayed.
export async function learnersBelowRed(classId: string, now: Date = new Date()): Promise<Set<string>> {
  const [classRow] = await db.select().from(classesTable).where(eq(classesTable.id, classId)).limit(1);
  if (!classRow) return new Set();
  const data = await loadZoneData(classRow, now);
  return data.belowRed;
}

// Raise or clear the stored alerts so the class screen can show them. Kept
// idempotent: an alert that is already active is left alone, and one that no
// longer applies is cleared rather than deleted, so the history survives.
export async function syncZoneAlerts(classId: string, now: Date = new Date()): Promise<void> {
  const belowRed = await learnersBelowRed(classId, now);
  const existing = await db.select().from(zoneAlertsTable).where(eq(zoneAlertsTable.classId, classId));
  const existingByLearner = new Map(existing.map((row) => [row.learnerId, row]));

  for (const learnerId of belowRed) {
    const row = existingByLearner.get(learnerId);
    if (!row) {
      await db.insert(zoneAlertsTable).values({
        classId,
        learnerId,
        kind: "TWO_BELOW_RED",
        detail: "The two most recent released results are both below the red line.",
        active: true,
      });
    } else if (!row.active) {
      await db
        .update(zoneAlertsTable)
        .set({ active: true, raisedAt: now, clearedAt: null })
        .where(eq(zoneAlertsTable.id, row.id));
    }
  }

  for (const row of existing) {
    if (row.active && !belowRed.has(row.learnerId)) {
      await db.update(zoneAlertsTable).set({ active: false, clearedAt: now }).where(eq(zoneAlertsTable.id, row.id));
    }
  }
}

export async function activeZoneAlerts(classId: string) {
  return db
    .select({
      id: zoneAlertsTable.id,
      learnerId: zoneAlertsTable.learnerId,
      learnerName: learnersTable.fullName,
      kind: zoneAlertsTable.kind,
      detail: zoneAlertsTable.detail,
      raisedAt: zoneAlertsTable.raisedAt,
    })
    .from(zoneAlertsTable)
    .innerJoin(learnersTable, eq(learnersTable.id, zoneAlertsTable.learnerId))
    .where(and(eq(zoneAlertsTable.classId, classId), eq(zoneAlertsTable.active, true)));
}

// The share of red learners who have an intervention logged. Used by the HOD
// view, which sees the number and never the learner behind it.
export async function interventionShare(classId: string, learners: LearnerZone[]): Promise<{ red: number; withIntervention: number; share: number | null }> {
  const red = learners.filter((learner) => learner.zone === "red");
  if (!red.length) return { red: 0, withIntervention: 0, share: null };
  const logged = await db
    .select({ learnerId: interventionsTable.learnerId })
    .from(interventionsTable)
    .where(and(eq(interventionsTable.classId, classId), inArray(interventionsTable.learnerId, red.map((learner) => learner.learnerId))));
  const withIntervention = new Set(logged.map((row) => row.learnerId)).size;
  return { red: red.length, withIntervention, share: Math.round((withIntervention / red.length) * 100) };
}

export async function classInterventions(classId: string, learnerId: string) {
  return db
    .select()
    .from(interventionsTable)
    .where(and(eq(interventionsTable.classId, classId), eq(interventionsTable.learnerId, learnerId)))
    .orderBy(interventionsTable.interventionDate);
}

// ---- Placeholder terms ------------------------------------------------------
// Seeded once, clearly marked "to be confirmed". These are NOT official dates
// and the service ignores them until someone confirms them, so nothing about a
// learner's zone changes just because a placeholder exists.
export async function seedPlaceholderTerms(now: Date = new Date()): Promise<number> {
  const year = now.getFullYear();
  const [existing] = await db.select({ id: termsTable.id }).from(termsTable).limit(1);
  if (existing) return 0;
  const bounds = [
    { termNo: 1, start: [0, 15], end: [2, 31] },
    { termNo: 2, start: [3, 1], end: [5, 30] },
    { termNo: 3, start: [6, 1], end: [8, 30] },
    { termNo: 4, start: [9, 1], end: [11, 15] },
  ];
  for (const bound of bounds) {
    await db.insert(termsTable).values({
      year,
      termNo: bound.termNo,
      startDate: new Date(Date.UTC(year, bound.start[0], bound.start[1])),
      endDate: new Date(Date.UTC(year, bound.end[0], bound.end[1], 23, 59, 59)),
      status: "to be confirmed",
      note: "Placeholder dates only — confirm against the official school calendar before relying on them.",
    });
  }
  return bounds.length;
}

// ---- HOD view: counts only --------------------------------------------------
// No learner name and no learner id leaves this function. That is the whole
// point: an HOD sees how many, never who.

export type HodZoneSummary = {
  counts: ZoneCounts;
  classAverage: number | null;
  // Change since the last term, in points. Null when there is nothing to compare.
  changeSinceLastTerm: number | null;
  intervention: { red: number; withIntervention: number; share: number | null };
  term: { label: string; status: string } | null;
};

export async function hodZoneSummary(classId: string, now: Date = new Date()): Promise<HodZoneSummary | null> {
  const report = await computeClassZones(classId, now);
  if (!report) return null;
  const previous = await previousTermAverage(classId, now);
  return {
    counts: report.counts,
    classAverage: report.classAverage,
    changeSinceLastTerm:
      report.classAverage !== null && previous !== null ? round1(report.classAverage - previous) : null,
    intervention: await interventionShare(classId, report.learners),
    term: report.term ? { label: report.term.label, status: report.term.status } : null,
  };
}

// The class average over the most recent CONFIRMED term that has already ended.
// Without a confirmed term there is no previous period, so the change is unknown
// rather than invented.
async function previousTermAverage(classId: string, now: Date): Promise<number | null> {
  const termRows = (await db.select().from(termsTable))
    .filter((row) => row.status === "confirmed" && row.endDate.getTime() < now.getTime())
    .sort((a, b) => b.endDate.getTime() - a.endDate.getTime());
  const [previousTerm] = termRows;
  if (!previousTerm) return null;

  const [classRow] = await db.select().from(classesTable).where(eq(classesTable.id, classId)).limit(1);
  if (!classRow) return null;
  const data = await loadZoneData(classRow, now);

  const scores: number[] = [];
  for (const [, list] of data.results) {
    const inTerm = list.filter(
      (entry) =>
        entry.submittedAt.getTime() >= previousTerm.startDate.getTime()
        && entry.submittedAt.getTime() <= previousTerm.endDate.getTime(),
    );
    const average = weightedAverage(inTerm, data.settings.formalWeight);
    if (average !== null) scores.push(average);
  }
  if (!scores.length) return null;
  return round1(scores.reduce((total, score) => total + score, 0) / scores.length);
}

// ---- Zone settings ----------------------------------------------------------
// The class cut-offs. The teacher and a linked HOD both call this, so a cut-off
// change goes through one audited path. Every change records the OLD and the NEW
// values, because a cut-off change re-bands every learner in the class.

export type ZoneSettingKey = "greenMin" | "yellowMin" | "minResults" | "windowSize" | "formalWeight" | "trendDropFlag" | "missedInRowFlag";

export async function changeZoneSettings(
  classRow: { id: string; subject: string; grade: number; section: string },
  actorUserId: string,
  actorRole: string,
  changes: Partial<Record<ZoneSettingKey, number>>,
): Promise<{ error: string } | { settings: typeof zoneSettingsTable.$inferSelect }> {
  const [existing] = await db.select().from(zoneSettingsTable).where(eq(zoneSettingsTable.classId, classRow.id)).limit(1);
  const before = resolveZoneSettings(existing);
  const after = { ...before, ...changes };
  if (after.yellowMin >= after.greenMin) return { error: "The yellow floor must be below the green line." };

  const [row] = await db
    .insert(zoneSettingsTable)
    .values({ classId: classRow.id, ...after, updatedBy: actorUserId })
    .onConflictDoUpdate({
      target: zoneSettingsTable.classId,
      set: { ...after, updatedBy: actorUserId, updatedAt: new Date() },
    })
    .returning();

  await recordAudit({
    actorUserId,
    actorRole,
    action: "zone_settings_change",
    classId: classRow.id,
    detail: `Zone cut-offs for ${classRow.subject} (grade ${classRow.grade}${classRow.section || ""}) changed from ${JSON.stringify(before)} to ${JSON.stringify(after)}.`,
  });
  return { settings: row };
}

export async function classZoneSettings(classId: string) {
  const [existing] = await db.select().from(zoneSettingsTable).where(eq(zoneSettingsTable.classId, classId)).limit(1);
  return { resolved: resolveZoneSettings(existing), row: existing ?? null };
}

// ---- Learner safety ---------------------------------------------------------
// A learner's own payloads must never carry zone data. This is the single guard
// every learner-facing serializer can lean on, and it is asserted in the tests.
export function stripZoneFields<T extends Record<string, unknown>>(payload: T): T {
  const clone: Record<string, unknown> = { ...payload };
  for (const key of ["zone", "zones", "score", "trend", "earlyWarning", "engagementFlag", "zoneScore", "resultCount"]) {
    delete clone[key];
  }
  return clone as T;
}

export async function countActiveAlerts(classId: string): Promise<number> {
  const rows = await db
    .select({ id: zoneAlertsTable.id })
    .from(zoneAlertsTable)
    .where(and(eq(zoneAlertsTable.classId, classId), eq(zoneAlertsTable.active, true), isNull(zoneAlertsTable.clearedAt)));
  return rows.length;
}
