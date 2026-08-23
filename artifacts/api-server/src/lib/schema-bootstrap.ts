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
  // ---- Unified accounts (teachers/parents/tutors → one identity per email) ----
  `CREATE TABLE IF NOT EXISTS slate_users (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    email text NOT NULL UNIQUE,
    password_hash text NOT NULL,
    full_name text NOT NULL,
    roles text[] NOT NULL DEFAULT '{}',
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS slate_user_sessions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES slate_users(id) ON DELETE CASCADE,
    token_hash text NOT NULL UNIQUE,
    active_role text NOT NULL,
    expires_at timestamptz NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `ALTER TABLE slate_teachers ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES slate_users(id) ON DELETE CASCADE`,
  `ALTER TABLE slate_parents ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES slate_users(id) ON DELETE CASCADE`,
  `ALTER TABLE slate_tutors ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES slate_users(id) ON DELETE CASCADE`,
  // Backfill any rows created before the unified table existed (idempotent).
  `INSERT INTO slate_users (email, password_hash, full_name, roles)
   SELECT email, password_hash, full_name, ARRAY['TEACHER']::text[] FROM slate_teachers
   ON CONFLICT (email) DO UPDATE
   SET roles = (SELECT array_agg(DISTINCT r) FROM unnest(slate_users.roles || EXCLUDED.roles) AS r)`,
  `INSERT INTO slate_users (email, password_hash, full_name, roles)
   SELECT email, password_hash, full_name, ARRAY['PARENT']::text[] FROM slate_parents
   ON CONFLICT (email) DO UPDATE
   SET roles = (SELECT array_agg(DISTINCT r) FROM unnest(slate_users.roles || EXCLUDED.roles) AS r)`,
  `INSERT INTO slate_users (email, password_hash, full_name, roles)
   SELECT email, password_hash, full_name, ARRAY['TUTOR']::text[] FROM slate_tutors
   ON CONFLICT (email) DO UPDATE
   SET roles = (SELECT array_agg(DISTINCT r) FROM unnest(slate_users.roles || EXCLUDED.roles) AS r)`,
  `UPDATE slate_teachers t SET user_id = u.id FROM slate_users u WHERE t.user_id IS NULL AND lower(t.email) = lower(u.email)`,
  `UPDATE slate_parents p SET user_id = u.id FROM slate_users u WHERE p.user_id IS NULL AND lower(p.email) = lower(u.email)`,
  `UPDATE slate_tutors o SET user_id = u.id FROM slate_users u WHERE o.user_id IS NULL AND lower(o.email) = lower(u.email)`,
  // ---- Tutor invitations + audit log ----
  `CREATE TABLE IF NOT EXISTS slate_tutor_invitations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    class_id uuid NOT NULL REFERENCES slate_classes(id) ON DELETE CASCADE,
    invited_by_user_id uuid NOT NULL REFERENCES slate_users(id) ON DELETE CASCADE,
    tutor_user_id uuid NOT NULL REFERENCES slate_users(id) ON DELETE CASCADE,
    status text NOT NULL DEFAULT 'PENDING',
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS slate_tutor_invitations_unique ON slate_tutor_invitations (class_id, tutor_user_id)`,
  `CREATE TABLE IF NOT EXISTS slate_audit_log (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_user_id uuid NOT NULL REFERENCES slate_users(id) ON DELETE CASCADE,
    actor_role text NOT NULL,
    action text NOT NULL,
    class_id uuid REFERENCES slate_classes(id) ON DELETE CASCADE,
    target_member_id uuid,
    member_type text,
    detail text NOT NULL DEFAULT '',
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  // ---- Flexible marking ----
  `ALTER TABLE slate_assignments ADD COLUMN IF NOT EXISTS marking_mode text NOT NULL DEFAULT 'auto'`,
  `ALTER TABLE slate_assignments ADD COLUMN IF NOT EXISTS auto_mark_questions integer[] NOT NULL DEFAULT '{}'::integer[]`,
  `ALTER TABLE slate_submissions ADD COLUMN IF NOT EXISTS marking_status text NOT NULL DEFAULT 'MARKED'`,
  `ALTER TABLE slate_submissions ADD COLUMN IF NOT EXISTS answers jsonb`,
  // ---- Learners join the unified identity model (optional email link) ----
  `ALTER TABLE slate_learners ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES slate_users(id) ON DELETE SET NULL`,
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
