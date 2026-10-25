import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { classesTable, db } from "@workspace/db";

// Join codes are short, human-readable, case-insensitive tokens. Two kinds
// exist and they are never interchangeable:
//   joinCode     — joins the class as a LEARNER
//   hodJoinCode  — joins the class at HOD (supervisory) level
// Keeping the mint in one place means a learner can never be handed a
// supervisory code by accident, and the two codes never share a value space.
const CODE_LENGTH = 6;
const MINT_RETRY_MAX = 25;

// Codes minted in this process but not yet committed to a row (a class insert
// can batch several classes at once). Without this, two concurrent mints in one
// batch could return the same candidate and the insert would fail on the unique
// index. The DB check below still covers codes minted by other processes.
const inFlight = new Set<string>();

function mint() {
  return randomBytes(4).toString("hex").toUpperCase().slice(0, CODE_LENGTH);
}

// The learner join code. Uniqueness is ultimately enforced by the column's
// unique index; callers that regenerate an existing class retry on collision.
export function generateJoinCode() {
  return mint();
}

// An HOD join code that is free in the classes table. The extra lookup matters
// more here than for the learner code because the HOD code is handed out
// separately and a collision would silently point at the wrong class.
export async function generateHodJoinCode(): Promise<string> {
  for (let attempt = 0; attempt < MINT_RETRY_MAX; attempt += 1) {
    const candidate = mint();
    if (inFlight.has(candidate)) continue;
    const [taken] = await db
      .select({ id: classesTable.id })
      .from(classesTable)
      .where(eq(classesTable.hodJoinCode, candidate))
      .limit(1);
    if (taken) continue;
    inFlight.add(candidate);
    // Released once the value has had time to reach the table; the DB check is
    // the real guard for anything older than this.
    setTimeout(() => inFlight.delete(candidate), 60_000).unref?.();
    return candidate;
  }
  throw new Error("Could not mint a unique HOD join code.");
}
