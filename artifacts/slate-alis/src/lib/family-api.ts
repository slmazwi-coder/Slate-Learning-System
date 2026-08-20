import { useMutation, useQuery, useQueryClient, type UseQueryOptions } from '@tanstack/react-query';
import type { ClassMode, ClassOverview, ClassSummaryRow, TeacherClass } from './tis-api';

export type FamilyClass = TeacherClass;

export type ParentAccount = {
  id: string;
  email: string;
  fullName: string;
  createdAt: string;
};

export type TutorAccount = {
  id: string;
  email: string;
  fullName: string;
  createdAt: string;
};

export type FamilyLearner = {
  id: string;
  username: string;
  fullName: string;
  grade: number;
  schoolName: string;
  subjects: string[];
  createdAt: string;
};

export type FamilyCredentials = { username: string; password: string };

export type ChildDashboard = {
  learner: FamilyLearner;
  averageScore: number | null;
  submissionCount: number;
  openAssignments: number;
  missedAssignments: number;
  learningStyle: string;
  confidence: number;
  activeGaps: string[];
  classes: FamilyClass[];
  recentActivity: Array<{ id: string; label: string; subject: string; score: number; detail: string; timestamp: string }>;
};

export class FamilyError extends Error {
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
    throw new FamilyError(response.status, message);
  }
  return data as T;
}

type Query<T> = Omit<UseQueryOptions<T, FamilyError>, 'queryKey' | 'queryFn'>;

export const parentKeys = {
  me: ['parent', 'me'] as const,
  dashboard: ['parent', 'dashboard'] as const,
};

export function useParentSession(options?: Query<{ parent: ParentAccount | null; learners: FamilyLearner[] }>) {
  return useQuery<{ parent: ParentAccount | null; learners: FamilyLearner[] }, FamilyError>({
    queryKey: parentKeys.me,
    queryFn: () => request('/parent/auth/me'),
    retry: false,
    ...options,
  });
}

export function useParentRegister() {
  return useMutation<{ parent: ParentAccount }, FamilyError, { fullName: string; email: string; password: string }>({
    mutationFn: (body) => request('/parent/auth/register', { method: 'POST', body: JSON.stringify(body) }),
  });
}

export function useParentLogin() {
  return useMutation<{ parent: ParentAccount; learners: FamilyLearner[] }, FamilyError, { email: string; password: string }>({
    mutationFn: (body) => request('/parent/auth/login', { method: 'POST', body: JSON.stringify(body) }),
  });
}

export function useParentLogout() {
  const client = useQueryClient();
  return useMutation<null, FamilyError, void>({
    mutationFn: () => request('/parent/auth/logout', { method: 'POST' }),
    onSuccess: () => client.clear(),
  });
}

export function useParentDashboard() {
  return useQuery<{ parent: ParentAccount; children: ChildDashboard[]; classes: FamilyClass[] }, FamilyError>({
    queryKey: parentKeys.dashboard,
    queryFn: () => request('/parent/dashboard'),
  });
}

export function useCreateChild() {
  const client = useQueryClient();
  return useMutation<{ learner: FamilyLearner; credentials: FamilyCredentials; classes: FamilyClass[] }, FamilyError, {
    fullName: string;
    grade: number;
    subjects: string[];
    assignmentWindowDays?: number;
  }>({
    mutationFn: (body) => request('/parent/learners', { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['parent'] }),
  });
}

export function useUpdateChild() {
  const client = useQueryClient();
  return useMutation<{ learner: FamilyLearner; classes: FamilyClass[] }, FamilyError, {
    learnerId: string;
    grade?: number;
    subjects?: string[];
    assignmentWindowDays?: number;
  }>({
    mutationFn: ({ learnerId, ...body }) => request(`/parent/learners/${learnerId}`, { method: 'PATCH', body: JSON.stringify(body) }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['parent'] }),
  });
}

export function useUploadParentCurriculum() {
  const client = useQueryClient();
  return useMutation<{ class: FamilyClass; lessonSequence: string[] }, FamilyError, { classId: string; fileName?: string; text?: string; pdfBase64?: string }>({
    mutationFn: ({ classId, ...body }) => request(`/parent/classes/${classId}/curriculum`, { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['parent'] }),
  });
}

export const tutorKeys = {
  me: ['tutor', 'me'] as const,
  summary: ['tutor', 'summary'] as const,
  learners: ['tutor', 'learners'] as const,
  overview: (classId: string) => ['tutor', 'overview', classId] as const,
};

export function useTutorSession(options?: Query<{ tutor: TutorAccount | null; classes: FamilyClass[] }>) {
  return useQuery<{ tutor: TutorAccount | null; classes: FamilyClass[] }, FamilyError>({
    queryKey: tutorKeys.me,
    queryFn: () => request('/tutor/auth/me'),
    retry: false,
    ...options,
  });
}

export function useTutorRegister() {
  return useMutation<{ tutor: TutorAccount }, FamilyError, { fullName: string; email: string; password: string }>({
    mutationFn: (body) => request('/tutor/auth/register', { method: 'POST', body: JSON.stringify(body) }),
  });
}

export function useTutorLogin() {
  return useMutation<{ tutor: TutorAccount; classes: FamilyClass[] }, FamilyError, { email: string; password: string }>({
    mutationFn: (body) => request('/tutor/auth/login', { method: 'POST', body: JSON.stringify(body) }),
  });
}

export function useTutorLogout() {
  const client = useQueryClient();
  return useMutation<null, FamilyError, void>({
    mutationFn: () => request('/tutor/auth/logout', { method: 'POST' }),
    onSuccess: () => client.clear(),
  });
}

export function useTutorSummary() {
  return useQuery<{ tutor: TutorAccount; classes: ClassSummaryRow[] }, FamilyError>({
    queryKey: tutorKeys.summary,
    queryFn: () => request('/tutor/summary'),
  });
}

export function useTutorClassOverview(classId: string | null) {
  return useQuery<ClassOverview, FamilyError>({
    queryKey: tutorKeys.overview(classId ?? 'none'),
    queryFn: () => request(`/tutor/classes/${classId}/overview`),
    enabled: Boolean(classId),
  });
}

export function useTutorLearners() {
  return useQuery<{ learners: FamilyLearner[] }, FamilyError>({
    queryKey: tutorKeys.learners,
    queryFn: () => request('/tutor/learners'),
  });
}

export function useAddTutorLearner() {
  const client = useQueryClient();
  return useMutation<{ learner: FamilyLearner; credentials: FamilyCredentials; classes: FamilyClass[] }, FamilyError, {
    fullName: string;
    grade: number;
    subjects: string[];
  }>({
    mutationFn: (body) => request('/tutor/learners', { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['tutor'] }),
  });
}

export function useTutorCreateClass() {
  const client = useQueryClient();
  return useMutation<{ classes: FamilyClass[] }, FamilyError, { grade: number; section?: string; subject: string; assignmentWindowDays?: number }>({
    mutationFn: (body) => request('/tutor/classes', { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['tutor'] }),
  });
}

export function useUploadTutorCurriculum() {
  const client = useQueryClient();
  return useMutation<{ class: FamilyClass; lessonSequence: string[] }, FamilyError, { classId: string; fileName?: string; text?: string; pdfBase64?: string }>({
    mutationFn: ({ classId, ...body }) => request(`/tutor/classes/${classId}/curriculum`, { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['tutor'] }),
  });
}

export function useSetTutorClassMode() {
  const client = useQueryClient();
  return useMutation<{ class: FamilyClass }, FamilyError, { classId: string; mode: ClassMode }>({
    mutationFn: ({ classId, mode }) => request(`/tutor/classes/${classId}/mode`, { method: 'POST', body: JSON.stringify({ mode }) }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['tutor'] }),
  });
}
