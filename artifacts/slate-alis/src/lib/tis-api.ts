import { useMutation, useQuery, useQueryClient, type UseQueryOptions } from '@tanstack/react-query';

export type TeacherClass = {
  id: string;
  grade: number;
  section: string;
  subject: string;
  schoolName: string;
  joinCode: string;
  label: string;
  learnerCount: number;
};

export type TeacherAccount = {
  id: string;
  email: string;
  fullName: string;
  schoolName: string;
  createdAt: string;
};

export type ClassGapAlert = {
  concept: string;
  strugglingPercentage: number;
  strugglingLearners: number;
  learnersAssessed: number;
  averageScore: number;
  message: string;
};

export type ConceptGap = {
  concept: string;
  learnersAssessed: number;
  strugglingLearners: number;
  strugglingPercentage: number;
  averageScore: number;
};

export type ClassLearnerRow = {
  id: string;
  fullName: string;
  username: string;
  averageScore: number;
  submissionCount: number;
  missedAssignments: number;
  lastActive: string | null;
  streakDays: number;
  strongestConcept: string | null;
  weakestConcept: string | null;
  flags: string[];
};

export type ClassAssignmentRow = {
  id: string;
  title: string;
  subject: string;
  topic: string;
  openAt: string;
  closeAt: string;
  questionCount: number;
  status: 'LOCKED' | 'OPEN' | 'CLOSED';
  learnerCount: number;
  started: number;
  submitted: number;
  missed: number;
  notStarted: number;
  averageScore: number;
};

export type ClassPerformance = {
  trend: 'IMPROVING' | 'STAGNATING' | 'DECLINING' | 'NOT_ENOUGH_DATA';
  classAverage: number;
  points: Array<{
    assignmentId: string;
    title: string;
    topic: string;
    openAt: string;
    submissions: number;
    averageScore: number;
    isLowest: boolean;
  }>;
};

export type ClassOverview = {
  class: TeacherClass;
  learners: ClassLearnerRow[];
  conceptGaps: ConceptGap[];
  gapAlert: ClassGapAlert | null;
  assignments: ClassAssignmentRow[];
  performance: ClassPerformance;
};

export type ClassSummaryRow = TeacherClass & {
  classAverage: number;
  trend: ClassPerformance['trend'];
  learnersWithGaps: number;
  topStrugglingConcept: string | null;
  topStrugglingPercentage: number;
  gapAlert: ClassGapAlert | null;
};

export type LearnerDrillDown = {
  class: TeacherClass;
  learner: { id: string; fullName: string; username: string; grade: number; schoolName: string };
  assignmentHistory: Array<{ assignmentId: string; title: string; topic: string; score: number; verdict: string; submittedAt: string }>;
  conceptsMastered: Array<{ concept: string; averageScore: number; attempts: number }>;
  conceptsDeveloping: Array<{ concept: string; averageScore: number; attempts: number }>;
  learningStyle: Array<{ format: string; averageScore: number; attempts: number }>;
  activities: Array<{ id: string; format: string; title: string; concept: string; completedAt: string | null; score: number | null; helped: boolean | null }>;
  persistentGaps: Array<{ concept: string; failures: number; formats: string[] }>;
};

export type LessonPlanAnalysis = {
  class: TeacherClass;
  gaps: Array<{ concept: string; strugglingPercentage: number; averageScore: number }>;
  analysis: {
    covered: Array<{ concept: string; evidence: string }>;
    notCovered: Array<{ concept: string; strugglingPercentage: number; why: string }>;
    suggestions: string[];
    revisedLessonPlan: string;
  };
};

export class TisError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, {
    credentials: 'same-origin',
    headers: init?.body ? { 'content-type': 'application/json' } : undefined,
    ...init,
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) {
    const message = data && typeof data === 'object' && 'error' in data ? String(data.error) : 'Something went wrong. Please try again.';
    throw new TisError(response.status, message);
  }
  return data as T;
}

export const teacherKeys = {
  me: ['tis', 'me'] as const,
  summary: ['tis', 'summary'] as const,
  overview: (classId: string) => ['tis', 'overview', classId] as const,
  learner: (classId: string, learnerId: string) => ['tis', 'learner', classId, learnerId] as const,
};

type Query<T> = Omit<UseQueryOptions<T, TisError>, 'queryKey' | 'queryFn'>;

export function useTeacherSession(options?: Query<{ teacher: TeacherAccount | null; classes: TeacherClass[] }>) {
  return useQuery<{ teacher: TeacherAccount | null; classes: TeacherClass[] }, TisError>({
    queryKey: teacherKeys.me,
    queryFn: () => request('/tis/auth/me'),
    retry: false,
    ...options,
  });
}

export function useClassOverview(classId: string | null) {
  return useQuery<ClassOverview, TisError>({
    queryKey: teacherKeys.overview(classId ?? 'none'),
    queryFn: () => request(`/tis/classes/${classId}/overview`),
    enabled: Boolean(classId),
  });
}

export function useClassSummary() {
  return useQuery<{ teacher: TeacherAccount; classes: ClassSummaryRow[] }, TisError>({
    queryKey: teacherKeys.summary,
    queryFn: () => request('/tis/summary'),
  });
}

export function useLearnerDrillDown(classId: string | null, learnerId: string) {
  return useQuery<LearnerDrillDown, TisError>({
    queryKey: teacherKeys.learner(classId ?? 'none', learnerId),
    queryFn: () => request(`/tis/classes/${classId}/learners/${learnerId}`),
    enabled: Boolean(classId && learnerId),
  });
}

export function useTeacherRegister() {
  return useMutation<{ teacher: TeacherAccount; classes: TeacherClass[] }, TisError, {
    fullName: string;
    email: string;
    schoolName: string;
    password: string;
    classes: Array<{ grade: number; section: string; subject: string }>;
  }>({
    mutationFn: (body) => request('/tis/auth/register', { method: 'POST', body: JSON.stringify(body) }),
  });
}

export function useTeacherLogin() {
  return useMutation<{ teacher: TeacherAccount; classes: TeacherClass[] }, TisError, { email: string; password: string }>({
    mutationFn: (body) => request('/tis/auth/login', { method: 'POST', body: JSON.stringify(body) }),
  });
}

export function useTeacherLogout() {
  const client = useQueryClient();
  return useMutation<null, TisError, void>({
    mutationFn: () => request('/tis/auth/logout', { method: 'POST' }),
    onSuccess: () => client.clear(),
  });
}

export function useAnalyseLessonPlan(classId: string | null) {
  return useMutation<LessonPlanAnalysis, TisError, { lessonPlan: string }>({
    mutationFn: (body) => request(`/tis/classes/${classId}/lesson-plan`, { method: 'POST', body: JSON.stringify(body) }),
  });
}

export function useCreateClassAssignment() {
  const client = useQueryClient();
  return useMutation<{ assignments: Array<{ id: string; classId: string | null; title: string; topic: string; openAt: string; closeAt: string; questionCount: number }> }, TisError, {
    classIds: string[];
    title?: string;
    topic: string;
    questionCount: number;
    openAt: string;
    closeAt: string;
  }>({
    mutationFn: (body) => request('/tis/assignments', { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['tis'] }),
  });
}

export function useAddClass() {
  const client = useQueryClient();
  return useMutation<{ classes: TeacherClass[] }, TisError, { grade: number; section: string; subject: string }>({
    mutationFn: (body) => request('/tis/classes', { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['tis'] }),
  });
}

export function useJoinClass() {
  const client = useQueryClient();
  return useMutation<{ class: { id: string; label: string; subject: string } }, TisError, { joinCode: string }>({
    mutationFn: (body) => request('/classes/join', { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => client.invalidateQueries(),
  });
}
