import { createHash, randomBytes } from "node:crypto";
import { pool } from "@workspace/db";

type RecipientRole = "parent" | "tutor" | "teacher";
const digest = (token: string) => createHash("sha256").update(token).digest("hex");

// Codes are scoped to one learner and one named adult, expire quickly, and are
// consumed atomically. They cannot be used to grant another role access.
export async function issueLearnerApproval(learnerId: string, role: RecipientRole, slateId: string) {
  const tables: Record<RecipientRole, string> = { parent: "slate_parents", tutor: "slate_tutors", teacher: "slate_teachers" };
  const { rows } = await pool.query<{ id: string }>(`SELECT id FROM ${tables[role]} WHERE slate_id = $1`, [slateId.toUpperCase()]);
  if (!rows[0]) return null;
  await pool.query("DELETE FROM slate_learner_approvals WHERE expires_at < now()");
  const token = randomBytes(32).toString("base64url");
  await pool.query(`INSERT INTO slate_learner_approvals (token_hash, learner_id, recipient_role, recipient_id, expires_at)
    VALUES ($1, $2, $3, $4, now() + interval '10 minutes')`, [digest(token), learnerId, role, rows[0].id]);
  return token;
}

export async function consumeLearnerApproval(token: string, learnerId: string, role: RecipientRole, recipientId: string) {
  const result = await pool.query(`DELETE FROM slate_learner_approvals
    WHERE token_hash = $1 AND learner_id = $2 AND recipient_role = $3 AND recipient_id = $4 AND expires_at > now()
    RETURNING token_hash`, [digest(token), learnerId, role, recipientId]);
  return result.rowCount === 1;
}

// Look up only the learner who approved this signed-in adult, without consuming
// the code. The adult's current role must match the approval's role.
export async function approvedLearnerId(token: string, userId: string, role: RecipientRole): Promise<string | null> {
  const tables: Record<RecipientRole, string> = { parent: "slate_parents", tutor: "slate_tutors", teacher: "slate_teachers" };
  const { rows } = await pool.query<{ learner_id: string }>(`SELECT a.learner_id FROM slate_learner_approvals a
    JOIN ${tables[role]} recipient ON recipient.id = a.recipient_id
    WHERE a.token_hash = $1 AND a.recipient_role = $2 AND recipient.user_id = $3 AND a.expires_at > now()`, [digest(token), role, userId]);
  return rows[0]?.learner_id ?? null;
}
