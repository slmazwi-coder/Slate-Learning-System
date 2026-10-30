import { and, desc, eq, gte, isNull } from "drizzle-orm";
import type { Logger } from "pino";
import { db } from "@workspace/db";
import {
  assignmentSessionsTable,
  assignmentsTable,
  classFocusExemptionsTable,
  classLearnersTable,
  classesTable,
  focusEventsTable,
  learnersTable,
  liveSessionsTable,
  submissionsTable,
} from "@workspace/db/schema";
import { markAndPersistSubmission } from "./submission-pipeline";
import type { GeneratedQuestion } from "./ai";

// Focus mode ("tab lock"). The learner's page reports when it becomes hidden or
// loses focus, and when it comes back. This module owns the rules; the client
// only ever reports events and reads the state the server hands back, so a
// modified client cannot extend a countdown or talk its way out of a warning.
//
// Privacy: a focus event records only when the learner left, when they came
// back and how long they were gone. Nothing else is observed or stored — no
// URLs, page titles, app names, screenshots, camera frames or keystrokes.

// Exits shorter than this are treated as accidental (a tab switch that came
// straight back) and ignored entirely.
export const FOCUS_EXIT_THRESHOLD_SECONDS = 10;
// How long the learner has to come back once an exit has counted.
export const FOCUS_RETURN_COUNTDOWN_SECONDS = 30;
// The third exit auto-submits, even if the learner returns in time.
export const FOCUS_MAX_WARNINGS = 3;

export type AutoSubmitReason = "FOCUS_EXIT_LIMIT" | "FOCUS_AWAY_TIMEOUT";

export type FocusModeState = {
  // Whether focus mode is armed for this attempt at all.
  enabled: boolean;
  // Alert-only (a live class session is running): away is reported to the
  // teacher, but there are no warnings and no auto-submit.
  alertOnly: boolean;
  // Exempt learners (e.g. assistive technology) are never warned.
  exempt: boolean;
  warningCount: number;
  maxWarnings: number;
  // When the learner is away, the deadline they must be back by.
  deadlineAt: string | null;
  awaySince: string | null;
  // Set once the attempt has been auto-submitted by focus mode.
  autoSubmitted: boolean;
  autoSubmitReason: AutoSubmitReason | null;
  // Whether the learner must acknowledge a warning before continuing.
  requiresAcknowledgement: boolean;
};

// A live session is "active" when it has been started and not yet ended.
export async function activeLiveSession(classId: string) {
  const [row] = await db
    .select()
    .from(liveSessionsTable)
    .where(and(eq(liveSessionsTable.classId, classId), isNull(liveSessionsTable.endedAt)))
    .orderBy(desc(liveSessionsTable.startedAt))
    .limit(1);
  return row ?? null;
}

export async function isLiveSessionActive(classId: string | null): Promise<boolean> {
  if (!classId) return false;
  return Boolean(await activeLiveSession(classId));
}

// Per-class, per-learner exemption. Only an explicit exempt=true row counts.
export async function isFocusExempt(classId: string | null, learnerId: string): Promise<boolean> {
  if (!classId) return false;
  const [row] = await db
    .select({ exempt: classFocusExemptionsTable.exempt })
    .from(classFocusExemptionsTable)
    .where(and(eq(classFocusExemptionsTable.classId, classId), eq(classFocusExemptionsTable.learnerId, learnerId)))
    .limit(1);
  return Boolean(row?.exempt);
}

// The live session running for a class the learner is enrolled in, if any.
// Used by the learner heartbeat and the focus routes to decide alert-only vs.
// locked mode.
export async function liveSessionForLearnerClass(learnerId: string): Promise<{ classId: string; sessionId: string } | null> {
  const rows = await db
    .select({ classId: liveSessionsTable.classId, sessionId: liveSessionsTable.id })
    .from(liveSessionsTable)
    .innerJoin(classLearnersTable, eq(classLearnersTable.classId, liveSessionsTable.classId))
    .where(and(isNull(liveSessionsTable.endedAt), eq(classLearnersTable.learnerId, learnerId)))
    .limit(1);
  return rows[0] ?? null;
}

export function focusStateFromSession(
  session: typeof assignmentSessionsTable.$inferSelect,
  options: { enabled: boolean; alertOnly: boolean; exempt: boolean; autoSubmitReason?: AutoSubmitReason | null },
): FocusModeState {
  const autoSubmitted = Boolean(session.focusAutoSubmittedAt);
  return {
    enabled: options.enabled,
    alertOnly: options.alertOnly,
    exempt: options.exempt,
    warningCount: session.focusWarningCount,
    maxWarnings: FOCUS_MAX_WARNINGS,
    deadlineAt: session.focusDeadlineAt?.toISOString() ?? null,
    awaySince: session.focusAwaySince?.toISOString() ?? null,
    autoSubmitted,
    autoSubmitReason: autoSubmitted ? (options.autoSubmitReason ?? null) : null,
    // A warning is outstanding while the learner has been warned more times than
    // they have acknowledged by tapping to continue.
    requiresAcknowledgement: !autoSubmitted && session.focusWarningCount > session.focusAcknowledgedWarnings,
  };
}

// Focus mode only locks homework. A live class session, an exemption, a
// disabled assignment or an already-auto-submitted attempt all mean "no lock".
export function lockApplies(state: { enabled: boolean; alertOnly: boolean; exempt: boolean; autoSubmitted: boolean }): boolean {
  return state.enabled && !state.alertOnly && !state.exempt && !state.autoSubmitted;
}

export type ExitDecision =
  | { kind: "IGNORED"; durationSeconds: number }
  | { kind: "ALERT_ONLY"; durationSeconds: number }
  | { kind: "WARNING"; durationSeconds: number; warningNumber: number }
  | { kind: "AUTO_SUBMIT"; durationSeconds: number; reason: AutoSubmitReason };

// Pure decision function for one completed exit. Kept separate from the route
// so the rules can be tested directly and cannot drift from the SQL writes.
export function decideExit(input: {
  durationSeconds: number;
  warningCount: number;
  lockApplies: boolean;
  alertOnly: boolean;
}): ExitDecision {
  const durationSeconds = Math.max(0, Math.round(input.durationSeconds));
  if (durationSeconds < FOCUS_EXIT_THRESHOLD_SECONDS) {
    return { kind: "IGNORED", durationSeconds };
  }
  // A live class session is alert-only: the teacher is told, nothing else happens.
  if (input.alertOnly) return { kind: "ALERT_ONLY", durationSeconds };
  if (!input.lockApplies) return { kind: "IGNORED", durationSeconds };
  const warningNumber = input.warningCount + 1;
  // The third exit ends the attempt outright, even though the learner is back.
  if (warningNumber >= FOCUS_MAX_WARNINGS) {
    return { kind: "AUTO_SUBMIT", durationSeconds, reason: "FOCUS_EXIT_LIMIT" };
  }
  return { kind: "WARNING", durationSeconds, warningNumber };
}

// Records one exit. Called with the times the client reported, but the duration
// is recomputed from those times so a client cannot under-report it.
export async function recordFocusEvent(entry: {
  learnerId: string;
  sessionId: string;
  submissionId?: string | null;
  leftAt: Date;
  returnedAt: Date | null;
  warningNumber: number;
  outcome: "IGNORED" | "WARNING" | "ALERT_ONLY" | "AUTO_SUBMITTED";
}) {
  const durationSeconds = entry.returnedAt
    ? Math.max(0, Math.round((entry.returnedAt.getTime() - entry.leftAt.getTime()) / 1000))
    : null;
  const [row] = await db
    .insert(focusEventsTable)
    .values({
      learnerId: entry.learnerId,
      sessionId: entry.sessionId,
      submissionId: entry.submissionId ?? null,
      leftAt: entry.leftAt,
      returnedAt: entry.returnedAt,
      durationSeconds,
      warningNumber: entry.warningNumber,
      outcome: entry.outcome,
    })
    .returning();
  return row;
}

// Lazy expiry. Vercel cannot hold a timer, so a countdown that ran out while
// nobody was watching is applied the next time any request touches the attempt.
// The outcome is timestamped at the deadline, not at the moment we noticed.
export type LazyExpiry = { expired: boolean; deadline: Date | null };

export function overdueDeadline(session: typeof assignmentSessionsTable.$inferSelect, now: Date = new Date()): LazyExpiry {
  if (!session.focusDeadlineAt || session.focusAutoSubmittedAt) return { expired: false, deadline: null };
  if (now.getTime() < session.focusDeadlineAt.getTime()) return { expired: false, deadline: session.focusDeadlineAt };
  return { expired: true, deadline: session.focusDeadlineAt };
}

// The result of trying to end an attempt by focus mode. Callers must branch on
// `outcome`, never on `autoSubmitted` alone: `FAILED` means nothing was
// persisted and the attempt is open again, so the learner can still hand in.
export type AutoSubmitOutcome =
  | { outcome: "SUBMITTED"; submissionId: string }
  | { outcome: "ALREADY_SUBMITTED"; submissionId: string | null }
  | { outcome: "FAILED"; error: string; submissionId: null };

// Auto-submits an attempt that focus mode has ended, reusing the normal submit
// and marking pipeline so the paper is marked exactly like a manual submit.
// The learner's autosaved draft answers are the ones that get marked; nothing is
// lost.
//
// Ordering matters. The claim on the session is what stops two concurrent
// requests from both submitting, so it has to come first — but a claim that is
// never released would strand the attempt forever. So the claim is released
// again unless a submission actually exists, which makes a retry safe:
//   - a genuine duplicate sees an existing submission and is reported as such;
//   - a retry after a persistence failure re-runs the pipeline and persists.
export async function autoSubmitAttempt(entry: {
  learnerId: string;
  session: typeof assignmentSessionsTable.$inferSelect;
  assignment: typeof assignmentsTable.$inferSelect;
  classRow: typeof classesTable.$inferSelect | null;
  reason: AutoSubmitReason;
  logger?: Pick<Logger, "error" | "warn">;
  at?: Date;
}): Promise<AutoSubmitOutcome> {
  const { session, assignment } = entry;
  if (session.focusAutoSubmittedAt) {
    // Already ended. Report the submission that exists rather than claiming a
    // fresh one, so a duplicate request is never reported as new work.
    const existing = await submissionIdFor(entry.learnerId, assignment.id, session.id);
    return { outcome: "ALREADY_SUBMITTED", submissionId: existing };
  }
  // Remember the deadline so a failed attempt can be put back exactly as it was:
  // a timeout keeps its expired deadline (so the sweep retries it), while an
  // exit-limit attempt had no countdown and must not be given one.
  const priorDeadline = session.focusDeadlineAt;
  // Guard the flag first so two concurrent requests cannot both submit.
  const [claimed] = await db
    .update(assignmentSessionsTable)
    .set({ focusAutoSubmittedAt: entry.at ?? new Date(), focusDeadlineAt: null, focusAwaySince: null })
    .where(and(eq(assignmentSessionsTable.id, session.id), isNull(assignmentSessionsTable.focusAutoSubmittedAt)))
    .returning();
  if (!claimed) {
    // Another request won the claim while this one was in flight.
    const existing = await submissionIdFor(entry.learnerId, assignment.id, session.id);
    return { outcome: "ALREADY_SUBMITTED", submissionId: existing };
  }

  // A submission may already exist (e.g. the learner submitted while a stale
  // countdown was still set). Keep it: re-running the pipeline would create a
  // second row for the same attempt.
  const alreadyPersisted = await submissionIdFor(entry.learnerId, assignment.id, session.id);
  if (alreadyPersisted) {
    return { outcome: "ALREADY_SUBMITTED", submissionId: alreadyPersisted };
  }

  const questions = session.questions as GeneratedQuestion[];
  const draft = session.focusDraftAnswers ?? [];
  const answers = questions.map((question) => ({
    questionId: question.id,
    answer: draft.find((entry) => entry.questionId === question.id)?.answer ?? "",
  }));
  try {
    const outcome = await markAndPersistSubmission({
      assignment,
      classRow: entry.classRow,
      learnerId: entry.learnerId,
      sessionId: session.id,
      questions,
      answers,
      autoSubmitted: true,
      autoSubmitReason: entry.reason,
      logger: entry.logger,
    });
    return { outcome: "SUBMITTED", submissionId: outcome.submissionId };
  } catch (error) {
    // The pipeline may have saved the paper before a later step failed. If a
    // submission exists the learner's work is safe, so report success and keep
    // the claim rather than inviting a second submission.
    const persisted = await submissionIdFor(entry.learnerId, assignment.id, session.id);
    if (persisted) {
      entry.logger?.error({ err: error, sessionId: session.id, learnerId: entry.learnerId }, "focus auto-submit failed after the paper was saved");
      return { outcome: "SUBMITTED", submissionId: persisted };
    }
    // Nothing was persisted, so the attempt must stay open. Release the claim and
    // restore the deadline exactly as it was, so the next touch (a heartbeat, a
    // page load or the cron sweep) retries instead of stranding the paper. Only
    // ids and the error message are logged — never the learner's answers.
    entry.logger?.error({ err: error, sessionId: session.id, learnerId: entry.learnerId }, "focus auto-submit persistence failed; claim released for retry");
    await db
      .update(assignmentSessionsTable)
      .set({ focusAutoSubmittedAt: null, focusDeadlineAt: priorDeadline })
      .where(eq(assignmentSessionsTable.id, session.id));
    return { outcome: "FAILED", error: error instanceof Error ? error.message : "Auto-submit failed.", submissionId: null };
  }
}

// The id of the submission already persisted for this attempt, if any. Scoped to
// the session as well as the learner so a fresh attempt after a teacher reopen
// is not mistaken for the old paper.
export async function submissionIdFor(learnerId: string, assignmentId: string, sessionId: string): Promise<string | null> {
  const [row] = await db
    .select({ id: submissionsTable.id })
    .from(submissionsTable)
    .where(and(
      eq(submissionsTable.assignmentId, assignmentId),
      eq(submissionsTable.learnerId, learnerId),
      eq(submissionsTable.sessionId, sessionId),
    ))
    .orderBy(desc(submissionsTable.submittedAt))
    .limit(1);
  return row?.id ?? null;
}

// The public, privacy-safe shape of an exit log for the teacher.
export function toPublicFocusEvent(row: typeof focusEventsTable.$inferSelect) {
  return {
    id: row.id,
    leftAt: row.leftAt.toISOString(),
    returnedAt: row.returnedAt?.toISOString() ?? null,
    durationSeconds: row.durationSeconds,
    warningNumber: row.warningNumber,
    outcome: row.outcome,
  };
}

export async function focusEventsForSession(sessionId: string) {
  const rows = await db
    .select()
    .from(focusEventsTable)
    .where(eq(focusEventsTable.sessionId, sessionId))
    .orderBy(focusEventsTable.leftAt);
  return rows.map(toPublicFocusEvent);
}

// Focus-mode alerts for a class: the exits seen since a live session started,
// each labelled with the learner's name so the teacher can act on it live.
export async function focusAlertsSince(classId: string, since: Date) {
  const rows = await db
    .select({
      id: focusEventsTable.id,
      learnerId: focusEventsTable.learnerId,
      learnerName: learnersTable.fullName,
      leftAt: focusEventsTable.leftAt,
      returnedAt: focusEventsTable.returnedAt,
      durationSeconds: focusEventsTable.durationSeconds,
      outcome: focusEventsTable.outcome,
    })
    .from(focusEventsTable)
    .innerJoin(learnersTable, eq(learnersTable.id, focusEventsTable.learnerId))
    .innerJoin(assignmentSessionsTable, eq(assignmentSessionsTable.id, focusEventsTable.sessionId))
    .innerJoin(assignmentsTable, eq(assignmentsTable.id, assignmentSessionsTable.assignmentId))
    .where(and(
      eq(assignmentsTable.classId, classId),
      gte(focusEventsTable.leftAt, since),
    ))
    .orderBy(desc(focusEventsTable.leftAt))
    .limit(50);
  return rows.map((row) => ({
    id: row.id,
    learnerId: row.learnerId,
    learnerName: row.learnerName,
    leftAt: row.leftAt.toISOString(),
    returnedAt: row.returnedAt?.toISOString() ?? null,
    durationSeconds: row.durationSeconds,
    outcome: row.outcome,
  }));
}

// The ids of learners who are exempt from focus mode in a class.
export async function focusExemptionsForClass(classId: string): Promise<Set<string>> {
  const rows = await db
    .select({ learnerId: classFocusExemptionsTable.learnerId })
    .from(classFocusExemptionsTable)
    .where(and(eq(classFocusExemptionsTable.classId, classId), eq(classFocusExemptionsTable.exempt, true)));
  return new Set(rows.map((row) => row.learnerId));
}

// The assignment row plus the class it belongs to, for a given attempt.
export async function attemptContext(session: typeof assignmentSessionsTable.$inferSelect) {
  const [assignment] = await db.select().from(assignmentsTable).where(eq(assignmentsTable.id, session.assignmentId)).limit(1);
  if (!assignment) return null;
  const classRow = assignment.classId
    ? (await db.select().from(classesTable).where(eq(classesTable.id, assignment.classId)).limit(1))[0] ?? null
    : null;
  return { assignment, classRow };
}
