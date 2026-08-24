import {
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
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const tutorsTable = pgTable("slate_tutors", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").references(() => usersTable.id, { onDelete: "cascade" }),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  fullName: text("full_name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const learnersTable = pgTable("slate_learners", {
  id: uuid("id").defaultRandom().primaryKey(),
  // Learners keep username login (many school learners have no email), and
  // link to a unified account only when an email is supplied, so one person
  // can hold LEARNER alongside TEACHER/PARENT/TUTOR on a single identity.
  userId: uuid("user_id").references(() => usersTable.id, { onDelete: "set null" }),
  username: text("username").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  fullName: text("full_name").notNull(),
  grade: integer("grade").notNull(),
  schoolName: text("school_name").notNull(),
  subjects: jsonb("subjects").$type<string[]>().notNull(),
  parentId: uuid("parent_id").references(() => parentsTable.id, { onDelete: "cascade" }),
  tutorId: uuid("tutor_id").references(() => tutorsTable.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const authSessionsTable = pgTable("slate_auth_sessions", {
  id: uuid("id").defaultRandom().primaryKey(),
  learnerId: uuid("learner_id").notNull().references(() => learnersTable.id, { onDelete: "cascade" }),
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
  schoolName: text("school_name").notNull(),
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
  mode: text("mode").notNull().default("TEACHER_DEPENDENT"),
  curriculumText: text("curriculum_text"),
  curriculumFileName: text("curriculum_file_name"),
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
});

export const assignmentSessionsTable = pgTable("slate_assignment_sessions", {
  id: uuid("id").defaultRandom().primaryKey(),
  assignmentId: uuid("assignment_id").notNull().references(() => assignmentsTable.id, { onDelete: "cascade" }),
  learnerId: uuid("learner_id").notNull().references(() => learnersTable.id, { onDelete: "cascade" }),
  questions: jsonb("questions").$type<unknown[]>().notNull(),
  openedAt: timestamp("opened_at", { withTimezone: true }).defaultNow().notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
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
});

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
export type TutorInvitation = typeof tutorInvitationsTable.$inferSelect;
export type AuditLogEntry = typeof auditLogTable.$inferSelect;
export type PresetCurriculum = typeof presetCurriculaTable.$inferSelect;
export type TeacherMarkingMode = "auto" | "selective" | "manual";
export type MarkingStatus = "MARKED" | "PENDING_TEACHER_REVIEW";
export type UserRole = "TEACHER" | "PARENT" | "TUTOR";