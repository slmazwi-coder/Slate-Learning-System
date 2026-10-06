import { pool } from "@workspace/db";
import { logger } from "./logger";
import { syncPresetCurricula } from "./presets";
import { backfillSlateIds } from "./slate-id";

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
  `ALTER TABLE slate_assignments ADD COLUMN IF NOT EXISTS question_types text[] NOT NULL DEFAULT ARRAY['multiple_choice', 'text']::text[]`,
  `ALTER TABLE slate_assignments ADD COLUMN IF NOT EXISTS question_blueprint jsonb`,
  `ALTER TABLE slate_assignments ADD COLUMN IF NOT EXISTS question_source text NOT NULL DEFAULT 'ai'`,
  `ALTER TABLE slate_assignments ADD COLUMN IF NOT EXISTS is_published boolean NOT NULL DEFAULT true`,
  `ALTER TABLE slate_assignments ADD COLUMN IF NOT EXISTS result_release_policy text NOT NULL DEFAULT 'after_close'`,
  `ALTER TABLE slate_submissions ADD COLUMN IF NOT EXISTS marking_status text NOT NULL DEFAULT 'MARKED'`,
  `ALTER TABLE slate_submissions ADD COLUMN IF NOT EXISTS answers jsonb`,
  // ---- Learners join the unified identity model (optional email link) ----
  `ALTER TABLE slate_learners ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES slate_users(id) ON DELETE SET NULL`,
  // ---- Preset curriculum catalog + class gate ----
  `CREATE TABLE IF NOT EXISTS slate_preset_curricula (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    phase text NOT NULL,
    subject text NOT NULL,
    grade_min integer NOT NULL,
    grade_max integer NOT NULL,
    source_name text NOT NULL,
    sequence jsonb NOT NULL DEFAULT '[]'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS slate_preset_curricula_subject_phase ON slate_preset_curricula (phase, subject, grade_min, grade_max)`,
  `ALTER TABLE slate_preset_curricula ADD COLUMN IF NOT EXISTS assessment_guide text`,
  `ALTER TABLE slate_classes ADD COLUMN IF NOT EXISTS preset_subject text NOT NULL DEFAULT ''`,
  // ---- Shared learner email (siblings may share a parent's address) ----
  // Email stays required on the form but is never unique; username is the
  // unique login identifier. Drop any legacy unique index on email if present.
  `ALTER TABLE slate_learners ADD COLUMN IF NOT EXISTS email text`,
  `DROP INDEX IF EXISTS slate_learners_email_unique`,
  // ---- Parent ↔ learner relationship ----
  `CREATE TABLE IF NOT EXISTS slate_parent_learners (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    parent_id uuid NOT NULL REFERENCES slate_parents(id) ON DELETE CASCADE,
    learner_id uuid NOT NULL REFERENCES slate_learners(id) ON DELETE CASCADE,
    linked_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS slate_parent_learners_unique ON slate_parent_learners (parent_id, learner_id)`,
  // ---- Tutor ↔ learner relationship ----
  `CREATE TABLE IF NOT EXISTS slate_tutor_learners (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tutor_id uuid NOT NULL REFERENCES slate_tutors(id) ON DELETE CASCADE,
    learner_id uuid NOT NULL REFERENCES slate_learners(id) ON DELETE CASCADE,
    linked_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS slate_tutor_learners_unique ON slate_tutor_learners (tutor_id, learner_id)`,
  // Backfill from the legacy single-column link for tutor-created learners.
  `INSERT INTO slate_tutor_learners (tutor_id, learner_id)
   SELECT tutor_id, id FROM slate_learners WHERE tutor_id IS NOT NULL
   ON CONFLICT (tutor_id, learner_id) DO NOTHING`,
  // Backfill the relationship from the legacy single-column link. Existing
  // parent-created child profiles already ARE real learner records (they carry
  // username + passwordHash), so the migration only needs to link them.
  `INSERT INTO slate_parent_learners (parent_id, learner_id)
   SELECT parent_id, id FROM slate_learners WHERE parent_id IS NOT NULL
   ON CONFLICT (parent_id, learner_id) DO NOTHING`,
  // ---- Learner usage sessions (login/logout/duration for parent monitoring) ----
  `CREATE TABLE IF NOT EXISTS slate_learner_sessions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    learner_id uuid NOT NULL REFERENCES slate_learners(id) ON DELETE CASCADE,
    login_at timestamptz NOT NULL DEFAULT now(),
    last_seen_at timestamptz NOT NULL DEFAULT now(),
    logout_at timestamptz,
    duration_minutes integer,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS slate_learner_sessions_learner_idx ON slate_learner_sessions (learner_id, login_at DESC)`,
  `ALTER TABLE slate_auth_sessions ADD COLUMN IF NOT EXISTS learner_session_id uuid REFERENCES slate_learner_sessions(id) ON DELETE SET NULL`,
  // ---- Teacher-uploaded study material for a class ----
  `CREATE TABLE IF NOT EXISTS slate_class_materials (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    class_id uuid NOT NULL REFERENCES slate_classes(id) ON DELETE CASCADE,
    created_by_teacher_id uuid REFERENCES slate_teachers(id) ON DELETE SET NULL,
    title text NOT NULL,
    description text NOT NULL DEFAULT '',
    kind text NOT NULL DEFAULT 'NOTE',
    content text,
    file_name text,
    file_type text,
    file_data text,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS slate_class_materials_class_idx ON slate_class_materials (class_id, created_at DESC)`,
  // ---- Profile images (all account types) + learner age/gender declaration ----
  // profile_image holds a small data URL ("data:image/…;base64,…"), stored
  // inline because the deploy target has no object storage. age/gender are
  // nullable in SQL so pre-existing accounts can be prompted after login, while
  // every new learner account is required to declare them at registration.
  `ALTER TABLE slate_learners ADD COLUMN IF NOT EXISTS profile_image text`,
  `ALTER TABLE slate_learners ADD COLUMN IF NOT EXISTS age integer`,
  `ALTER TABLE slate_learners ADD COLUMN IF NOT EXISTS gender text`,
  `ALTER TABLE slate_teachers ADD COLUMN IF NOT EXISTS profile_image text`,
  `ALTER TABLE slate_parents ADD COLUMN IF NOT EXISTS profile_image text`,
  `ALTER TABLE slate_tutors ADD COLUMN IF NOT EXISTS profile_image text`,
  // ---- SLATE IDs (permanent, unique per account type) ----
  // Prefix is fixed per account type: L / TE / P / TU. The column is nullable
  // so the backfill below can fill legacy rows; new rows are issued an ID at
  // creation. Unique indexes give the database the final word on collisions.
  `ALTER TABLE slate_learners ADD COLUMN IF NOT EXISTS slate_id text`,
  `ALTER TABLE slate_teachers ADD COLUMN IF NOT EXISTS slate_id text`,
  `ALTER TABLE slate_parents ADD COLUMN IF NOT EXISTS slate_id text`,
  `ALTER TABLE slate_tutors ADD COLUMN IF NOT EXISTS slate_id text`,
  `CREATE UNIQUE INDEX IF NOT EXISTS slate_learners_slate_id_unique ON slate_learners (slate_id)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS slate_teachers_slate_id_unique ON slate_teachers (slate_id)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS slate_parents_slate_id_unique ON slate_parents (slate_id)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS slate_tutors_slate_id_unique ON slate_tutors (slate_id)`,
  // Search performance: exact SLATE ID lookups and name search.
  `CREATE INDEX IF NOT EXISTS slate_learners_full_name_idx ON slate_learners (full_name)`,
  `CREATE INDEX IF NOT EXISTS slate_learners_grade_idx ON slate_learners (grade)`,
];

// Name search matches with ILIKE '%term%', which a plain btree index cannot
// serve, so a trigram GIN index is the right tool. Creating the extension needs
// privileges the app role may not hold in every environment, so this is
// best-effort: if it fails we log and carry on with the btree index.
async function ensureSearchIndexes() {
  try {
    await pool.query(`CREATE EXTENSION IF NOT EXISTS pg_trgm`);
    await pool.query(`CREATE INDEX IF NOT EXISTS slate_learners_full_name_trgm_idx ON slate_learners USING gin (full_name gin_trgm_ops)`);
  } catch (error) {
    logger.warn({ err: error }, "trigram name-search index unavailable; falling back to the btree index");
  }
}

let ready: Promise<void> | null = null;

export function ensureSchema(): Promise<void> {
  if (!ready) {
    ready = (async () => {
      for (const statement of STATEMENTS) {
        await pool.query(statement);
      }
      await ensureSearchIndexes();
      await syncPresetCurricula();
      await backfillSlateIds();
      logger.info("slate schema bootstrap complete");
    })().catch((error) => {
      ready = null;
      logger.error({ err: error }, "slate schema bootstrap failed");
      throw error;
    });
  }
  return ready;
}
