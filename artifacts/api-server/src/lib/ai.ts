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

const SEQUENCE_PROMPT_SUFFIX = `Return JSON shaped exactly like { "sequence": ["topic 1", "topic 2", "..."] } with 8 to 24 entries. Each entry is a short, teachable topic title (3-8 words), ordered from first to last, foundational topics first. No numbering inside the titles.`;

function cleanSequence(raw: unknown): string[] {
  if (!raw || typeof raw !== "object" || !Array.isArray((raw as { sequence?: unknown }).sequence)) return [];
  return (raw as { sequence: unknown[] }).sequence
    .map((entry) => String(entry).replace(/^\s*\d+[.)-]?\s*/, "").trim())
    .filter((entry) => entry.length >= 3)
    .slice(0, 40);
}

// Reads an uploaded curriculum (text or PDF) and extracts the ordered lesson sequence.
export async function extractLessonSequence(input: {
  grade: number;
  subject: string;
  text?: string;
  pdfBase64?: string;
}): Promise<string[]> {
  const instruction = `This is the curriculum or programme document for a Grade ${input.grade} ${input.subject} class. Read it and extract the ordered sequence of lessons/topics it covers. ${SEQUENCE_PROMPT_SUFFIX}`;
  const parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [];
  if (input.pdfBase64) {
    parts.push({ inlineData: { mimeType: "application/pdf", data: input.pdfBase64 } });
    parts.push({ text: instruction });
  } else {
    parts.push({ text: `${instruction}\nThe document is delimited by triple hyphens.\n---\n${(input.text ?? "").slice(0, 60000)}\n---` });
  }
  const response = await getModel().generateContent(parts);
  const parsed = JSON.parse(extractJson(response.response.text()));
  const sequence = cleanSequence(parsed);
  if (!sequence.length) throw new Error("No lesson sequence could be extracted from that document.");
  return sequence;
}

// Builds a default CAPS-aligned sequence when no curriculum document was uploaded.
export async function generateDefaultSequence(input: { grade: number; subject: string }): Promise<string[]> {
  const parsed = await askJson<{ sequence: string[] }>(`List the ordered sequence of core topics for Grade ${input.grade} ${input.subject} under the South African CAPS curriculum, as a full-year teaching sequence. ${SEQUENCE_PROMPT_SUFFIX}`);
  const sequence = cleanSequence(parsed);
  if (!sequence.length) throw new Error("No default sequence available.");
  return sequence;
}

export type ActivityType = "quiz" | "matching" | "puzzle" | "case_study" | "fill_blanks" | "drag_drop";

export type RecommendedActivity = {
  type: ActivityType;
  title: string;
  concept: string;
  content: {
    prompt: string;
    options: string[];
    instruction: string;
    expectedAnswer: string;
  };
};

// Generates engaging gap-targeted activities rooted in South African names,
// food and places, for the Activities engine.
export async function generateRecommendedActivities(input: {
  learnerName: string;
  grade: number;
  style: string;
  gaps: string[];
  subjects: string[];
  count?: number;
}): Promise<RecommendedActivity[]> {
  const count = input.count ?? 3;
  const gaps = input.gaps.length ? input.gaps : input.subjects.slice(0, 3);
  const parsed = await askJson<{ activities: RecommendedActivity[] }>(`You are designing short, fun learning activities for a Grade ${input.grade} South African learner named ${input.learnerName}, whose detected learning style is "${input.style}" and subjects are ${JSON.stringify(input.subjects)}. Target these concept gaps: ${JSON.stringify(gaps)}. Create ${count} activities. Every activity uses South African context — names like Ayanda, Bongani, Sipho, Lerato; food like boerewors, koeksisters, vetkoek; places like Table Mountain, uShaka Marine World, Soweto, Durban beachfront. Use only these types: quiz | matching | puzzle | case_study | fill_blanks | drag_drop. Return JSON exactly like { "activities": [{ "type": "quiz", "title": "fun title", "concept": "one targeted gap", "content": { "prompt": "the question or interaction task", "options": ["choices for quiz, pairs for matching/drag_drop, blanks context for fill_blanks"], "instruction": "how the learner answers", "expectedAnswer": "the correct answer or completion description" } }] }. Each activity must target exactly one gap from the list when possible.`);
  const activities = Array.isArray(parsed?.activities) ? parsed.activities : [];
  return activities
    .filter((activity) => activity?.type && activity?.title && activity?.concept && activity?.content?.prompt)
    .filter((activity) => ["quiz", "matching", "puzzle", "case_study", "fill_blanks", "drag_drop"].includes(activity.type))
    .slice(0, count);
}
