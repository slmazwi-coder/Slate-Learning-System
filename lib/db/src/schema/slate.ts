import {
  boolean,
  date,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";

// Unified account identities for teachers, parents and tutors. Teachers,
// parents and tutors are now profiles on one account; role membership lives
// in roles[] ("TEACHER" | "PARENT" | "TUTOR"). The legacy per-role tables are
// kept as role-specific profiles (e.g. teacher schoolName, class FK owners).
export const usersTable = pgTable("slate_users", {
  id: uuid("id").defaultRandom().primaryKey(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  fullName: text("full_name").notNull(),
  roles: text("roles").array().notNull().$type<string[]>(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const userSessionsTable = pgTable("slate_user_sessions", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull().unique(),
  activeRole: text("active_role").$type<string>().notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const parentsTable = pgTable("slate_parents", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").references(() => usersTable.id, { onDelete: "cascade" }),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  fullName: text("full_name").notNull(),
  // Permanent, unique SLATE ID ("P000309") issued at creation. Distinct from
  // the login identity so two people with the same name can always be told
  // apart. Nullable only until the backfill assigns one.
  slateId: text("slate_id").unique(),
  profileImage: text("profile_image"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const tutorsTable = pgTable("slate_tutors", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").references(() => usersTable.id, { onDelete: "cascade" }),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  fullName: text("full_name").notNull(),
  // Permanent, unique SLATE ID ("TU000056").
  slateId: text("slate_id").unique(),
  profileImage: text("profile_image"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const learnersTable = pgTable("slate_learners", {
  id: uuid("id").defaultRandom().primaryKey(),
  // Learners keep username login (many school learners have no email), and
  // link to a unified account only when an email is supplied, so one person
  // can hold LEARNER alongside TEACHER/PARENT/TUTOR on a single identity.
  userId: uuid("user_id").references(() => usersTable.id, { onDelete: "set null" }),
  // Username is the unique login identifier. Email is required for contact and
  // recovery but is deliberately NOT unique: siblings commonly share a
  // parent's address, and a parent may use their own address for every child.
  username: text("username").notNull().unique(),
  email: text("email"),
  passwordHash: text("password_hash").notNull(),
  fullName: text("full_name").notNull(),
  // Permanent, unique SLATE ID ("L000482"). Generated at creation for every
  // account, including those an adult creates on a learner's behalf, so a
  // learner can always be identified by ID even when names collide.
  slateId: text("slate_id").unique(),
  grade: integer("grade").notNull(),
  schoolName: text("school_name").notNull(),
  subjects: jsonb("subjects").$type<string[]>().notNull(),
  // Declared on every new account; existing learners are prompted after login.
  // Gender is one of "boy" | "girl" | "other" — stored as free text so the
  // prompt can stay optional for legacy accounts without a schema change.
  age: integer("age"),
  gender: text("gender"),
  // Optional profile fields collected when a learner (or the adult creating the
  // account) supplies them; free text so legacy rows stay valid.
  dateOfBirth: date("date_of_birth"),
  homeLanguage: text("home_language"),
  province: text("province"),
  profileImage: text("profile_image"),
  // POPIA consent captured when a parent or tutor creates an account on a
  // child's behalf: which notice version was accepted and when.
  consentVersion: text("consent_version"),
  consentAt: timestamp("consent_at", { withTimezone: true }),
  parentId: uuid("parent_id").references(() => parentsTable.id, { onDelete: "cascade" }),
  tutorId: uuid("tutor_id").references(() => tutorsTable.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

// Parent ↔ learner relationship. A parent can be linked to many children and a
// learner can be linked to a parent while still joining a school class with a
// teacher's join code — the two are independent, so a learner keeps one
// identity and simply gains a classId when they join a class.
export const parentLearnersTable = pgTable("slate_parent_learners", {
  id: uuid("id").defaultRandom().primaryKey(),
  parentId: uuid("parent_id").notNull().references(() => parentsTable.id, { onDelete: "cascade" }),
  learnerId: uuid("learner_id").notNull().references(() => learnersTable.id, { onDelete: "cascade" }),
  linkedAt: timestamp("linked_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [unique("slate_parent_learners_unique").on(table.parentId, table.learnerId)]);

// Tutor ↔ learner relationship. Mirrors the parent link so a tutor can add an
// existing learner without taking them from another tutor; the legacy
// slate_learners.tutor_id column is kept and unioned for pre-link rows.
export const tutorLearnersTable = pgTable("slate_tutor_learners", {
  id: uuid("id").defaultRandom().primaryKey(),
  tutorId: uuid("tutor_id").notNull().references(() => tutorsTable.id, { onDelete: "cascade" }),
  learnerId: uuid("learner_id").notNull().references(() => learnersTable.id, { onDelete: "cascade" }),
  linkedAt: timestamp("linked_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [unique("slate_tutor_learners_unique").on(table.tutorId, table.learnerId)]);

// One row per learner visit. loginAt is written on login; logoutAt is written
// on explicit logout or when an idle session times out. durationMinutes is the
// visit length used by the parent usage dashboard.
export const learnerSessionsTable = pgTable("slate_learner_sessions", {
  id: uuid("id").defaultRandom().primaryKey(),
  learnerId: uuid("learner_id").notNull().references(() => learnersTable.id, { onDelete: "cascade" }),
  loginAt: timestamp("login_at", { withTimezone: true }).defaultNow().notNull(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).defaultNow().notNull(),
  logoutAt: timestamp("logout_at", { withTimezone: true }),
  durationMinutes: integer("duration_minutes"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const authSessionsTable = pgTable("slate_auth_sessions", {
  id: uuid("id").defaultRandom().primaryKey(),
  learnerId: uuid("learner_id").notNull().references(() => learnersTable.id, { onDelete: "cascade" }),
  // Links this auth session to the usage-log row so logout / timeout can close
  // the visit and record its duration.
  learnerSessionId: uuid("learner_session_id").references(() => learnerSessionsTable.id, { onDelete: "set null" }),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const teachersTable = pgTable("slate_teachers", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").references(() => usersTable.id, { onDelete: "cascade" }),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  fullName: text("full_name").notNull(),
  // Permanent, unique SLATE ID ("TE000117").
  slateId: text("slate_id").unique(),
  schoolName: text("school_name").notNull(),
  profileImage: text("profile_image"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const teacherSessionsTable = pgTable("slate_teacher_sessions", {
  id: uuid("id").defaultRandom().primaryKey(),
  teacherId: uuid("teacher_id").notNull().references(() => teachersTable.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const parentSessionsTable = pgTable("slate_parent_sessions", {
  id: uuid("id").defaultRandom().primaryKey(),
  parentId: uuid("parent_id").notNull().references(() => parentsTable.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const tutorSessionsTable = pgTable("slate_tutor_sessions", {
  id: uuid("id").defaultRandom().primaryKey(),
  tutorId: uuid("tutor_id").notNull().references(() => tutorsTable.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

// Preset curriculum catalog: hardwired content (e.g. the official CAPS document)
// that teachers pick from. Only subjects with an entry here can be created as
// classes — the gate lives in the class-creation routes.
export const presetCurriculaTable = pgTable("slate_preset_curricula", {
  id: uuid("id").defaultRandom().primaryKey(),
  phase: text("phase").notNull(),
  subject: text("subject").notNull(),
  gradeMin: integer("grade_min").notNull(),
  gradeMax: integer("grade_max").notNull(),
  sourceName: text("source_name").notNull(),
  sequence: jsonb("sequence").$type<string[]>().notNull(),
  // Per-module assessment guidelines (e.g. Stadio module assessment rubrics).
  // Fed into Gemini marking for classes on this preset when present.
  assessmentGuide: text("assessment_guide"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [unique("slate_preset_curricula_subject_phase").on(table.phase, table.subject, table.gradeMin, table.gradeMax)]);

// Annual Teaching Plans published by the Department of Basic Education. Where
// the department issues a new directive for a subject, the ATP is the authority
// for that year and drives the class sequence; where a plan is retained the CAPS
// preset stands. Keyed on subject+grade+effective year, and the document vintage
// is stored separately because a teaching year can run on an older document.
export const annualTeachingPlansTable = pgTable("slate_annual_teaching_plans", {
  id: uuid("id").defaultRandom().primaryKey(),
  phase: text("phase").notNull(),
  subject: text("subject").notNull(),
  grade: integer("grade").notNull(),
  // Teaching year the plan governs (e.g. "2026").
  effectiveYear: text("effective_year").notNull(),
  // Vintage printed on the source document (e.g. "2023/24").
  documentYear: text("document_year").notNull(),
  sourceName: text("source_name").notNull(),
  // The departmental circular that governs this document.
  circular: text("circular").notNull(),
  sequence: jsonb("sequence").$type<string[]>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [unique("slate_atp_subject_grade_year").on(table.subject, table.grade, table.effectiveYear)]);

// Departmental curriculum directives, one row per teaching year. Records whether
// the department retained the previous plans or replaced a named set, so the plan
// in force for a class is traceable to a decision rather than to a download date.
export const curriculumDirectivesTable = pgTable("slate_curriculum_directives", {
  id: uuid("id").defaultRandom().primaryKey(),
  year: text("year").notNull().unique(),
  circular: text("circular").notNull(),
  sourceUrl: text("source_url").notNull().default(""),
  // "retention" keeps the previous plans except for `exclusions`; "standalone"
  // means the year's plans were issued on their own terms.
  policy: text("policy").notNull().default("retention"),
  exclusions: jsonb("exclusions").$type<string[]>().notNull().default([]),
  notes: text("notes").notNull().default(""),
  // Whether Slate has extracted the plans this directive calls for.
  loaded: boolean("loaded").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

// A class is one grade + section + subject run by one owner (teacher, parent or tutor),
// e.g. Grade 8A Mathematics. Teacher-owned classes keep the teacher class unique key;
// parent/tutor classes are owned via parentId/tutorId with ownerType marking the kind.
export const classesTable = pgTable("slate_classes", {
  id: uuid("id").defaultRandom().primaryKey(),
  teacherId: uuid("teacher_id").references(() => teachersTable.id, { onDelete: "cascade" }),
  ownerType: text("owner_type").notNull().default("teacher"),
  parentId: uuid("parent_id").references(() => parentsTable.id, { onDelete: "cascade" }),
  tutorId: uuid("tutor_id").references(() => tutorsTable.id, { onDelete: "cascade" }),
  presetSubject: text("preset_subject").notNull().default(""),
  grade: integer("grade").notNull(),
  section: text("section").notNull().default(""),
  subject: text("subject").notNull(),
  schoolName: text("school_name").notNull(),
  joinCode: text("join_code").notNull().unique(),
  // A second, separate code that joins the class at HOD (supervisory) level.
  // Kept apart from the learner join code so a learner can never gain
  // supervisory access, and regenerating it never affects the learner code.
  hodJoinCode: text("hod_join_code").notNull().unique(),
  // Whether the teacher has switched script access on for this class. While it
  // is false an HOD sees class-level aggregates only; while true an HOD may
  // open individual marked scripts (read-only). The teacher owns this switch.
  hodCanViewScripts: boolean("hod_can_view_scripts").notNull().default(false),
  mode: text("mode").notNull().default("TEACHER_DEPENDENT"),
  curriculumText: text("curriculum_text"),
  curriculumFileName: text("curriculum_file_name"),
  // Curriculum is locked to the preset for the class's subject and grade; the
  // CAPS sequence is the source of truth. Any legacy owner-uploaded curriculum
  // is preserved here (never deleted) and no longer drives teaching.
  curriculumArchive: text("curriculum_archive"),
  // Set once, when the class is first locked to its preset. This is the marker
  // that says "do not re-lock" — editing a preset must never re-run the lock
  // over an existing class and rewind its teaching position.
  curriculumLockedAt: timestamp("curriculum_locked_at", { withTimezone: true }),
  lessonSequence: jsonb("lesson_sequence").$type<string[]>().notNull().default([]),
  currentTopicIndex: integer("current_topic_index").notNull().default(0),
  assignmentWindowDays: integer("assignment_window_days").notNull().default(7),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [unique("slate_classes_teacher_class_unique").on(table.teacherId, table.grade, table.section, table.subject)]);

// A learner belongs to one class per subject.
export const classLearnersTable = pgTable("slate_class_learners", {
  id: uuid("id").defaultRandom().primaryKey(),
  classId: uuid("class_id").notNull().references(() => classesTable.id, { onDelete: "cascade" }),
  learnerId: uuid("learner_id").notNull().references(() => learnersTable.id, { onDelete: "cascade" }),
  subject: text("subject").notNull(),
  joinedAt: timestamp("joined_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [unique("slate_class_learners_subject_unique").on(table.learnerId, table.subject)]);

// Study material a teacher uploads for a class: notes, revision material,
// class quizzes and demonstrations. Materials are learning resources, distinct
// from assignments (which carry marks and lock windows). A material may hold
// its content inline (notes pasted as text) or reference an uploaded file.
export const classMaterialsTable = pgTable("slate_class_materials", {
  id: uuid("id").defaultRandom().primaryKey(),
  classId: uuid("class_id").notNull().references(() => classesTable.id, { onDelete: "cascade" }),
  createdByTeacherId: uuid("created_by_teacher_id").references(() => teachersTable.id, { onDelete: "set null" }),
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  kind: text("kind").notNull().default("NOTE"),         // NOTE | REVISION | QUIZ | DEMONSTRATION
  content: text("content"),                              // inline text for notes / quizzes
  fileName: text("file_name"),
  fileType: text("file_type"),
  fileData: text("file_data"),                           // base64 payload, kept small (≤ ~3 MB)
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

// An HOD supervises a class at department level. The HOD is senior to the
// teacher: a teacher can never remove, block or hide a class from an HOD, so
// there is deliberately no teacher route that ends this row. Only the HOD
// themselves can leave (leftAt), and only Age Thirty4 support can remove them
// (removedAt/removedBy/removalReason) via the CLI script.
//
// The uniqueness rule is on the ACTIVE membership: a unique index covers
// (classId, hodUserId) WHERE left_at IS NULL AND removed_at IS NULL, so an HOD
// who left can rejoin later while an active duplicate is impossible.
export const classHodsTable = pgTable("slate_class_hods", {
  id: uuid("id").defaultRandom().primaryKey(),
  classId: uuid("class_id").notNull().references(() => classesTable.id, { onDelete: "cascade" }),
  hodUserId: uuid("hod_user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  joinedAt: timestamp("joined_at", { withTimezone: true }).defaultNow().notNull(),
  leftAt: timestamp("left_at", { withTimezone: true }),
  removedAt: timestamp("removed_at", { withTimezone: true }),
  removedBy: text("removed_by"),
  removalReason: text("removal_reason"),
});

export const assignmentsTable = pgTable("slate_assignments", {
  id: uuid("id").defaultRandom().primaryKey(),
  title: text("title").notNull(),
  subject: text("subject").notNull(),
  topic: text("topic").notNull(),
  curriculumContext: text("curriculum_context").notNull(),
  openAt: timestamp("open_at", { withTimezone: true }).notNull(),
  closeAt: timestamp("close_at", { withTimezone: true }).notNull(),
  questionCount: integer("question_count").notNull().default(5),
  classId: uuid("class_id").references(() => classesTable.id, { onDelete: "cascade" }),
  createdByTeacherId: uuid("created_by_teacher_id").references(() => teachersTable.id, { onDelete: "set null" }),
  // "auto" | "selective" | "manual": when to hand off to Gemini.
  // auto_mark_questions holds zero-based indices to auto-mark in selective mode.
  markingMode: text("marking_mode").notNull().default("auto"),
  autoMarkQuestions: integer("auto_mark_questions").array().$type<number[]>().default(sql`'{}'::integer[]`),
  questionTypes: text("question_types").array().$type<string[]>().notNull().default(sql`ARRAY['multiple_choice', 'text']::text[]`),
  questionBlueprint: jsonb("question_blueprint").$type<unknown[] | null>(),
  questionSource: text("question_source").notNull().default("ai"),
  isPublished: boolean("is_published").notNull().default(true),
  resultReleasePolicy: text("result_release_policy").notNull().default("after_close"),
  // Focus mode (tab lock). On by default; the teacher may turn it off until the
  // first submission. When on, leaving the page during homework is noticed.
  focusMode: boolean("focus_mode").notNull().default(true),
  // Teacher-controlled release. Null means results are held; a timestamp means
  // the teacher released them (any time, regardless of the release policy).
  resultsReleasedAt: timestamp("results_released_at", { withTimezone: true }),
  // Set when the teacher actively holds released results again.
  resultsHeldAt: timestamp("results_held_at", { withTimezone: true }),
});

export const assignmentSessionsTable = pgTable("slate_assignment_sessions", {
  id: uuid("id").defaultRandom().primaryKey(),
  assignmentId: uuid("assignment_id").notNull().references(() => assignmentsTable.id, { onDelete: "cascade" }),
  learnerId: uuid("learner_id").notNull().references(() => learnersTable.id, { onDelete: "cascade" }),
  questions: jsonb("questions").$type<unknown[]>().notNull(),
  openedAt: timestamp("opened_at", { withTimezone: true }).defaultNow().notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  // ---- Focus mode state. The server is the authority: the deadline is stored
  // here and the client can never extend it. Expiry is evaluated lazily on any
  // request that touches the attempt, timestamped at the deadline. ----
  focusWarningCount: integer("focus_warning_count").notNull().default(0),
  // When the learner is away, the moment they must be back by. Null = present.
  focusDeadlineAt: timestamp("focus_deadline_at", { withTimezone: true }),
  // When the current away period began (null = present).
  focusAwaySince: timestamp("focus_away_since", { withTimezone: true }),
  // Set once the attempt has been auto-submitted by focus mode, so the lazy
  // sweep does not submit the same attempt twice.
  focusAutoSubmittedAt: timestamp("focus_auto_submitted_at", { withTimezone: true }),
  // Debounced autosave of the learner's in-progress answers. Auto-submit marks
  // these, so an exit that ends the attempt never loses the learner's work.
  focusDraftAnswers: jsonb("focus_draft_answers").$type<Array<{ questionId: string; answer: string }>>(),
  // How many warnings the learner has acknowledged by tapping to continue. A
  // warning is outstanding while the count is higher than this.
  focusAcknowledgedWarnings: integer("focus_acknowledged_warnings").notNull().default(0),
});

export const submissionsTable = pgTable("slate_submissions", {
  id: uuid("id").defaultRandom().primaryKey(),
  assignmentId: uuid("assignment_id").notNull().references(() => assignmentsTable.id, { onDelete: "cascade" }),
  learnerId: uuid("learner_id").notNull().references(() => learnersTable.id, { onDelete: "cascade" }),
  sessionId: uuid("session_id").notNull().references(() => assignmentSessionsTable.id, { onDelete: "cascade" }),
  score: integer("score").notNull(),
  overallVerdict: text("overall_verdict").notNull(),
  feedback: text("feedback").notNull(),
  marks: jsonb("marks").$type<unknown[]>().notNull(),
  // "MARKED" once every question is resolved (auto, selective or manual).
  // Manual/selective submissions start as "PENDING_TEACHER_REVIEW".
  markingStatus: text("marking_status").notNull().default("MARKED"),
  answers: jsonb("answers").$type<Array<{ questionId: string; answer: string }>>(),
  submittedAt: timestamp("submitted_at", { withTimezone: true }).defaultNow().notNull(),
  // ---- Focus mode outcomes ----
  // True when focus mode submitted this paper for the learner (exit limit or
  // away timeout) rather than the learner pressing Submit.
  autoSubmitted: boolean("auto_submitted").notNull().default(false),
  autoSubmitReason: text("auto_submit_reason"),   // FOCUS_EXIT_LIMIT | FOCUS_AWAY_TIMEOUT
  // An auto-submitted paper's marks stay hidden from the learner and parent
  // until the teacher releases results, so focus mode never reveals a result the
  // learner did not get to earn. Cleared by the teacher's release action.
  resultsHeldForReview: boolean("results_held_for_review").notNull().default(false),
  // Set when the teacher reopens the paper after an auto-submit so the learner
  // may continue. The learner's submission is cleared and a fresh attempt runs.
  reopenedAt: timestamp("reopened_at", { withTimezone: true }),
  reopenedBy: uuid("reopened_by").references(() => usersTable.id, { onDelete: "set null" }),
  reopenReason: text("reopen_reason"),
});

// A privacy-minimal log of focus-mode exits. Records only the times and the
// duration of each exit — never URLs, page titles, app names, screenshots,
// camera frames or keystrokes.
export const focusEventsTable = pgTable("slate_focus_events", {
  id: uuid("id").defaultRandom().primaryKey(),
  submissionId: uuid("submission_id").references(() => submissionsTable.id, { onDelete: "cascade" }),
  sessionId: uuid("session_id").references(() => assignmentSessionsTable.id, { onDelete: "cascade" }),
  learnerId: uuid("learner_id").notNull().references(() => learnersTable.id, { onDelete: "cascade" }),
  leftAt: timestamp("left_at", { withTimezone: true }).notNull(),
  returnedAt: timestamp("returned_at", { withTimezone: true }),
  durationSeconds: integer("duration_seconds"),
  warningNumber: integer("warning_number").notNull().default(0),
  // IGNORED (under the 10s threshold) | WARNING | AUTO_SUBMITTED
  outcome: text("outcome").notNull().default("IGNORED"),
});

// A live class session. While one is active for a class, focus mode is
// alert-only: no warnings and no auto-submit. The teacher is alerted instead.
export const liveSessionsTable = pgTable("slate_live_sessions", {
  id: uuid("id").defaultRandom().primaryKey(),
  classId: uuid("class_id").notNull().references(() => classesTable.id, { onDelete: "cascade" }),
  startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
  endedAt: timestamp("ended_at", { withTimezone: true }),
  startedBy: uuid("started_by").references(() => usersTable.id, { onDelete: "set null" }),
});

// Per-class focus-mode exemption, set by the teacher (e.g. for assistive
// technology). An exempt learner is never warned and never auto-submitted.
export const classFocusExemptionsTable = pgTable("slate_class_focus_exemptions", {
  id: uuid("id").defaultRandom().primaryKey(),
  classId: uuid("class_id").notNull().references(() => classesTable.id, { onDelete: "cascade" }),
  learnerId: uuid("learner_id").notNull().references(() => learnersTable.id, { onDelete: "cascade" }),
  exempt: boolean("exempt").notNull().default(true),
  reason: text("reason").notNull().default(""),
  setBy: uuid("set_by").references(() => usersTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [unique("slate_class_focus_exemptions_unique").on(table.classId, table.learnerId)]);

// Teacher invites a tutor to share a class with read-only CLIP scope.
export const tutorInvitationsTable = pgTable("slate_tutor_invitations", {
  id: uuid("id").defaultRandom().primaryKey(),
  classId: uuid("class_id").notNull().references(() => classesTable.id, { onDelete: "cascade" }),
  invitedByUserId: uuid("invited_by_user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  tutorUserId: uuid("tutor_user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  status: text("status").notNull().default("PENDING"),       // PENDING | ACCEPTED | REJECTED
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [unique("slate_tutor_invitations_unique").on(table.classId, table.tutorUserId)]);

// Immutable audit record of staff actions (code rotation, invitations, expulsions).
export const auditLogTable = pgTable("slate_audit_log", {
  id: uuid("id").defaultRandom().primaryKey(),
  actorUserId: uuid("actor_user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  actorRole: text("actor_role").notNull(),
  action: text("action").notNull(),                          // e.g. "class_expul", "code_rotate", "tutor_invite"
  classId: uuid("class_id").references(() => classesTable.id, { onDelete: "cascade" }),
  targetMemberId: uuid("target_member_id"),
  memberType: text("member_type"),
  detail: text("detail").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const learningProfilesTable = pgTable("slate_learning_profiles", {
  learnerId: uuid("learner_id").primaryKey().references(() => learnersTable.id, { onDelete: "cascade" }),
  primaryStyle: text("primary_style").notNull().default("Discovering"),
  confidence: integer("confidence").notNull().default(0),
  signals: jsonb("signals").$type<unknown[]>().notNull().default([]),
  activeGaps: jsonb("active_gaps").$type<string[]>().notNull().default([]),
});

export const remediationActivitiesTable = pgTable("slate_remediation_activities", {
  id: uuid("id").defaultRandom().primaryKey(),
  learnerId: uuid("learner_id").notNull().references(() => learnersTable.id, { onDelete: "cascade" }),
  assignmentId: uuid("assignment_id").references(() => assignmentsTable.id, { onDelete: "set null" }),
  format: text("format").notNull(),
  title: text("title").notNull(),
  concept: text("concept").notNull(),
  prompt: text("prompt").notNull(),
  options: jsonb("options").$type<string[]>().notNull().default([]),
  instruction: text("instruction").notNull(),
  expectedAnswer: text("expected_answer").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  score: integer("score"),
});

export const learningActivitiesTable = pgTable("slate_learning_activities", {
  id: uuid("id").defaultRandom().primaryKey(),
  learnerId: uuid("learner_id").notNull().references(() => learnersTable.id, { onDelete: "cascade" }),
  label: text("label").notNull(),
  subject: text("subject").notNull(),
  score: integer("score").notNull(),
  detail: text("detail").notNull(),
  timestamp: timestamp("timestamp", { withTimezone: true }).defaultNow().notNull(),
});

// The teacher's memorandum for an assignment. It is concept-based: one model
// answer plus the marking method per numbered question, so the marker can derive
// the correct answer for any learner's variant of that question.
//   status: "draft" (editable, not publishable) | "confirmed"
//   source: "TEACHER" (typed or transcribed from an upload),
//           "AI_DRAFT_CONFIRMED" (AI drafted it in Teacher-Dependent mode and the
//           teacher edited and confirmed every item),
//           "AI_AUTO" (Independent mode's own answer key; no teacher gate).
// `samplesChecked` records that the teacher ran the variant preview and saw the
// AI read the memo back correctly before confirming.
export const memosTable = pgTable("slate_memos", {
  id: uuid("id").defaultRandom().primaryKey(),
  assignmentId: uuid("assignment_id").notNull().references(() => assignmentsTable.id, { onDelete: "cascade" }),
  status: text("status").notNull().default("draft"),
  source: text("source").notNull().default("TEACHER"),
  version: integer("version").notNull().default(1),
  confirmedBy: uuid("confirmed_by").references(() => usersTable.id, { onDelete: "set null" }),
  confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
  samplesChecked: boolean("samples_checked").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [unique("slate_memos_assignment_unique").on(table.assignmentId)]);

// One memorandum item per numbered question. `questionNumber` is the fixed
// numbering the learner sees ("1", "2", "1.1"), so an answer always maps to the
// memo item with the same number regardless of how the variant was worded.
// `markingGuide` says how the marks are split (e.g. "2 for the method, 3 for the
// answer"), which is what makes partial credit consistent.
export const memoItemsTable = pgTable("slate_memo_items", {
  id: uuid("id").defaultRandom().primaryKey(),
  memoId: uuid("memo_id").notNull().references(() => memosTable.id, { onDelete: "cascade" }),
  questionNumber: text("question_number").notNull(),
  modelAnswer: text("model_answer").notNull().default(""),
  markingGuide: text("marking_guide").notNull().default(""),
  acceptableAlternatives: jsonb("acceptable_alternatives").$type<string[]>().notNull().default([]),
}, (table) => [unique("slate_memo_items_unique").on(table.memoId, table.questionNumber)]);

// Per submission per question marking detail. This is the auditable record
// behind the per-question marks: how many of the available marks were awarded,
// what the AI derived as the expected answer for THIS learner's variant, why it
// awarded what it did, and whether a human needs to look at it. The last three
// are teacher-only and never reach a learner or parent.
export const markingResultsTable = pgTable("slate_marking_results", {
  id: uuid("id").defaultRandom().primaryKey(),
  submissionId: uuid("submission_id").notNull().references(() => submissionsTable.id, { onDelete: "cascade" }),
  questionNumber: text("question_number").notNull(),
  questionId: text("question_id").notNull().default(""),
  awardedMarks: integer("awarded_marks").notNull().default(0),
  maxMarks: integer("max_marks").notNull().default(0),
  derivedExpectedAnswer: text("derived_expected_answer").notNull().default(""),
  reason: text("reason").notNull().default(""),
  needsTeacherReview: boolean("needs_teacher_review").notNull().default(false),
  // "AI" | "TEACHER" | "MIXED": who last set this question's mark. The print
  // footer reports it as "AI against teacher memo", "teacher" or "mixed".
  markedBy: text("marked_by").notNull().default("AI"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [unique("slate_marking_results_unique").on(table.submissionId, table.questionNumber)]);

export const insertLearnerSchema = createInsertSchema(learnersTable);
export type Learner = typeof learnersTable.$inferSelect;
export type InsertLearner = typeof learnersTable.$inferInsert;
export type Assignment = typeof assignmentsTable.$inferSelect;
export type AssignmentSession = typeof assignmentSessionsTable.$inferSelect;
export type Submission = typeof submissionsTable.$inferSelect;
export type LearningProfile = typeof learningProfilesTable.$inferSelect;
export type RemediationActivity = typeof remediationActivitiesTable.$inferSelect;
export type Teacher = typeof teachersTable.$inferSelect;
export type Parent = typeof parentsTable.$inferSelect;
export type Tutor = typeof tutorsTable.$inferSelect;
export type TeacherClass = typeof classesTable.$inferSelect;
export type ClassLearner = typeof classLearnersTable.$inferSelect;
export type User = typeof usersTable.$inferSelect;
export type UserSession = typeof userSessionsTable.$inferSelect;
export type ParentLearner = typeof parentLearnersTable.$inferSelect;
export type TutorLearner = typeof tutorLearnersTable.$inferSelect;
export type LearnerSession = typeof learnerSessionsTable.$inferSelect;
export type TutorInvitation = typeof tutorInvitationsTable.$inferSelect;
export type ClassHod = typeof classHodsTable.$inferSelect;
export type AuditLogEntry = typeof auditLogTable.$inferSelect;
export type PresetCurriculum = typeof presetCurriculaTable.$inferSelect;
export type TeacherMarkingMode = "auto" | "selective" | "manual";
// MARKING_FAILED is set when every Gemini attempt failed: the submission and
// the learner's answers are saved intact so marking can be retried later
// instead of losing the work.
export type MarkingStatus = "MARKED" | "PENDING_TEACHER_REVIEW" | "MARKING_FAILED";
export type UserRole = "TEACHER" | "PARENT" | "TUTOR" | "HOD";

export type Memo = typeof memosTable.$inferSelect;
export type MemoItem = typeof memoItemsTable.$inferSelect;
export type MarkingResultRow = typeof markingResultsTable.$inferSelect;
export type MemoStatus = "draft" | "confirmed";
export type MemoSource = "TEACHER" | "AI_DRAFT_CONFIRMED" | "AI_AUTO";
export type MarkedBy = "AI" | "TEACHER" | "MIXED";
// Re-marking queue: a memo or marks revision after the first submission queues
// the affected papers here, so re-marking happens off the request path.
export const remarkQueueTable = pgTable("slate_remark_queue", {
  id: uuid("id").defaultRandom().primaryKey(),
  submissionId: uuid("submission_id").notNull().references(() => submissionsTable.id, { onDelete: "cascade" }),
  assignmentId: uuid("assignment_id").notNull().references(() => assignmentsTable.id, { onDelete: "cascade" }),
  reason: text("reason").notNull().default(""),
  status: text("status").notNull().default("PENDING"),
  attempts: integer("attempts").notNull().default(0),
  lastError: text("last_error"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  processedAt: timestamp("processed_at", { withTimezone: true }),
}, (table) => [unique("slate_remark_queue_submission_unique").on(table.submissionId, table.status)]);

export type RemarkQueueRow = typeof remarkQueueTable.$inferSelect;
