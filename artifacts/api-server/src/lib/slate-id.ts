import { eq } from "drizzle-orm";
import { db, learnersTable, parentsTable, teachersTable, tutorsTable, pool } from "@workspace/db";
import { logger } from "./logger";

// SLATE IDs identify a person independently of their name: every account is
// issued one at creation, it never changes and is never reused. The prefix says
// what kind of account it is, and the six-digit number keeps the ID short and
// human-quotable.
export type SlateIdKind = "learner" | "teacher" | "parent" | "tutor";

const PREFIX: Record<SlateIdKind, string> = {
  learner: "L",
  teacher: "TE",
  parent: "P",
  tutor: "TU",
};

// One counter per account type, so numbering is sequential and independent.
// Public so the bootstrap can create the same sequences.
export const SLATE_ID_SEQUENCES: Record<SlateIdKind, string> = {
  learner: "slate_learner_id_seq",
  teacher: "slate_teacher_id_seq",
  parent: "slate_parent_id_seq",
  tutor: "slate_tutor_id_seq",
};

const TABLE: Record<SlateIdKind, string> = {
  learner: "slate_learners",
  teacher: "slate_teachers",
  parent: "slate_parents",
  tutor: "slate_tutors",
};

export function formatSlateId(kind: SlateIdKind, sequenceNumber: number) {
  return `${PREFIX[kind]}${String(sequenceNumber).padStart(6, "0")}`;
}

// True when a string looks like a SLATE ID, so a search can decide whether to
// treat the query as an ID (exact, single result) or a name (fuzzy, many).
export function isSlateIdQuery(value: string) {
  return /^(L|TE|P|TU)\d{3,}$/i.test(value.trim());
}

async function slateIdTaken(kind: SlateIdKind, slateId: string) {
  if (kind === "learner") {
    const [row] = await db.select({ id: learnersTable.id }).from(learnersTable).where(eq(learnersTable.slateId, slateId)).limit(1);
    return Boolean(row);
  }
  if (kind === "teacher") {
    const [row] = await db.select({ id: teachersTable.id }).from(teachersTable).where(eq(teachersTable.slateId, slateId)).limit(1);
    return Boolean(row);
  }
  if (kind === "parent") {
    const [row] = await db.select({ id: parentsTable.id }).from(parentsTable).where(eq(parentsTable.slateId, slateId)).limit(1);
    return Boolean(row);
  }
  const [row] = await db.select({ id: tutorsTable.id }).from(tutorsTable).where(eq(tutorsTable.slateId, slateId)).limit(1);
  return Boolean(row);
}

// Issue a fresh, unused SLATE ID. A sequence never rolls back, so a value is
// never handed out twice; the uniqueness check plus the column's unique index
// are the final guarantee against a collision from any other source.
export async function generateSlateId(kind: SlateIdKind): Promise<string> {
  for (let tries = 0; tries < 8; tries += 1) {
    const { rows } = await pool.query<{ n: string }>(`SELECT nextval($1) AS n`, [SLATE_ID_SEQUENCES[kind]]);
    const candidate = formatSlateId(kind, Number(rows[0].n));
    if (!(await slateIdTaken(kind, candidate))) return candidate;
  }
  throw new Error(`Could not mint a unique SLATE ID for a ${kind} account.`);
}

// One-time migration: every existing account without an ID gets one, using the
// prefix for its account type. Rows are ordered by creation time so the numbers
// read in the order the accounts were made. Idempotent — rows already carrying
// an ID are skipped, and the counters are advanced past any value already in
// use so a later creation cannot collide with a backfilled ID.
export async function backfillSlateIds() {
  for (const kind of Object.keys(SLATE_ID_SEQUENCES) as SlateIdKind[]) {
    const table = TABLE[kind];
    const seq = SLATE_ID_SEQUENCES[kind];
    await pool.query(`CREATE SEQUENCE IF NOT EXISTS ${seq}`);
    const { rows } = await pool.query<{ id: string }>(`SELECT id FROM ${table} WHERE slate_id IS NULL ORDER BY created_at, id`);
    for (const row of rows) {
      const slateId = await generateSlateId(kind);
      await pool.query(`UPDATE ${table} SET slate_id = $1 WHERE id = $2`, [slateId, row.id]);
    }
    await advanceCounterPastExisting(kind, seq);
    if (rows.length) logger.info({ kind, count: rows.length }, "slate ids backfilled");
  }
}

// Safety net for the (unexpected) case where a table already holds a number
// higher than the counter — e.g. IDs assigned before the sequence existed.
async function advanceCounterPastExisting(kind: SlateIdKind, seq: string) {
  const prefix = PREFIX[kind];
  const { rows } = await pool.query<{ max: number | null }>(
    `SELECT MAX(CAST(SUBSTRING(slate_id FROM ${prefix.length + 1}) AS integer)) AS max
       FROM ${TABLE[kind]}
      WHERE slate_id LIKE $1`,
    [`${prefix}%`],
  );
  const max = rows[0]?.max;
  if (max !== null && max !== undefined) {
    await pool.query(`SELECT setval($1, GREATEST((SELECT last_value FROM ${seq}), $2))`, [seq, max]);
  }
}
