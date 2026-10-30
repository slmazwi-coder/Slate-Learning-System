import { and, desc, eq, gte, isNotNull, isNull, lt, lte, or } from "drizzle-orm";
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
// How long a worker may hold an attempt while it persists the paper. A lease
// that runs out is treated as a crashed worker, so the attempt is retried
// instead of being stuck in PROCESSING forever.
export const FOCUS_AUTO_SUBMIT_LEASE_SECONDS = 120;
// After this many failed tries the attempt stops retrying automatically and the
// teacher is alerted instead, so a permanently broken paper cannot spin.
export const FOCUS_AUTO_SUBMIT_MAX_ATTEMPTS = 5;

export type AutoSubmitReason = "FOCUS_EXIT_LIMIT" | "FOCUS_AWAY_TIMEOUT";

// The state of the attempt's automatic submit. PENDING covers "nothing tried
// yet" and "open again after a teacher reopen"; DONE means a paper exists.
export type FocusAutoSubmitState = "PENDING" | "PROCESSING" | "DONE" | "FAILED";

// Why the last automatic submit did not persist. A short code, never a raw
// provider message and never anything the learner wrote.
export type FocusAutoSubmitErrorCode = "GEMINI_UNAVAILABLE" | "MARKING_FAILED" | "PERSIST_FAILED";

// What the routes report to the learner. `autoSubmitted` is true only when a
// paper exists; otherwise the learner is told whether a retry is coming.
export type FocusSubmitStatus = "submitted" | "processing" | "failed_retryable";

export function submitStatusFor(input: { submissionId: string | null; state: FocusAutoSubmitState }): FocusSubmitStatus {
  if (input.submissionId) return "submitted";
  if (input.state === "PROCESSING") return "processing";
  return "failed_retryable";
}

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
  // The state machine's view of the automatic submit: PENDING, PROCESSING,
  // DONE or FAILED. `autoSubmitted` is only ever true for DONE.
  autoSubmitState: FocusAutoSubmitState;
  // How many times the automatic submit has been tried, and whether it is still
  // going to be retried.
  autoSubmitAttempts: number;
  retryable: boolean;
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
  // A paper is the only proof of a submission, so the state machine is the
  // authority and `autoSubmitted` is true only for DONE.
  const autoSubmitted = focusAutoSubmitStateOf(session) === "DONE";
  const state = focusAutoSubmitStateOf(session);
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
    autoSubmitState: state,
    autoSubmitAttempts: session.focusAutoSubmitAttempts,
    // A failed attempt is still recoverable until it has burned every try.
    retryable: !autoSubmitted && session.focusAutoSubmitAttempts < FOCUS_AUTO_SUBMIT_MAX_ATTEMPTS,
    // A warning is outstanding while the learner has been warned more times than
    // they have acknowledged by tapping to continue.
    requiresAcknowledgement: !autoSubmitted && session.focusWarningCount > session.focusAcknowledgedWarnings,
  };
}

// The state machine's state for a session row. DONE means a paper exists, which
// is the only thing that proves a submission: a row carrying an auto-submit
// timestamp but no paper is the stranded state the old claim could leave, so it
// is reported as FAILED and made recoverable rather than pretending to be done.
export function focusAutoSubmitStateOf(session: typeof assignmentSessionsTable.$inferSelect): FocusAutoSubmitState {
  if (session.focusSubmissionId) return "DONE";
  if (session.focusAutoSubmittedAt) return "FAILED";
  const state = session.focusAutoSubmitState as FocusAutoSubmitState | null;
  if (state === "PROCESSING" || state === "FAILED" || state === "DONE") return state;
  return "PENDING";
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
  if (focusAutoSubmitStateOf(session) === "DONE") return { expired: false, deadline: null };
  if (!session.focusDeadlineAt) return { expired: false, deadline: null };
  if (now.getTime() < session.focusDeadlineAt.getTime()) return { expired: false, deadline: session.focusDeadlineAt };
  return { expired: true, deadline: session.focusDeadlineAt };
}

// Whether the attempt's automatic submit should be attempted right now. This is
// what the lazy check and the cron sweep both ask, so the two can never disagree.
//
//   PENDING            nothing tried yet — the attempt is due
//   PROCESSING         a worker holds the lease — due only if the lease expired
//                      (a crashed worker must not strand the paper)
//   FAILED             a try failed — due again while tries remain
//   DONE               a paper exists — never due
export function autoSubmitDue(
  session: typeof assignmentSessionsTable.$inferSelect,
  now: Date = new Date(),
): { due: boolean; reason: "fresh" | "retry" | "lease_expired" | null } {
  const state = focusAutoSubmitStateOf(session);
  if (state === "DONE") return { due: false, reason: null };
  if (session.focusAutoSubmitAttempts >= FOCUS_AUTO_SUBMIT_MAX_ATTEMPTS) {
    // Out of tries: the teacher has been alerted and must reopen or release.
    return { due: false, reason: null };
  }
  if (state === "PROCESSING") {
    const lease = session.focusAutoSubmitLeaseUntil;
    if (lease && lease.getTime() > now.getTime()) return { due: false, reason: null };
    return { due: true, reason: "lease_expired" };
  }
  if (state === "FAILED") return { due: true, reason: "retry" };
  return { due: true, reason: "fresh" };
}

// Maps a failure to the short code stored on the attempt. Only the class of
// failure is kept — never the provider's message, and never an answer.
export function autoSubmitErrorCode(error: unknown): FocusAutoSubmitErrorCode {
  const name = error instanceof Error ? error.name : "";
  if (name === "GeminiUnavailableError") return "GEMINI_UNAVAILABLE";
  if (name === "MarkingFailedError") return "MARKING_FAILED";
  return "PERSIST_FAILED";
}

// The result of trying to end an attempt by focus mode. Callers must branch on
// `outcome`, never on `autoSubmitted` alone: `FAILED` means nothing was
// persisted and the attempt is recoverable, so the learner can still hand in.
export type AutoSubmitOutcome =
  | { outcome: "SUBMITTED"; submissionId: string; attempts: number }
  | { outcome: "ALREADY_SUBMITTED"; submissionId: string; attempts: number }
  | { outcome: "PROCESSING"; submissionId: null; attempts: number }
  | { outcome: "FAILED"; error: string; errorCode: FocusAutoSubmitErrorCode; attempts: number; retryable: boolean; submissionId: null };

// Auto-submits an attempt that focus mode has ended, reusing the normal submit
// and marking pipeline so the paper is marked exactly like a manual submit. The
// learner's autosaved draft answers are the ones that get marked; nothing is
// lost.
//
// The attempt is claimed by setting state=PROCESSING with a lease, in one
// conditional UPDATE so two concurrent requests cannot both win. On success the
// state becomes DONE and the submission id is stored on the session. On failure
// the state becomes FAILED and the deadline is left alone, so the lazy check,
// the cron sweep or a manual retry picks the attempt up again. The unique index
// on slate_submissions(session_id) is the final guard: even if two workers raced
// past the lease, only one paper can exist.
export async function autoSubmitAttempt(entry: {
  learnerId: string;
  session: typeof assignmentSessionsTable.$inferSelect;
  assignment: typeof assignmentsTable.$inferSelect;
  classRow: typeof classesTable.$inferSelect | null;
  reason: AutoSubmitReason;
  logger?: Pick<Logger, "error" | "warn">;
  at?: Date;
  now?: Date;
}): Promise<AutoSubmitOutcome> {
  const { session, assignment } = entry;
  const now = entry.now ?? new Date();
  if (focusAutoSubmitStateOf(session) === "DONE") {
    // Already ended. Report the paper that exists rather than claiming a fresh
    // attempt, so a duplicate request is never reported as new work.
    const existing = session.focusSubmissionId ?? await submissionIdFor(entry.learnerId, assignment.id, session.id);
    if (existing) return { outcome: "ALREADY_SUBMITTED", submissionId: existing, attempts: session.focusAutoSubmitAttempts };
  }

  const due = autoSubmitDue(session, now);
  if (!due.due) {
    // Either a worker is mid-flight, or the attempt has used every try. Both are
    // reported as PROCESSING/FAILED rather than as success.
    const state = focusAutoSubmitStateOf(session);
    if (state === "PROCESSING") {
      return { outcome: "PROCESSING", submissionId: null, attempts: session.focusAutoSubmitAttempts };
    }
    return {
      outcome: "FAILED",
      error: session.focusAutoSubmitLastError ?? "Auto-submit could not be completed.",
      errorCode: (session.focusAutoSubmitLastError as FocusAutoSubmitErrorCode) ?? "PERSIST_FAILED",
      attempts: session.focusAutoSubmitAttempts,
      retryable: false,
      submissionId: null,
    };
  }

  // Remember the deadline so a failed attempt can be put back exactly as it was:
  // a timeout keeps its expired deadline (so the sweep retries it), while an
  // exit-limit attempt had no countdown and must not be given one.
  const priorDeadline = session.focusDeadlineAt;
  const leaseUntil = new Date(now.getTime() + FOCUS_AUTO_SUBMIT_LEASE_SECONDS * 1000);
  // Claim the attempt. The WHERE clause is what makes this safe: only a row that
  // is still due can be claimed, so the second of two racing requests matches
  // nothing and reports PROCESSING instead of submitting again.
  const claimable = and(
    eq(assignmentSessionsTable.id, session.id),
    isNull(assignmentSessionsTable.focusSubmissionId),
    or(
      isNull(assignmentSessionsTable.focusAutoSubmitState),
      eq(assignmentSessionsTable.focusAutoSubmitState, "PENDING"),
      eq(assignmentSessionsTable.focusAutoSubmitState, "FAILED"),
      // A row marked DONE with no paper is the stranded state the old claim left
      // behind: it must be re-claimable so the work is not lost.
      eq(assignmentSessionsTable.focusAutoSubmitState, "DONE"),
      and(
        eq(assignmentSessionsTable.focusAutoSubmitState, "PROCESSING"),
        or(
          isNull(assignmentSessionsTable.focusAutoSubmitLeaseUntil),
          lte(assignmentSessionsTable.focusAutoSubmitLeaseUntil, now),
        ),
      ),
    ),
  );
  const [claimed] = await db
    .update(assignmentSessionsTable)
    .set({
      focusAutoSubmitState: "PROCESSING",
      focusAutoSubmitLeaseUntil: leaseUntil,
      focusAutoSubmitAttempts: session.focusAutoSubmitAttempts + 1,
      focusAutoSubmitLastError: null,
      focusAwaySince: null,
    })
    .where(claimable)
    .returning();
  const attempts = claimed?.focusAutoSubmitAttempts ?? session.focusAutoSubmitAttempts + 1;
  if (!claimed) {
    // Another worker won the claim while this one was in flight.
    const existing = await submissionIdFor(entry.learnerId, assignment.id, session.id);
    if (existing) return { outcome: "ALREADY_SUBMITTED", submissionId: existing, attempts: session.focusAutoSubmitAttempts };
    return { outcome: "PROCESSING", submissionId: null, attempts: session.focusAutoSubmitAttempts };
  }

  // A paper may already exist (e.g. the learner submitted while a stale
  // countdown was still set). Keep it: re-running the pipeline would create a
  // second row for the same attempt.
  const alreadyPersisted = session.focusSubmissionId ?? await submissionIdFor(entry.learnerId, assignment.id, session.id);
  if (alreadyPersisted) {
    await markAutoSubmitDone(session.id, alreadyPersisted, entry.at ?? now);
    return { outcome: "ALREADY_SUBMITTED", submissionId: alreadyPersisted, attempts };
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
    await markAutoSubmitDone(session.id, outcome.submissionId, entry.at ?? now);
    return { outcome: "SUBMITTED", submissionId: outcome.submissionId, attempts };
  } catch (error) {
    // The pipeline may have saved the paper before a later step failed. If a
    // submission exists the learner's work is safe, so record it as done rather
    // than inviting a second submission.
    const persisted = await submissionIdFor(entry.learnerId, assignment.id, session.id);
    if (persisted) {
      entry.logger?.error({ err: error, sessionId: session.id, learnerId: entry.learnerId }, "focus auto-submit failed after the paper was saved");
      await markAutoSubmitDone(session.id, persisted, entry.at ?? now);
      return { outcome: "SUBMITTED", submissionId: persisted, attempts };
    }
    // Nothing was persisted, so the attempt must stay recoverable. Move to FAILED
    // and keep the deadline exactly as it was, so the next touch retries. Only
    // ids and a short error code are stored and logged — never an answer.
    const errorCode = autoSubmitErrorCode(error);
    const retryable = attempts < FOCUS_AUTO_SUBMIT_MAX_ATTEMPTS;
    entry.logger?.error({ err: error, sessionId: session.id, learnerId: entry.learnerId, errorCode, attempts, retryable }, "focus auto-submit did not persist; attempt left recoverable");
    await db
      .update(assignmentSessionsTable)
      .set({
        focusAutoSubmitState: "FAILED",
        focusAutoSubmitLastError: errorCode,
        focusAutoSubmitLeaseUntil: null,
        focusDeadlineAt: priorDeadline,
      })
      .where(eq(assignmentSessionsTable.id, session.id));
    return { outcome: "FAILED", error: error instanceof Error ? error.message : "Auto-submit failed.", errorCode, attempts, retryable, submissionId: null };
  }
}

// Marks an attempt finished and records the paper it produced, in one place so
// the state and the id can never drift apart.
async function markAutoSubmitDone(sessionId: string, submissionId: string, at: Date) {
  await db
    .update(assignmentSessionsTable)
    .set({
      focusAutoSubmitState: "DONE",
      focusSubmissionId: submissionId,
      // Timestamped at the real deadline when the caller knows it, not at the
      // moment the lazy check happened to notice.
      focusAutoSubmittedAt: at,
      focusAutoSubmitLeaseUntil: null,
      focusAutoSubmitLastError: null,
      focusDeadlineAt: null,
      focusAwaySince: null,
    })
    .where(eq(assignmentSessionsTable.id, sessionId));
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

// Attempts whose automatic submit still needs doing: nothing tried yet, a try
// that failed, or a worker that went away holding the lease. Ordered oldest
// first so a long-stuck paper is retried before a fresh one.
//
// `now` is passed in rather than read here so the cron sweep and the lazy check
// evaluate the lease against the same instant.
export async function autoSubmitBacklog(now: Date = new Date(), limit = 100) {
  return db
    .select()
    .from(assignmentSessionsTable)
    .where(and(
      // Nothing to do once a paper exists. focusAutoSubmittedAt is deliberately
      // not used here: a stranded row (timestamp, no paper) must still be swept.
      isNull(assignmentSessionsTable.focusSubmissionId),
      // A retry is only for an attempt focus mode actually ended.
      isNotNull(assignmentSessionsTable.focusDeadlineAt),
      // Tries remain.
      lt(assignmentSessionsTable.focusAutoSubmitAttempts, FOCUS_AUTO_SUBMIT_MAX_ATTEMPTS),
      or(
        isNull(assignmentSessionsTable.focusAutoSubmitState),
        eq(assignmentSessionsTable.focusAutoSubmitState, "PENDING"),
        eq(assignmentSessionsTable.focusAutoSubmitState, "FAILED"),
        // A PROCESSING row whose lease has run out belongs to a worker that died.
        and(
          eq(assignmentSessionsTable.focusAutoSubmitState, "PROCESSING"),
          or(
            isNull(assignmentSessionsTable.focusAutoSubmitLeaseUntil),
            lte(assignmentSessionsTable.focusAutoSubmitLeaseUntil, now),
          ),
        ),
      ),
    ))
    .orderBy(assignmentSessionsTable.focusDeadlineAt)
    .limit(limit);
}

// Attempts that have used every try and still have no paper. These need a human:
// the teacher is told, and the learner is shown a retry prompt.
export async function autoSubmitExhausted(limit = 100) {
  return db
    .select()
    .from(assignmentSessionsTable)
    .where(and(
      isNull(assignmentSessionsTable.focusSubmissionId),
      gte(assignmentSessionsTable.focusAutoSubmitAttempts, FOCUS_AUTO_SUBMIT_MAX_ATTEMPTS),
      // Alert once per attempt: a row that has already been alerted is skipped.
      isNull(assignmentSessionsTable.focusAutoSubmitAlertedAt),
    ))
    .limit(limit);
}

// Records that the teacher has been told about an attempt whose automatic submit
// kept failing. The timestamp is what makes the alert fire once, not per sweep.
export async function markAutoSubmitAlerted(sessionId: string, at: Date = new Date()) {
  await db
    .update(assignmentSessionsTable)
    .set({ focusAutoSubmitAlertedAt: at })
    .where(eq(assignmentSessionsTable.id, sessionId));
}

// Attempts in a class whose automatic submit did not finish, for the teacher's
// focus view. A stuck attempt is one with no paper that either failed, is being
// retried, or has given up. Only ids, counts and codes are returned — never an
// answer.
export async function stuckAutoSubmitsForClass(classId: string, now: Date = new Date()) {
  const rows = await db
    .select({
      sessionId: assignmentSessionsTable.id,
      assignmentId: assignmentsTable.id,
      assignmentTitle: assignmentsTable.title,
      learnerId: assignmentSessionsTable.learnerId,
      learnerName: learnersTable.fullName,
      state: assignmentSessionsTable.focusAutoSubmitState,
      attempts: assignmentSessionsTable.focusAutoSubmitAttempts,
      lastError: assignmentSessionsTable.focusAutoSubmitLastError,
      deadlineAt: assignmentSessionsTable.focusDeadlineAt,
    })
    .from(assignmentSessionsTable)
    .innerJoin(assignmentsTable, eq(assignmentsTable.id, assignmentSessionsTable.assignmentId))
    .innerJoin(learnersTable, eq(learnersTable.id, assignmentSessionsTable.learnerId))
    .where(and(
      eq(assignmentsTable.classId, classId),
      isNull(assignmentSessionsTable.focusSubmissionId),
      isNotNull(assignmentSessionsTable.focusDeadlineAt),
      or(
        eq(assignmentSessionsTable.focusAutoSubmitState, "FAILED"),
        and(
          eq(assignmentSessionsTable.focusAutoSubmitState, "PROCESSING"),
          or(
            isNull(assignmentSessionsTable.focusAutoSubmitLeaseUntil),
            lte(assignmentSessionsTable.focusAutoSubmitLeaseUntil, now),
          ),
        ),
      ),
    ))
    .orderBy(desc(assignmentSessionsTable.focusAutoSubmitAttempts));
  return rows.map((row) => ({
    sessionId: row.sessionId,
    assignmentId: row.assignmentId,
    assignmentTitle: row.assignmentTitle,
    learnerId: row.learnerId,
    learnerName: row.learnerName,
    attempts: row.attempts,
    lastErrorCode: row.lastError,
    exhausted: row.attempts >= FOCUS_AUTO_SUBMIT_MAX_ATTEMPTS,
    deadlineAt: row.deadlineAt?.toISOString() ?? null,
  }));
}
