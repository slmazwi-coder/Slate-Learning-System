export type MarkedScriptQuestion = {
  index: number;
  questionId: string;
  prompt: string;
  type: string;
  options: string[];
  concept: string;
  learnerAnswer: string;
  verdict: string | null;
  score: number | null;
  correctAnswer: string;
  explanation: string;
  gap: string | null;
};

export type MarkedScript = {
  submission: {
    id: string;
    submittedAt: string;
    score: number;
    overallVerdict: string;
    feedback: string;
    markingStatus: string;
    released: boolean;
  };
  assignment: {
    id: string;
    title: string;
    subject: string;
    topic: string;
    closeAt: string;
  };
  learner: {
    id: string;
    fullName: string;
    username: string;
  };
  questions: MarkedScriptQuestion[];
};