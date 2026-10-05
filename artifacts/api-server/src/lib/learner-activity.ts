import { and, desc, eq, gte, isNull, sql } from "drizzle-orm";
import { db, learnerSessionsTable } from "@workspace/db";

// Idle sessions are closed at the last-seen time so a forgotten tab does not
// report hours of "usage" the learner never actually spent.
const IDLE_TIMEOUT_MINUTES = 30;
// Sessions left open with no heartbeat for this long are assumed abandoned and
// closed when the parent's activity view is read.
const STALE_SWEEP_MINUTES = 12 * 60;

function durationMinutes(loginAt: Date, endedAt: Date) {
  return Math.max(0, Math.round((endedAt.getTime() - loginAt.getTime()) / 60000));
}

// Opens a new usage row for a learner login.
export async function recordLearnerLogin(learnerId: string) {
  const [row] = await db.insert(learnerSessionsTable).values({ learnerId }).returning({ id: learnerSessionsTable.id });
  return row?.id ?? null;
}

// Closes a usage row at the given time (explicit logout, timeout or heartbeat
// expiry) and stamps the visit duration. Safe to call more than once.
export async function closeLearnerSession(sessionId: string | null | undefined, endedAt = new Date()) {
  if (!sessionId) return;
  const [row] = await db.select().from(learnerSessionsTable).where(eq(learnerSessionsTable.id, sessionId)).limit(1);
  if (!row || row.logoutAt) return;
  await db
    .update(learnerSessionsTable)
    .set({ logoutAt: endedAt, durationMinutes: durationMinutes(row.loginAt, endedAt) })
    .where(eq(learnerSessionsTable.id, sessionId));
}

// Heartbeat: extends the open row while the learner is genuinely active. If the
// row has already gone idle (no heartbeat for IDLE_TIMEOUT_MINUTES), it is
// closed at the last-seen time and a fresh row is opened for the new visit.
export async function touchLearnerSession(sessionId: string | null | undefined, learnerId: string) {
  if (!sessionId) return recordLearnerLogin(learnerId);
  const [row] = await db.select().from(learnerSessionsTable).where(eq(learnerSessionsTable.id, sessionId)).limit(1);
  if (!row) return recordLearnerLogin(learnerId);
  if (row.logoutAt) return recordLearnerLogin(learnerId);
  const idleMs = Date.now() - row.lastSeenAt.getTime();
  if (idleMs > IDLE_TIMEOUT_MINUTES * 60000) {
    await db
      .update(learnerSessionsTable)
      .set({ logoutAt: row.lastSeenAt, durationMinutes: durationMinutes(row.loginAt, row.lastSeenAt) })
      .where(eq(learnerSessionsTable.id, row.id));
    return recordLearnerLogin(learnerId);
  }
  await db.update(learnerSessionsTable).set({ lastSeenAt: new Date() }).where(eq(learnerSessionsTable.id, row.id));
  return row.id;
}

// Closes rows abandoned without a logout (server restarts, closed tabs) so the
// dashboard never shows an open-ended session.
async function sweepStaleSessions(learnerId: string) {
  const cutoff = new Date(Date.now() - STALE_SWEEP_MINUTES * 60000);
  await db
    .update(learnerSessionsTable)
    .set({ logoutAt: learnerSessionsTable.lastSeenAt, durationMinutes: sql`GREATEST(0, round(extract(epoch from (${learnerSessionsTable.lastSeenAt} - ${learnerSessionsTable.loginAt})) / 60))` })
    .where(and(
      eq(learnerSessionsTable.learnerId, learnerId),
      isNull(learnerSessionsTable.logoutAt),
      sql`${learnerSessionsTable.lastSeenAt} < ${cutoff}`,
    ));
}

function startOfDay(date: Date) {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function dayKey(date: Date) {
  const copy = new Date(date);
  return `${copy.getFullYear()}-${String(copy.getMonth() + 1).padStart(2, "0")}-${String(copy.getDate()).padStart(2, "0")}`;
}

// Purely informational usage summary for one learner: today, the last seven
// days, the running month total and the most recent visits.
export async function learnerActivitySummary(learnerId: string) {
  await sweepStaleSessions(learnerId);
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const weekStart = startOfDay(new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000));
  const rows = await db
    .select()
    .from(learnerSessionsTable)
    .where(and(eq(learnerSessionsTable.learnerId, learnerId), gte(learnerSessionsTable.loginAt, monthStart)))
    .orderBy(desc(learnerSessionsTable.loginAt));

  const minutesFor = (row: typeof rows[number]) => {
    if (row.durationMinutes !== null) return row.durationMinutes;
    if (row.logoutAt) return durationMinutes(row.loginAt, row.logoutAt);
    return Math.min(IDLE_TIMEOUT_MINUTES, durationMinutes(row.loginAt, row.lastSeenAt));
  };

  const todayKey = dayKey(now);
  const dayBuckets = new Map<string, number>();
  for (let offset = 0; offset < 7; offset += 1) {
    const day = startOfDay(new Date(now.getTime() - offset * 24 * 60 * 60 * 1000));
    dayBuckets.set(dayKey(day), 0);
  }

  let todayMinutes = 0;
  let todaySessions = 0;
  let monthMinutes = 0;
  const recent = rows.slice(0, 10).map((row) => {
    const minutes = minutesFor(row);
    monthMinutes += minutes;
    const key = dayKey(row.loginAt);
    if (dayBuckets.has(key)) dayBuckets.set(key, (dayBuckets.get(key) ?? 0) + minutes);
    if (key === todayKey) {
      todayMinutes += minutes;
      todaySessions += 1;
    }
    return {
      id: row.id,
      loginAt: row.loginAt.toISOString(),
      logoutAt: row.logoutAt ? row.logoutAt.toISOString() : null,
      durationMinutes: row.logoutAt ? minutes : null,
      active: !row.logoutAt,
    };
  });

  const week = [...dayBuckets.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, minutes]) => ({ date, minutes }));

  return {
    todayMinutes,
    todaySessions,
    weekMinutes: week.reduce((total, day) => total + day.minutes, 0),
    monthMinutes,
    week,
    recent,
  };
}

export type LearnerActivity = Awaited<ReturnType<typeof learnerActivitySummary>>;
