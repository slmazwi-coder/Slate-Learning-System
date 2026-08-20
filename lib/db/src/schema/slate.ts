import {
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";

export const parentsTable = pgTable("slate_parents", {
  id: uuid("id").defaultRandom().primaryKey(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  fullName: text("full_name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const tutorsTable = pgTable("slate_tutors", {
  id: uuid("id").defaultRandom().primaryKey(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  fullName: text("full_name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const learnersTable = pgTable("slate_learners", {
  id: uuid("id").defaultRandom().primaryKey(),
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

// A class is one grade + section + subject run by one owner (teacher, parent or tutor),
// e.g. Grade 8A Mathematics. Teacher-owned classes keep the teacher class unique key;
// parent/tutor classes are owned via parentId/tutorId with ownerType marking the kind.
export const classesTable = pgTable("slate_classes", {
  id: uuid("id").defaultRandom().primaryKey(),
  teacherId: uuid("teacher_id").references(() => teachersTable.id, { onDelete: "cascade" }),
  ownerType: text("owner_type").notNull().default("teacher"),
  parentId: uuid("parent_id").references(() => parentsTable.id, { onDelete: "cascade" }),
  tutorId: uuid("tutor_id").references(() => tutorsTable.id, { onDelete: "cascade" }),
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
  submittedAt: timestamp("submitted_at", { withTimezone: true }).defaultNow().notNull(),
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