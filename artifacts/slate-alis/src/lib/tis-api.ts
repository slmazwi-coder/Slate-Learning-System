import { useMutation, useQuery, useQueryClient, type UseQueryOptions } from '@tanstack/react-query';
import type { MarkedScript } from './marked-script';

export type { MarkedScript };

export type ClassMode = 'TEACHER_DEPENDENT' | 'INDEPENDENT';

export type TeacherClass = {
  id: string;
  grade: number;
  section: string;
  subject: string;
  schoolName: string;
  joinCode: string;
  label: string;
  learnerCount: number;
  ownerType: 'teacher' | 'parent' | 'tutor';
  mode: ClassMode;
  curriculumFileName: string | null;
  hasCurriculum: boolean;
  lessonSequence: string[];
  currentTopicIndex: number;
  assignmentWindowDays: number;
};

export type TeacherAccount = {
  id: string;
  email: string;
  fullName: string;
  schoolName: string;
  profileImage: string | null;
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
  attendance: {
    daysActive7: number;
    daysActive30: number;
    daysSinceLastActive: number | null;
    inactive: boolean;
  };
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

export type ClassSubmissionRow = {
  submissionId: string;
  learnerId: string;
  learnerName: string;
  assignmentId: string;
  assignmentTitle: string;
  score: number;
  markingStatus: string;
  submittedAt: string;
};

export type ClassOverview = {
  class: TeacherClass;
  learners: ClassLearnerRow[];
  conceptGaps: ConceptGap[];
  gapAlert: ClassGapAlert | null;
  assignments: ClassAssignmentRow[];
  performance: ClassPerformance;
  submissions: ClassSubmissionRow[];
  pendingMarking: Array<{
    submissionId: string;
    learnerId: string;
    learnerName: string;
    assignmentId: string;
    assignmentTitle: string;
    submittedAt: string;
    questions: Array<{
      index: number;
      questionId: string;
      prompt: string;
      concept: string;
      learnerAnswer: string;
      mark: { questionId: string; verdict: string; explanation: string; score: number | null; gap: string | null } | null;
    }>;
  }>;
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
  assignmentHistory: Array<{ submissionId: string; assignmentId: string; title: string; topic: string; score: number; verdict: string; markingStatus: string; submittedAt: string }>;
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
  script: (submissionId: string) => ['tis', 'script', submissionId] as const,
  learnerScript: (classId: string, learnerId: string, assignmentId: string) => ['tis', 'learner-script', classId, learnerId, assignmentId] as const,
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

// Full marked script for a teacher. `submissionId` and the class/learner/
// assignment trio are mutually exclusive entry points to the same view.
export function useSubmissionScript(submissionId: string | null) {
  return useQuery<MarkedScript, TisError>({
    queryKey: teacherKeys.script(submissionId ?? 'none'),
    queryFn: () => request(`/tis/submissions/${submissionId}/script`),
    enabled: Boolean(submissionId),
  });
}

export function useLearnerAssignmentScript(classId: string | null, learnerId: string, assignmentId: string | null) {
  return useQuery<MarkedScript, TisError>({
    queryKey: teacherKeys.learnerScript(classId ?? 'none', learnerId, assignmentId ?? 'none'),
    queryFn: () => request(`/tis/classes/${classId}/learners/${learnerId}/assignments/${assignmentId}/script`),
    enabled: Boolean(classId && learnerId && assignmentId),
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
  return useMutation<{ assignments: Array<{
    id: string;
    classId: string | null;
    title: string;
    topic: string;
    openAt: string;
    closeAt: string;
    questionCount: number;
    markingMode: 'auto' | 'selective' | 'manual';
    autoMarkQuestions: number[];
    questionTypes: string[];
    resultReleasePolicy: 'after_close' | 'immediate';
    questionSource: 'ai' | 'manual' | 'pdf';
    isPublished: boolean;
    questions: Array<{ id: string; prompt: string; type: 'text' | 'equation' | 'multiple_choice'; options?: string[]; concept: string; answer: string }>;
  }> }, TisError, {
    classIds: string[];
    title?: string;
    topic: string;
    questionCount: number;
    openAt: string;
    closeAt: string;
    markingMode: 'auto' | 'selective' | 'manual';
    autoMarkQuestions?: number[];
    questionTypes: string[];
    resultReleasePolicy: 'after_close' | 'immediate';
    questionSource: 'ai' | 'manual' | 'pdf';
    questions?: ReviewedAssignmentQuestion[];
    pdfBase64?: string;
    fileName?: string;
  }>({
    mutationFn: (body) => request('/tis/assignments', { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['tis'] }),
  });
}

export type ReviewedAssignmentQuestion = {
  id: string;
  prompt: string;
  type: 'text' | 'equation' | 'multiple_choice';
  options?: string[];
  concept: string;
  answer: string;
};

export function usePublishClassAssignment() {
  const client = useQueryClient();
  return useMutation<{ id: string; isPublished: boolean; questionCount: number }, TisError, { assignmentId: string; questions: ReviewedAssignmentQuestion[] }>({
    mutationFn: ({ assignmentId, questions }) => request(`/tis/assignments/${assignmentId}/publish`, { method: 'POST', body: JSON.stringify({ questions }) }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['tis'] }),
  });
}

export function useMarkSubmission() {
  const client = useQueryClient();
  return useMutation<{ submissionId: string; questionIndex: number; verdict: string; score: number; markingStatus: string }, TisError, { submissionId: string; questionIndex: number; score: number; comment?: string }>({
    mutationFn: ({ submissionId, ...body }) => request(`/tis/submissions/${submissionId}/mark`, { method: 'POST', body: JSON.stringify(body) }),
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

export function useSetClassMode() {
  const client = useQueryClient();
  return useMutation<{ class: TeacherClass }, TisError, { classId: string; mode: ClassMode }>({
    mutationFn: ({ classId, mode }) => request(`/tis/classes/${classId}/mode`, { method: 'POST', body: JSON.stringify({ mode }) }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['tis'] }),
  });
}

export function useUploadClassCurriculum() {
  const client = useQueryClient();
  return useMutation<{ class: TeacherClass; lessonSequence: string[] }, TisError, { classId: string; fileName?: string; text?: string; pdfBase64?: string }>({
    mutationFn: ({ classId, ...body }) => request(`/tis/classes/${classId}/curriculum`, { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['tis'] }),
  });
}

export type PresetCurriculum = {
  id: string;
  phase: string;
  subject: string;
  gradeMin: number;
  gradeMax: number;
  sourceName: string;
  sequence: string[];
};

export function usePresetCurricula() {
  return useQuery<{ presets: PresetCurriculum[] }, TisError>({
    queryKey: ['curriculum-presets'],
    queryFn: () => request('/curriculum/presets'),
    staleTime: 5 * 60 * 1000,
  });
}

export type ClassroomAssignment = {
  id: string;
  title: string;
  subject: string;
  topic: string;
  openAt: string;
  closeAt: string;
  questionCount: number;
  status: 'OPEN' | 'LOCKED';
};

export type LearnerClassroom = {
  id: string;
  grade: number;
  section: string;
  subject: string;
  schoolName: string;
  label: string;
  joinedAt: string;
  stats: {
    averageScore: number | null;
    submissionCount: number;
    openAssignments: number;
    upcomingAssignments: number;
    missedAssignments: number;
    lastActive: string | null;
    topGap: string | null;
    newAssignments: Array<{ id: string; title: string; subject: string; topic: string; closeAt: string }>;
    liveAssignments: ClassroomAssignment[];
    upcomingAssignmentsDetail: ClassroomAssignment[];
    strongestConcept: string | null;
  };
};

export type ClassroomMaterial = {
  id: string;
  title: string;
  description: string;
  kind: string;
  fileName: string | null;
  fileType: string | null;
  hasContent: boolean;
  hasFile: boolean;
  createdAt: string;
};

export type LearnerClassroomDetail = {
  id: string;
  grade: number;
  section: string;
  subject: string;
  schoolName: string;
  label: string;
  joinedAt: string;
  stats: LearnerClassroom['stats'];
  materials: ClassroomMaterial[];
};

export function useLearnerClassrooms() {
  return useQuery<LearnerClassroom[], TisError>({
    queryKey: ['learner-classrooms'],
    queryFn: () => request('/classes/mine'),
  });
}

// One classroom's full dashboard (header, live + upcoming work, materials).
export function useClassroomDetail(classId: string | null) {
  return useQuery<LearnerClassroomDetail, TisError>({
    queryKey: ['classroom', classId ?? 'none'],
    queryFn: () => request(`/classrooms/${classId}`),
    enabled: Boolean(classId),
  });
}

export type ClassMaterial = ClassroomMaterial;

export function useClassMaterials(classId: string | null) {
  return useQuery<{ materials: ClassMaterial[] }, TisError>({
    queryKey: ['tis', 'materials', classId ?? 'none'],
    queryFn: () => request(`/tis/classes/${classId}/materials`),
    enabled: Boolean(classId),
  });
}

export type ClassMaterialInput = {
  title: string;
  description?: string;
  kind: 'NOTE' | 'REVISION' | 'QUIZ' | 'DEMONSTRATION';
  content?: string;
  fileName?: string;
  fileType?: string;
  fileBase64?: string;
};

export function useAddClassMaterial() {
  const client = useQueryClient();
  return useMutation<{ material: ClassMaterial }, TisError, { classId: string; data: ClassMaterialInput }>({
    mutationFn: ({ classId, data }) => request(`/tis/classes/${classId}/materials`, { method: 'POST', body: JSON.stringify(data) }),
    onSuccess: () => { client.invalidateQueries({ queryKey: ['tis'] }); client.invalidateQueries({ queryKey: ['classroom'] }); },
  });
}

export function useDeleteClassMaterial() {
  const client = useQueryClient();
  return useMutation<null, TisError, { classId: string; materialId: string }>({
    mutationFn: ({ classId, materialId }) => request(`/tis/classes/${classId}/materials/${materialId}`, { method: 'DELETE' }),
    onSuccess: () => { client.invalidateQueries({ queryKey: ['tis'] }); client.invalidateQueries({ queryKey: ['classroom'] }); },
  });
}

export function useJoinClass() {
  const client = useQueryClient();
  return useMutation<{ class: { id: string; label: string; subject: string } }, TisError, { joinCode: string }>({
    mutationFn: (body) => request('/classes/join', { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => client.invalidateQueries(),
  });
}
