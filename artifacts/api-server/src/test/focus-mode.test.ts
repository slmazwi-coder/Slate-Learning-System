import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { db, pool } from "@workspace/db";
import { auditLogTable, focusEventsTable, submissionsTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { ensureSchemaReady, resetDatabase, startTestServer, stopTestServer } from "./harness";
import { createPublishedAssignment, joinClass, memoAwareMarkingModel, registerLearner, registerTeacher, submitAssignment } from "./fixtures";
import { setGeminiModelForTesting } from "../lib/ai";
import {
  FOCUS_MAX_WARNINGS,
  decideExit,
  lockApplies,
  overdueDeadline,
} from "../lib/focus-mode";

// Focus mode ("tab lock"). The unit cases pin the pure decision rules; the
// integration cases drive the real routes so the SQL writes, the audit log and
// the teacher-only guards are all exercised.

describe("focus mode rules (unit)", () => {
  it("ignores an exit shorter than the threshold", () => {
    expect(decideExit({ durationSeconds: 3, warningCount: 0, lockApplies: true, alertOnly: false }).kind).toBe("IGNORED");
  });

  it("warns on the first exits and auto-submits on the last one", () => {
    const first = decideExit({ durationSeconds: 60, warningCount: 0, lockApplies: true, alertOnly: false });
    expect(first).toEqual({ kind: "WARNING", durationSeconds: 60, warningNumber: 1 });
    const last = decideExit({ durationSeconds: 60, warningCount: FOCUS_MAX_WARNINGS - 1, lockApplies: true, alertOnly: false });
    expect(last).toEqual({ kind: "AUTO_SUBMIT", durationSeconds: 60, reason: "FOCUS_EXIT_LIMIT" });
  });

  it("never warns or submits during a live class session", () => {
    const decision = decideExit({ durationSeconds: 600, warningCount: 99, lockApplies: false, alertOnly: true });
    expect(decision.kind).toBe("ALERT_ONLY");
  });

  it("only locks when focus mode is on, not alert-only, not exempt and not already submitted", () => {
    expect(lockApplies({ enabled: true, alertOnly: false, exempt: false, autoSubmitted: false })).toBe(true);
    expect(lockApplies({ enabled: false, alertOnly: false, exempt: false, autoSubmitted: false })).toBe(false);
    expect(lockApplies({ enabled: true, alertOnly: true, exempt: false, autoSubmitted: false })).toBe(false);
    expect(lockApplies({ enabled: true, alertOnly: false, exempt: true, autoSubmitted: false })).toBe(false);
    expect(lockApplies({ enabled: true, alertOnly: false, exempt: false, autoSubmitted: true })).toBe(false);
  });

  it("treats a countdown that ran out in the background as expired, and a live one as not", () => {
    const base = { focusDeadlineAt: null as Date | null, focusAutoSubmittedAt: null as Date | null, focusSubmissionId: null as string | null };
    const past = new Date(Date.now() - 1000);
    const future = new Date(Date.now() + 60_000);
    expect(overdueDeadline({ ...base, focusDeadlineAt: past } as any).expired).toBe(true);
    expect(overdueDeadline({ ...base, focusDeadlineAt: future } as any).expired).toBe(false);
    // No deadline at all, or a paper that already exists: nothing to apply.
    expect(overdueDeadline({ ...base } as any).expired).toBe(false);
    expect(overdueDeadline({ ...base, focusDeadlineAt: past, focusSubmissionId: "sub-1" } as any).expired).toBe(false);
    // A stranded attempt (an auto-submit timestamp but no paper) is NOT done, so
    // its overdue deadline still applies and the attempt is retried.
    expect(overdueDeadline({ ...base, focusDeadlineAt: past, focusAutoSubmittedAt: past } as any).expired).toBe(true);
  });
});

describe("focus mode over HTTP", () => {
  beforeAll(async () => {
    await startTestServer();
    await ensureSchemaReady();
  });
  afterAll(async () => { await stopTestServer(); });
  beforeEach(async () => { await resetDatabase(); });

  // Teacher + class + one learner, with a focus-locked published assignment.
  async function setup() {
    const teacher = await registerTeacher();
    const classId = teacher.classes[0].id;
    const learner = await registerLearner();
    await joinClass(learner.client, teacher.classes[0].joinCode);
    const { assignmentId, questions } = await createPublishedAssignment(teacher.client, classId);
    const opened = await learner.client.post(`/api/assignments/${assignmentId}/open`, {});
    expect(opened.status).toBe(200);
    return { teacher, classId, learner, assignmentId, questions, sessionId: opened.body.sessionId as string };
  }

  const state = (c: any, assignmentId: string, sessionId: string) =>
    c.post(`/api/assignments/${assignmentId}/focus/state`, { sessionId });
  const left = (c: any, assignmentId: string, sessionId: string) =>
    c.post(`/api/assignments/${assignmentId}/focus/left`, { sessionId });
  const returned = (c: any, assignmentId: string, sessionId: string) =>
    c.post(`/api/assignments/${assignmentId}/focus/returned`, { sessionId });

  it("reports focus-locked state to the learner and records nothing for a brief exit", async () => {
    const { learner, assignmentId, sessionId } = await setup();
    const initial = await state(learner.client, assignmentId, sessionId);
    expect(initial.status).toBe(200);
    expect(initial.body.state.enabled).toBe(true);
    expect(initial.body.state.alertOnly).toBe(false);
    expect(initial.body.state.maxWarnings).toBe(FOCUS_MAX_WARNINGS);

    const exit = await left(learner.client, assignmentId, sessionId);
    expect(exit.body.armed).toBe(true);
    expect(exit.body.thresholdSeconds).toBeGreaterThan(0);
    expect(exit.body.deadlineAt).toBeTruthy();

    // A brief return (under the threshold) is ignored: no warning, no event.
    const back = await returned(learner.client, assignmentId, sessionId);
    expect(back.body.autoSubmitted).toBe(false);
    expect(back.body.state.warningCount).toBe(0);
    const events = await db.select().from(focusEventsTable).where(eq(focusEventsTable.sessionId, sessionId));
    expect(events).toHaveLength(1);
    expect(events[0].outcome).toBe("IGNORED");
  });

  it("warns on a long exit, blocks the page until acknowledged, then auto-submits on the final exit", async () => {
    const { learner, assignmentId, sessionId } = await setup();
    // Push the recorded away-time back so the server sees a long absence
    // without the test sleeping. The server recomputes the duration from its
    // own stamp, which is the point of storing it server-side.
    async function longExit() {
      await left(learner.client, assignmentId, sessionId);
      await pool.query(`update slate_assignment_sessions set focus_away_since = now() - interval '2 minutes' where id = $1`, [sessionId]);
      return returned(learner.client, assignmentId, sessionId);
    }

    const first = await longExit();
    expect(first.body.autoSubmitted).toBe(false);
    expect(first.body.state.warningCount).toBe(1);
    expect(first.body.state.requiresAcknowledgement).toBe(true);

    // Acknowledging clears the block.
    const acked = await learner.client.post(`/api/assignments/${assignmentId}/focus/acknowledge`, { sessionId });
    expect(acked.body.state.requiresAcknowledgement).toBe(false);

    const second = await longExit();
    expect(second.body.state.warningCount).toBe(2);

    const third = await longExit();
    expect(third.body.autoSubmitted).toBe(true);
    expect(third.body.submissionId).toBeTruthy();

    // The paper is submitted and marked through the normal pipeline.
    const review = await learner.client.get(`/api/assignments/${assignmentId}/review`);
    expect([200, 403, 404]).toContain(review.status);
    const events = await db.select().from(focusEventsTable).where(eq(focusEventsTable.sessionId, sessionId));
    expect(events.map((event) => event.outcome)).toContain("AUTO_SUBMITTED");
  });

  it("makes focus mode alert-only while a live class session runs, and audits start/end", async () => {
    const { teacher, classId, learner, assignmentId, sessionId } = await setup();
    const started = await teacher.client.post(`/api/tis/classes/${classId}/live-session/start`, {});
    expect(started.status).toBe(201);

    const initial = await state(learner.client, assignmentId, sessionId);
    expect(initial.body.state.alertOnly).toBe(true);

    // Even a very long exit is only reported during a live class.
    await left(learner.client, assignmentId, sessionId);
    await pool.query(`update slate_assignment_sessions set focus_away_since = now() - interval '10 minutes' where id = $1`, [sessionId]);
    const back = await returned(learner.client, assignmentId, sessionId);
    expect(back.body.autoSubmitted).toBe(false);
    expect(back.body.state.warningCount).toBe(0);
    const events = await db.select().from(focusEventsTable).where(eq(focusEventsTable.sessionId, sessionId));
    expect(events.map((event) => event.outcome)).toEqual(["ALERT_ONLY"]);

    const ended = await teacher.client.post(`/api/tis/classes/${classId}/live-session/end`, {});
    expect(ended.status).toBe(200);
    const actions = (await db.select().from(auditLogTable)).map((row) => row.action);
    expect(actions).toContain("live_session_start");
    expect(actions).toContain("live_session_end");
  });

  it("stops locking a learner the teacher has exempted", async () => {
    const { teacher, classId, learner, assignmentId, sessionId } = await setup();
    const exempt = await teacher.client.post(`/api/tis/classes/${classId}/focus-exemption`, { learnerId: learner.learner.id, exempt: true });
    expect(exempt.status).toBe(200);
    const initial = await state(learner.client, assignmentId, sessionId);
    expect(initial.body.state.exempt).toBe(true);

    const exit = await left(learner.client, assignmentId, sessionId);
    expect(exit.body.armed).toBe(false);
    // An exempt learner's exit records nothing at all.
    const events = await db.select().from(focusEventsTable).where(eq(focusEventsTable.sessionId, sessionId));
    expect(events).toHaveLength(0);
    const actions = (await db.select().from(auditLogTable)).map((row) => row.action);
    expect(actions).toContain("focus_exemption");
  });

  it("lets the teacher turn focus mode off, but not after a learner has submitted", async () => {
    const { teacher, learner, assignmentId, sessionId } = await setup();
    const off = await teacher.client.post(`/api/tis/assignments/${assignmentId}/focus-mode`, { enabled: false });
    expect(off.status).toBe(200);
    expect(off.body.focusMode).toBe(false);
    const initial = await state(learner.client, assignmentId, sessionId);
    expect(initial.body.state.enabled).toBe(false);
    expect((await left(learner.client, assignmentId, sessionId)).body.armed).toBe(false);

    // Once a paper exists the setting is frozen.
    await submitAssignment(learner.client, assignmentId, [{ questionId: "q1", answer: "4" }]);
    const after = await teacher.client.post(`/api/tis/assignments/${assignmentId}/focus-mode`, { enabled: true });
    expect(after.status).toBe(409);
  });

  it("keeps focus state private: another learner cannot touch this attempt", async () => {
    const { assignmentId, sessionId } = await setup();
    const stranger = await registerLearner();
    const peek = await state(stranger.client, assignmentId, sessionId);
    expect(peek.status).toBe(404);
  });

  it("refuses focus routes to a teacher (they are learner-only)", async () => {
    const { teacher, assignmentId, sessionId } = await setup();
    const asTeacher = await teacher.client.post(`/api/assignments/${assignmentId}/focus/state`, { sessionId });
    expect(asTeacher.status).toBe(401);
  });

  it("reopens an auto-submitted paper so the learner can continue, and audits it", async () => {
    const { teacher, learner, assignmentId, sessionId } = await setup();
    // Drive it to an auto-submit with a long exit.
    await left(learner.client, assignmentId, sessionId);
    await pool.query(`update slate_assignment_sessions set focus_away_since = now() - interval '10 minutes' where id = $1`, [sessionId]);
    await returned(learner.client, assignmentId, sessionId);
    // Three warnings are needed; force the counter and run one more long exit.
    await pool.query(`update slate_assignment_sessions set focus_warning_count = $2 where id = $1`, [sessionId, FOCUS_MAX_WARNINGS - 1]);
    await left(learner.client, assignmentId, sessionId);
    await pool.query(`update slate_assignment_sessions set focus_away_since = now() - interval '10 minutes' where id = $1`, [sessionId]);
    const auto = await returned(learner.client, assignmentId, sessionId);
    expect(auto.body.autoSubmitted).toBe(true);
    const submissionId = auto.body.submissionId as string;

    const reopened = await teacher.client.post(`/api/tis/submissions/${submissionId}/reopen`, {});
    expect(reopened.status).toBe(200);
    expect(reopened.body.reopened).toBe(true);
    const actions = (await db.select().from(auditLogTable)).map((row) => row.action);
    expect(actions).toContain("focus_reopen");
  });

  it("counts a countdown that ran out in the background as an auto-submit", async () => {
    const { learner, assignmentId, sessionId } = await setup();
    await left(learner.client, assignmentId, sessionId);
    // Leave the deadline in the past and never report a return.
    await pool.query(
      `update slate_assignment_sessions set focus_away_since = now() - interval '5 minutes', focus_deadline_at = now() - interval '1 minute' where id = $1`,
      [sessionId],
    );
    const after = await state(learner.client, assignmentId, sessionId);
    expect(after.body.state.autoSubmitted).toBe(true);
    expect(after.body.state.autoSubmitReason).toBe("FOCUS_AWAY_TIMEOUT");
  });

  // ---- Teacher visibility and manual recovery of stuck attempts -----------

  // Put an attempt into the state focus mode leaves when its submit could not
  // finish: no paper, a failure recorded, and the deadline kept.
  async function makeStuck(sessionId: string, attempts = 1) {
    await pool.query(
      `update slate_assignment_sessions set focus_auto_submit_state = 'FAILED',
         focus_auto_submit_attempts = $2, focus_auto_submit_last_error = 'GEMINI_UNAVAILABLE',
         focus_deadline_at = now() - interval '1 minute', focus_away_since = null
       where id = $1`,
      [sessionId, attempts],
    );
  }

  it("surfaces a stuck automatic submit to the owning teacher", async () => {
    const { teacher, classId, learner, assignmentId, sessionId } = await setup();
    await makeStuck(sessionId);

    const status = await teacher.client.get(`/api/tis/classes/${classId}/focus-status`);
    expect(status.status).toBe(200);
    expect(status.body.stuckAutoSubmits).toHaveLength(1);
    const stuck = status.body.stuckAutoSubmits[0];
    expect(stuck.sessionId).toBe(sessionId);
    expect(stuck.assignmentId).toBe(assignmentId);
    expect(stuck.learnerId).toBe(learner.learner.id);
    expect(stuck.attempts).toBe(1);
    expect(stuck.exhausted).toBe(false);
    // Only ids, counts and codes are exposed — never an answer.
    expect(JSON.stringify(stuck)).not.toContain("answer");
  });

  it("lets the owning teacher retry a stuck automatic submit and audits it", async () => {
    const { teacher, classId, sessionId } = await setup();
    setGeminiModelForTesting(memoAwareMarkingModel());
    await makeStuck(sessionId);

    const retry = await teacher.client.post(`/api/tis/focus/retry-auto-submit`, { sessionId });
    expect(retry.status).toBe(200);
    expect(retry.body.outcome).toBe("SUBMITTED");
    expect(retry.body.submissionId).toBeTruthy();

    const rows = await db.select().from(submissionsTable).where(eq(submissionsTable.sessionId, sessionId));
    expect(rows).toHaveLength(1);
    const actions = (await db.select().from(auditLogTable)).map((row) => row.action);
    expect(actions).toContain("focus_auto_submit_retry");
    // It is no longer stuck once a paper exists.
    const status = await teacher.client.get(`/api/tis/classes/${classId}/focus-status`);
    expect(status.body.stuckAutoSubmits).toHaveLength(0);
  });

  it("restarts a retry even after the attempts were exhausted", async () => {
    const { teacher, assignmentId, sessionId } = await setup();
    setGeminiModelForTesting(memoAwareMarkingModel());
    await makeStuck(sessionId, 5);

    const before = await teacher.client.get(`/api/tis/classes/${await classIdFor(assignmentId)}/focus-status`);
    expect(before.body.stuckAutoSubmits[0].exhausted).toBe(true);

    const retry = await teacher.client.post(`/api/tis/focus/retry-auto-submit`, { sessionId });
    expect(retry.body.outcome).toBe("SUBMITTED");
  });

  it("refuses to retry a stuck attempt for a teacher who does not own the class", async () => {
    const { sessionId } = await setup();
    await makeStuck(sessionId);
    const stranger = await registerTeacher();
    const retry = await stranger.client.post(`/api/tis/focus/retry-auto-submit`, { sessionId });
    expect(retry.status).toBe(403);
    const rows = await db.select().from(submissionsTable).where(eq(submissionsTable.sessionId, sessionId));
    expect(rows).toHaveLength(0);
  });
});

// The class a single-assignment fixture belongs to.
async function classIdFor(assignmentId: string): Promise<string> {
  const { rows } = await pool.query<{ class_id: string }>(`select class_id from slate_assignments where id = $1`, [assignmentId]);
  return rows[0].class_id;
}
