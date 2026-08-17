import {
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";

export const learnersTable = pgTable("slate_learners", {
  id: uuid("id").defaultRandom().primaryKey(),
  username: text("username").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  fullName: text("full_name").notNull(),
  grade: integer("grade").notNull(),
  schoolName: text("school_name").notNull(),
  subjects: jsonb("subjects").$type<string[]>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const authSessionsTable = pgTable("slate_auth_sessions", {
  id: uuid("id").defaultRandom().primaryKey(),
  learnerId: uuid("learner_id").notNull().references(() => learnersTable.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
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