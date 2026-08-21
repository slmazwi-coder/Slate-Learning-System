import { pool } from "@workspace/db";
import { logger } from "./logger";

// Idempotent schema evolution for the SLATE operating-mode / family-account
// features. Runs once per process (on the first API request) so production
// deploys pick up the new tables and columns without a manual drizzle push.
const STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS slate_parents (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    email text NOT NULL UNIQUE,
    password_hash text NOT NULL,
    full_name text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS slate_tutors (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    email text NOT NULL UNIQUE,
    password_hash text NOT NULL,
    full_name text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS slate_parent_sessions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    parent_id uuid NOT NULL REFERENCES slate_parents(id) ON DELETE CASCADE,
    token_hash text NOT NULL UNIQUE,
    expires_at timestamptz NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS slate_tutor_sessions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tutor_id uuid NOT NULL REFERENCES slate_tutors(id) ON DELETE CASCADE,
    token_hash text NOT NULL UNIQUE,
    expires_at timestamptz NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `ALTER TABLE slate_classes ALTER COLUMN teacher_id DROP NOT NULL`,
  `ALTER TABLE slate_classes ADD COLUMN IF NOT EXISTS owner_type text NOT NULL DEFAULT 'teacher'`,
  `ALTER TABLE slate_classes ADD COLUMN IF NOT EXISTS parent_id uuid REFERENCES slate_parents(id) ON DELETE CASCADE`,
  `ALTER TABLE slate_classes ADD COLUMN IF NOT EXISTS tutor_id uuid REFERENCES slate_tutors(id) ON DELETE CASCADE`,
  `ALTER TABLE slate_classes ADD COLUMN IF NOT EXISTS mode text NOT NULL DEFAULT 'TEACHER_DEPENDENT'`,
  `ALTER TABLE slate_classes ADD COLUMN IF NOT EXISTS curriculum_text text`,
  `ALTER TABLE slate_classes ADD COLUMN IF NOT EXISTS curriculum_file_name text`,
  `ALTER TABLE slate_classes ADD COLUMN IF NOT EXISTS lesson_sequence jsonb NOT NULL DEFAULT '[]'::jsonb`,
  `ALTER TABLE slate_classes ADD COLUMN IF NOT EXISTS current_topic_index integer NOT NULL DEFAULT 0`,
  `ALTER TABLE slate_classes ADD COLUMN IF NOT EXISTS assignment_window_days integer NOT NULL DEFAULT 7`,
  `ALTER TABLE slate_learners ADD COLUMN IF NOT EXISTS parent_id uuid REFERENCES slate_parents(id) ON DELETE CASCADE`,
  `ALTER TABLE slate_learners ADD COLUMN IF NOT EXISTS tutor_id uuid REFERENCES slate_tutors(id) ON DELETE CASCADE`,
];

let ready: Promise<void> | null = null;

export function ensureSchema(): Promise<void> {
  if (!ready) {
    ready = (async () => {
      for (const statement of STATEMENTS) {
        await pool.query(statement);
      }
      logger.info("slate schema bootstrap complete");
    })().catch((error) => {
      ready = null;
      logger.error({ err: error }, "slate schema bootstrap failed");
      throw error;
    });
  }
  return ready;
}
