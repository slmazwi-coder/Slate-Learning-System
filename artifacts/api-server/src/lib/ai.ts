import { GoogleGenerativeAI } from "@google/generative-ai";

const SYSTEM_INSTRUCTION =
  "You are the ALIS learning intelligence engine for South African school learners. Return only valid JSON, with no markdown or commentary. Use age-appropriate language and South African context when it helps.";

const DEFAULT_MODEL = "gemini-2.5-flash";

let cachedModel: ReturnType<GoogleGenerativeAI["getGenerativeModel"]> | null = null;

function getModel() {
  if (cachedModel) return cachedModel;
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY must be configured");
  cachedModel = new GoogleGenerativeAI(apiKey).getGenerativeModel({
    model: process.env.GEMINI_MODEL || DEFAULT_MODEL,
    systemInstruction: SYSTEM_INSTRUCTION,
    generationConfig: {
      maxOutputTokens: 8192,
      responseMimeType: "application/json",
      temperature: 1,
    },
  });
  return cachedModel;
}

function extractJson(text: string) {
  const cleaned = text
    .replace(/^\s*```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
  if (!cleaned) throw new Error("Gemini returned no text.");
  return cleaned;
}

async function askJson<T>(prompt: string): Promise<T> {
  const response = await getModel().generateContent(prompt);
  return JSON.parse(extractJson(response.response.text())) as T;
}

export type GeneratedQuestion = {
  id: string;
  prompt: string;
  type: "text" | "equation" | "multiple_choice";
  options?: string[];
  concept: string;
  answer: string;
};

export async function generateProblemSet(input: {
  learnerId: string;
  learnerName: string;
  grade: number;
  subject: string;
  topic: string;
  curriculumContext: string;
  questionCount: number;
  uniquenessSeed: string;
}) {
  return askJson<GeneratedQuestion[]>(`Create exactly ${input.questionCount} original questions for a Grade ${input.grade} learner named ${input.learnerName}. Assignment subject: ${input.subject}. Topic: ${input.topic}. Curriculum context: ${input.curriculumContext}. This is a private problem set for learner ${input.learnerId}; uniqueness seed: ${input.uniquenessSeed}. Keep every question aligned to the same learning objectives while varying names, values, numbers, and contexts so no learner receives an identical set. Include a hidden concise answer string for marking. Use question types text, equation, or multiple_choice. Return a JSON array with objects shaped exactly like { "id": "q1", "prompt": "...", "type": "text", "options": [], "concept": "...", "answer": "..." }.`);
}

export type MarkingResult = {
  score: number;
  overallVerdict: "CORRECT" | "INCORRECT" | "PARTIALLY_CORRECT";
  feedback: string;
  marks: Array<{
    questionId: string;
    verdict: "CORRECT" | "INCORRECT" | "PARTIALLY_CORRECT";
    explanation: string;
    score: number;
    gap: string | null;
  }>;
  remediation: {
    format: "QUIZ" | "GAME" | "PUZZLE" | "CASE_STUDY" | "ASSESSMENT";
    title: string;
    concept: string;
    prompt: string;
    options: string[];
    instruction: string;
    expectedAnswer: string;
  } | null;
};

export async function markAssignment(input: {
  subject: string;
  topic: string;
  questions: GeneratedQuestion[];
  answers: Array<{ questionId: string; answer: string }>;
}) {
  return askJson<MarkingResult>(`Mark this learner's assignment. Subject: ${input.subject}. Topic: ${input.topic}. Questions and answer keys: ${JSON.stringify(input.questions.map(({ id, prompt, concept, answer }) => ({ id, prompt, concept, answer })))}. Learner answers: ${JSON.stringify(input.answers)}. Evaluate fairly: score each answer, identify the specific concept gap for wrong or incomplete answers, and produce brief age-appropriate explanations. If there is a meaningful gap, generate one fresh remediation activity matched to the concept. Return JSON shaped exactly like { "score": 0, "overallVerdict": "CORRECT", "feedback": "...", "marks": [{ "questionId": "q1", "verdict": "CORRECT", "explanation": "...", "score": 100, "gap": null }], "remediation": null }. If remediation is needed, set remediation to { "format": "QUIZ", "title": "...", "concept": "...", "prompt": "...", "options": [], "instruction": "...", "expectedAnswer": "..." }. Choose the format based on a learner profile that is currently still discovering its best format; prefer a short QUIZ or PUZZLE for a first activity.`);
}

export async function markRemediation(input: {
  concept: string;
  format: string;
  prompt: string;
  expectedAnswer: string;
  answer: string;
}) {
  return askJson<{ correct: boolean; feedback: string; score: number }>(`Evaluate this learner response. Concept: ${input.concept}. Activity format: ${input.format}. Prompt: ${input.prompt}. Expected answer: ${input.expectedAnswer}. Learner answer: ${input.answer}. Return JSON exactly like { "correct": true, "feedback": "...", "score": 100 }. Be encouraging but accurate.`);
}

export type LessonPlanAnalysis = {
  covered: Array<{ concept: string; evidence: string }>;
  notCovered: Array<{ concept: string; strugglingPercentage: number; why: string }>;
  suggestions: string[];
  revisedLessonPlan: string;
};

export async function analyseLessonPlan(input: {
  grade: number;
  section: string;
  subject: string;
  gaps: Array<{ concept: string; strugglingPercentage: number; averageScore: number }>;
  lessonPlan: string;
}) {
  return askJson<LessonPlanAnalysis>(`You are advising a South African teacher preparing for Grade ${input.grade}${input.section} ${input.subject}. Their class concept gaps, measured from learner submissions, are: ${JSON.stringify(input.gaps)}. Their current lesson plan is delimited by triple hyphens.\n---\n${input.lessonPlan}\n---\nAnalyse the lesson plan against the measured gaps. Return JSON shaped exactly like { "covered": [{ "concept": "...", "evidence": "quote or paraphrase of the part of the plan that addresses it" }], "notCovered": [{ "concept": "...", "strugglingPercentage": 0, "why": "what is missing" }], "suggestions": ["specific, practical adjustment"], "revisedLessonPlan": "a full revised lesson plan the teacher can copy and teach, keeping their structure and voice while covering the missing gaps" }. Be concrete and CAPS-aligned; reference class time, activities and assessment.`);
}

export async function generateFollowUp(input: { concept: string; subject?: string }) {
  return askJson<{ id: string; prompt: string; type: "text"; concept: string; options: string[]; answer: string }>(`Create one fresh, short follow-up question for a Grade 4–12 learner who just practised the concept "${input.concept}"${input.subject ? ` in ${input.subject}` : ""}. Vary the numbers and context. Return JSON exactly like { "id": "follow-up", "prompt": "...", "type": "text", "concept": "${input.concept}", "options": [], "answer": "..." }.`);
}
