import { useMutation, useQuery, useQueryClient, type UseQueryOptions } from '@tanstack/react-query';
import type { MarkedScript } from './marked-script';

export type { MarkedScript };

export type HodAccount = {
  id: string;
  email: string;
  fullName: string;
  roles: string[];
  createdAt: string;
};

export type HodClassSummary = {
  id: string;
  label: string;
  grade: number;
  section: string;
  subject: string;
  schoolName: string;
  ownerType: string;
  learnerCount: number;
  hodCanViewScripts: boolean;
  teacherName: string;
};

export type HodZoneCounts = {
  green: number;
  yellow: number;
  red: number;
  // "grey" replaces the old "insufficient": too little released, marked work to
  // place the learner. A learner is never red on too little evidence.
  grey: number;
  total: number;
};

export type HodConceptGap = {
  concept: string;
  learnersAssessed: number;
  strugglingLearners: number;
  strugglingPercentage: number;
  averageScore: number;
};

export type HodPerformancePoint = {
  assignmentId: string;
  title: string;
  topic: string;
  openAt: string;
  submissions: number;
  averageScore: number;
  isLowest: boolean;
};

export type HodAssignmentRow = {
  id: string;
  title: string;
  topic: string;
  status: string;
  openAt: string;
  closeAt: string;
  learnerCount: number;
  submitted: number;
  completionRate: number;
  missed: number;
  averageScore: number;
  markedCount: number;
  releaseState: string;
  resultsVisible: boolean;
};

// Class-level only: there is no learner array here, by design.
export type HodClassView = {
  class: HodClassSummary;
  classAverage: number;
  zones: HodZoneCounts;
  // Change since the last term (points) and the share of red learners with a
  // logged intervention. Counts and percentages only: no learner is named.
  zoneChangeSinceLastTerm: number | null;
  zoneIntervention: { red: number; withIntervention: number; share: number | null };
  zoneTerm: { label: string; status: string } | null;
  conceptGaps: HodConceptGap[];
  gapAlert: { concept: string; strugglingPercentage: number; strugglingLearners: number; learnersAssessed: number; averageScore: number; message: string } | null;
  trend: string;
  performance: HodPerformancePoint[];
  completionRate: number;
  assignmentCount: number;
  assignments?: HodAssignmentRow[];
};

export type HodOverview = {
  classes: HodClassView[];
  teachers: Array<{ teacherName: string; classes: HodClassView[] }>;
  totals: { classes: number; teachers: number; learners: number; classAverage: number; zones: HodZoneCounts };
};

export type HodSubmissionRow = {
  submissionId: string;
  learnerName: string;
  score: number;
  markingStatus: string;
  submittedAt: string;
};

export class HodError extends Error {
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
    throw new HodError(response.status, message);
  }
  return data as T;
}

const keys = {
  me: ['hod', 'me'] as const,
  overview: ['hod', 'overview'] as const,
  class: (classId: string) => ['hod', 'class', classId] as const,
  submissions: (classId: string, assignmentId: string) => ['hod', 'submissions', classId, assignmentId] as const,
  script: (submissionId: string) => ['hod', 'script', submissionId] as const,
};

type Query<T> = Omit<UseQueryOptions<T, HodError>, 'queryKey' | 'queryFn'>;

export function useHodSession(options?: Query<{ hod: HodAccount | null; classes: HodClassSummary[] }>) {
  return useQuery<{ hod: HodAccount | null; classes: HodClassSummary[] }, HodError>({
    queryKey: keys.me,
    queryFn: () => request('/hod/auth/me'),
    retry: false,
    ...options,
  });
}

export function useHodRegister() {
  const client = useQueryClient();
  return useMutation<{ hod: HodAccount }, HodError, { fullName: string; email: string; password: string }>({
    mutationFn: (body) => request('/hod/auth/register', { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['hod'] }),
  });
}

export function useHodLogin() {
  const client = useQueryClient();
  return useMutation<{ hod: HodAccount }, HodError, { email: string; password: string }>({
    mutationFn: (body) => request('/hod/auth/login', { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['hod'] }),
  });
}

export function useHodLogout() {
  const client = useQueryClient();
  return useMutation<null, HodError, void>({
    mutationFn: () => request('/hod/auth/logout', { method: 'POST' }),
    onSuccess: () => client.invalidateQueries(),
  });
}

export function useHodJoinClass() {
  const client = useQueryClient();
  return useMutation<HodClassView, HodError, { code: string }>({
    mutationFn: (body) => request('/hod/join', { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['hod'] }),
  });
}

export function useHodLeaveClass() {
  const client = useQueryClient();
  return useMutation<{ classes: HodClassSummary[] }, HodError, { classId: string }>({
    mutationFn: ({ classId }) => request(`/hod/classes/${classId}/leave`, { method: 'POST' }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['hod'] }),
  });
}

export function useHodOverview(options?: Query<HodOverview>) {
  return useQuery<HodOverview, HodError>({
    queryKey: keys.overview,
    queryFn: () => request('/hod/overview'),
    ...options,
  });
}

export function useHodClass(classId: string | null) {
  return useQuery<HodClassView, HodError>({
    queryKey: keys.class(classId ?? 'none'),
    queryFn: () => request(`/hod/classes/${classId}`),
    enabled: Boolean(classId),
  });
}

export function useHodSubmissions(classId: string | null, assignmentId: string | null) {
  return useQuery<{ class: HodClassSummary; assignment: HodAssignmentRow; submissions: HodSubmissionRow[] }, HodError>({
    queryKey: keys.submissions(classId ?? 'none', assignmentId ?? 'none'),
    queryFn: () => request(`/hod/classes/${classId}/assignments/${assignmentId}/submissions`),
    enabled: Boolean(classId && assignmentId),
    retry: false,
  });
}

export function useHodScript(submissionId: string | null) {
  return useQuery<MarkedScript & { editable: boolean }, HodError>({
    queryKey: keys.script(submissionId ?? 'none'),
    queryFn: () => request(`/hod/submissions/${submissionId}`),
    enabled: Boolean(submissionId),
    retry: false,
  });
}
