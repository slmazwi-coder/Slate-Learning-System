export type MarkedScriptQuestion = {
  questionId: string;
  prompt: string;
  type: string;
  options: string[];
  concept: string;
  learnerAnswer: string | null;
  verdict: string | null;
  score: number | null;
  correctAnswer: string;
  explanation: string;
  gap: string | null;
};

export type MarkedScript = {
  submissionId?: string;
  assignment: { id: string; title: string; subject: string; topic: string; questionCount?: number };
  learner?: { id: string; fullName: string; username: string; grade: number };
  class?: { id: string; label: string } | null;
  score: number;
  overallVerdict: string;
  feedback: string;
  markingStatus: string;
  submittedAt?: string;
  editable: boolean;
  questions: MarkedScriptQuestion[];
};

export const verdictLabel: Record<string, string> = {
  CORRECT: 'Correct',
  PARTIALLY_CORRECT: 'Partially correct',
  INCORRECT: 'Incorrect',
  PENDING_TEACHER_REVIEW: 'Awaiting review',
};

export function verdictTone(verdict: string | null) {
  if (verdict === 'CORRECT') return 'bg-[hsl(var(--secondary))] text-[hsl(var(--secondary-foreground))]';
  if (verdict === 'PARTIALLY_CORRECT') return 'bg-[#f7e8be] text-[#74551f]';
  if (verdict === 'INCORRECT') return 'bg-[#f8dcd6] text-[#93473a]';
  return 'bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))]';
}
