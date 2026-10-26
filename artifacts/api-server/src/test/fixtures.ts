import { client, type TestClient } from "./harness";
import type { GeneratedQuestion } from "../lib/ai";

// Test fixtures built entirely through the public HTTP API, so the setup path
// exercises the same code the app uses (no direct SQL shortcuts that could
// hide a regression in a route).

export const SAMPLE_QUESTIONS: GeneratedQuestion[] = [
  // 10 marks each, so a whole number of marks can express any 10% step and the
  // tests can assert on a percentage that comes from real mark totals.
  { id: "q1", prompt: "What is 2 + 2?", type: "text", options: [], concept: "Addition", answer: "4", questionNumber: "1", marks: 10 },
  { id: "q2", prompt: "What is 5 × 3?", type: "text", options: [], concept: "Multiplication", answer: "15", questionNumber: "2", marks: 10 },
  { id: "q3", prompt: "What is 10 − 4?", type: "text", options: [], concept: "Subtraction", answer: "6", questionNumber: "3", marks: 10 },
];

// The number of marks the shared mock awards for one question.
export type MockMarkingOptions = {
  // Fraction of the available marks to award, 0 to 1.
  ratio?: number;
  // Set to hold the paper back for the teacher, as a marker that cannot place
  // the answer against the memo does.
  needsTeacherReview?: boolean;
  gap?: string | null;
  // A remediation activity the marker offers for the one concept gap.
  remediation?: Record<string, unknown> | null;
};

// A memo-aware Gemini stand-in for the tests.
//
// The marker now works from the memorandum: the prompt names each item's
// question number and its maxMarks, so this reads those back out and awards a
// whole number of marks. It answers the other memo prompts too, so a test never
// reaches the network. Tests that need a different result build their own model
// and only mirror the "Mark this learner's answers" branch.
export function memoAwareMarkingModel(options: MockMarkingOptions = {}) {
  const ratio = options.ratio ?? 1;
  return {
    generateContent: async (parts: Array<{ text?: string }>) => {
      const prompt = parts.map((part) => part.text ?? "").join("\n");
      const json = (value: unknown) => ({ response: { text: () => JSON.stringify(value) } });
      if (prompt.includes("Mark this learner's answers")) {
        // The items are the JSON array after the "Items: " marker.
        const raw = prompt.slice(prompt.indexOf("Items: ") + "Items: ".length);
        const items = JSON.parse(raw) as Array<{ questionNumber: string; maxMarks: number }>;
        return json({
          marks: items.map((item) => ({
            questionNumber: item.questionNumber,
            awardedMarks: Math.round(item.maxMarks * ratio),
            derivedExpectedAnswer: "4",
            reason: ratio === 1 ? "Correct." : "Partly right.",
            needsTeacherReview: options.needsTeacherReview ?? false,
            gap: options.gap ?? null,
          })),
          overallFeedback: ratio === 1 ? "Well done." : "Good effort.",
          overallVerdict: ratio === 1 ? "CORRECT" : "PARTIALLY_CORRECT",
          remediation: options.remediation ?? null,
        });
      }
      if (prompt.includes("drafting a memorandum")) {
        return json({ items: [] });
      }
      if (prompt.includes("checking that a memorandum is written clearly")) {
        return json({ variants: [] });
      }
      if (prompt.includes("Memorandum text:")) {
        return json({ items: [] });
      }
      // Question generation: a valid draft so the AI-sourced path works offline.
      return json([
        { id: "q1", prompt: "What is 2 + 2?", type: "text", options: [], concept: "Addition", answer: "4", questionNumber: "1", marks: 1 },
      ]);
    },
  } as never;
}

// A model that marks every answer wrong and offers remediation, so a test can
// prove a remediation activity is hidden until the result is released.
export function wrongWithRemediationModel() {
  return memoAwareMarkingModel({
    ratio: 0,
    gap: "place value",
    remediation: { format: "QUIZ", title: "Place value practice", concept: "place value", prompt: "What is 10 × 3?", options: ["30", "13"], instruction: "Pick one", expectedAnswer: "30" },
  });
}

// Saves and confirms a memorandum so an assignment can be published. Every
// teacher or tutor assignment needs one, manual marking included.
export async function confirmMemo(
  teacher: TestClient,
  assignmentId: string,
  questions: GeneratedQuestion[] = SAMPLE_QUESTIONS,
) {
  const items = questions.map((question, index) => ({
    questionNumber: question.questionNumber ?? `${index + 1}`,
    modelAnswer: question.answer,
    markingGuide: `Full marks for the correct answer.`,
    acceptableAlternatives: [],
  }));
  const saved = await teacher.post(`/api/tis/assignments/${assignmentId}/memo`, {
    items,
    source: "TEACHER",
    confirm: true,
    samplesChecked: true,
  });
  if (saved.status !== 200) throw new Error(`memo save failed: ${saved.status} ${JSON.stringify(saved.body)}`);
  return items;
}

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
    // Marks per question travel with the draft so publish has an allocation to
    // work with; the numbering is derived from position.
    questions: questions.map(({ id, prompt, type, options: opts, concept, answer, questionNumber, marks }) => ({ id, prompt, type, options: opts, concept, answer, questionNumber, marks })),
  });
  if (created.status !== 201) throw new Error(`assignment creation failed: ${created.status} ${JSON.stringify(created.body)}`);
  const assignmentId = created.body.assignments[0].id;
  // Marks per question and a confirmed memorandum are a publish prerequisite.
  await confirmMemo(teacher, assignmentId, questions);
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
