import { client, type TestClient } from "./harness";
import type { GeneratedQuestion } from "../lib/ai";

// Test fixtures built entirely through the public HTTP API, so the setup path
// exercises the same code the app uses (no direct SQL shortcuts that could
// hide a regression in a route).

export const SAMPLE_QUESTIONS: GeneratedQuestion[] = [
  { id: "q1", prompt: "What is 2 + 2?", type: "text", options: [], concept: "Addition", answer: "4" },
  { id: "q2", prompt: "What is 5 × 3?", type: "text", options: [], concept: "Multiplication", answer: "15" },
  { id: "q3", prompt: "What is 10 − 4?", type: "text", options: [], concept: "Subtraction", answer: "6" },
];

let counter = 0;
export function uniqueEmail(prefix: string) {
  counter += 1;
  return `${prefix}-${Date.now()}-${counter}@example.com`;
}

export async function registerTeacher(options: { grade?: number; subject?: string; section?: string; fullName?: string } = {}) {
  const c = client();
  const email = uniqueEmail("teacher");
  const response = await c.post("/api/tis/auth/register", {
    fullName: options.fullName ?? "Test Teacher",
    email,
    schoolName: "Test High",
    password: "password123",
    classes: [{ grade: options.grade ?? 8, section: options.section ?? "A", subject: options.subject ?? "Mathematics" }],
  });
  if (response.status !== 201) throw new Error(`teacher registration failed: ${response.status} ${JSON.stringify(response.body)}`);
  return { client: c, email, teacher: response.body.teacher, classes: response.body.classes as any[] };
}

export async function registerLearner(options: { grade?: number; subjects?: string[] } = {}) {
  const c = client();
  const response = await c.post("/api/auth/register", {
    username: `learner${Date.now()}${counter++}`.slice(0, 32),
    password: "password123",
    fullName: "Test Learner",
    grade: options.grade ?? 8,
    schoolName: "Test High",
    email: uniqueEmail("learner"),
    age: 13,
    gender: "girl",
    subjects: options.subjects ?? ["Mathematics"],
  });
  if (response.status !== 201) throw new Error(`learner registration failed: ${response.status} ${JSON.stringify(response.body)}`);
  return { client: c, learner: response.body.learner };
}

export async function registerParent() {
  const c = client();
  const email = uniqueEmail("parent");
  const response = await c.post("/api/parent/auth/register", { fullName: "Test Parent", email, password: "password123" });
  if (response.status !== 201) throw new Error(`parent registration failed: ${response.status} ${JSON.stringify(response.body)}`);
  return { client: c, email, parent: response.body.parent };
}

export async function registerTutor() {
  const c = client();
  const email = uniqueEmail("tutor");
  const response = await c.post("/api/tutor/auth/register", { fullName: "Test Tutor", email, password: "password123" });
  if (response.status !== 201) throw new Error(`tutor registration failed: ${response.status} ${JSON.stringify(response.body)}`);
  return { client: c, email, tutor: response.body.tutor };
}

export async function joinClass(learner: TestClient, joinCode: string) {
  const response = await learner.post("/api/classes/join", { joinCode });
  if (response.status !== 201) throw new Error(`join failed: ${response.status} ${JSON.stringify(response.body)}`);
  return response.body;
}

export async function registerHod() {
  const c = client();
  const email = uniqueEmail("hod");
  const response = await c.post("/api/hod/auth/register", { fullName: "Test HOD", email, password: "password123" });
  if (response.status !== 201) throw new Error(`hod registration failed: ${response.status} ${JSON.stringify(response.body)}`);
  return { client: c, email, hod: response.body.hod };
}

export async function joinClassAsHod(hod: TestClient, hodJoinCode: string) {
  const response = await hod.post("/api/hod/join", { code: hodJoinCode });
  if (response.status !== 201) throw new Error(`hod join failed: ${response.status} ${JSON.stringify(response.body)}`);
  return response.body;
}

export type AssignmentOptions = {
  topic?: string;
  questionCount?: number;
  markingMode?: "auto" | "selective" | "manual";
  autoMarkQuestions?: number[];
  resultReleasePolicy?: "after_close" | "immediate";
  questions?: GeneratedQuestion[];
  closeInMinutes?: number;
};

export async function createPublishedAssignment(
  teacher: TestClient,
  classId: string,
  options: AssignmentOptions = {},
) {
  const questions = (options.questions ?? SAMPLE_QUESTIONS).slice(0, options.questionCount ?? 3);
  const now = Date.now();
  const created = await teacher.post("/api/tis/assignments", {
    classIds: [classId],
    topic: options.topic ?? "Equivalent fractions",
    questionCount: questions.length,
    openAt: new Date(now - 60_000).toISOString(),
    closeAt: new Date(now + (options.closeInMinutes ?? 60) * 60_000).toISOString(),
    markingMode: options.markingMode ?? "auto",
    autoMarkQuestions: options.autoMarkQuestions,
    resultReleasePolicy: options.resultReleasePolicy ?? "after_close",
    // Manual authoring keeps the fixture deterministic: no Gemini call is made
    // while preparing the draft.
    questionSource: "manual",
    questions: questions.map(({ id, prompt, type, options: opts, concept, answer }) => ({ id, prompt, type, options: opts, concept, answer })),
  });
  if (created.status !== 201) throw new Error(`assignment creation failed: ${created.status} ${JSON.stringify(created.body)}`);
  const assignmentId = created.body.assignments[0].id;
  const published = await teacher.post(`/api/tis/assignments/${assignmentId}/publish`, { questions });
  if (published.status !== 200) throw new Error(`publish failed: ${published.status} ${JSON.stringify(published.body)}`);
  return { assignmentId, questions };
}

// Opens the assignment for a learner and submits the given answers.
export async function submitAssignment(
  learner: TestClient,
  assignmentId: string,
  answers: Array<{ questionId: string; answer: string }>,
) {
  const opened = await learner.post(`/api/assignments/${assignmentId}/open`, {});
  if (opened.status !== 200) throw new Error(`open failed: ${opened.status} ${JSON.stringify(opened.body)}`);
  const submitted = await learner.post(`/api/assignments/${assignmentId}/submit`, {
    sessionId: opened.body.sessionId,
    answers,
  });
  return submitted;
}
