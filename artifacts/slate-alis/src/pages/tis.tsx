import { createContext, useContext, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useLocation, useParams } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  BookOpenCheck,
  CalendarClock,
  Check,
  ChevronDown,
  ClipboardList,
  Copy,
  FileText,
  FileUp,
  LayoutGrid,
  Layers,
  LineChart,
  ListChecks,
  LogOut,
  NotebookPen,
  Plus,
  Presentation,
  Sparkles,
  Trash2,
  TrendingDown,
  TrendingUp,
  Users,
  X,
} from 'lucide-react';
import {
  teacherKeys,
  useAddClass,
  useAddClassMaterial,
  useAnalyseLessonPlan,
  useClassOverview,
  useClassMaterials,
  useClassSummary,
  useCreateClassAssignment,
  useDeleteClassMaterial,
  useLearnerAssignmentScript,
  useLearnerDrillDown,
  useMarkSubmission,
  useSubmissionScript,
  usePresetCurricula,
  usePublishClassAssignment,
  useSetClassMode,
  useTeacherLogin,
  useTeacherLogout,
  useTeacherRegister,
  useTeacherSession,
  useUploadClassCurriculum,
  type ClassLearnerRow,
  type ClassMode,
  type ClassPerformance,
  type TeacherClass,
  type ReviewedAssignmentQuestion,
} from '@/lib/tis-api';
import { BrandEmblem, PoweredBy } from '@/components/brand';
import { AvatarUploader } from '@/components/profile-image';
import { ClassModeToggle, CurriculumUpload } from '@/components/class-mode';
import { MarkedScriptView } from '@/components/marked-script';

const SUBJECTS = ['Mathematics', 'English', 'Natural Sciences', 'Physical Sciences', 'Life Sciences', 'Social Sciences', 'Accounting', 'Technology', 'Life Orientation'];

// Only subjects with a hardwired preset curriculum may be opened as classes;
// this fetches the current catalog and filters it to the selected grade
// (Stadio = grade 13, which carries modules instead of CAPS subjects).
const STADIO_GRADE = 13;
const GRADE_R = 0;
const CLASS_GRADE_OPTIONS = [{ value: String(GRADE_R), label: 'R' }, ...Array.from({ length: 12 }, (_, offset) => ({ value: String(offset + 1), label: String(offset + 1) })), { value: String(STADIO_GRADE), label: 'Stadio' }];

function presetLabel(entry: { subject: string; gradeMin: number; gradeMax: number }) {
  if (entry.gradeMin === STADIO_GRADE) return `${entry.subject} (Stadio)`;
  if (entry.gradeMin === GRADE_R) return `${entry.subject} (Gr R-${entry.gradeMax})`;
  return `${entry.subject} (Gr ${entry.gradeMin}-${entry.gradeMax})`;
}

function presetOptionsFor(entries: Array<{ subject: string; gradeMin: number; gradeMax: number }>, grade: string) {
  const gradeNumber = Number(grade);
  return entries
    .filter((entry) => gradeNumber >= entry.gradeMin && gradeNumber <= entry.gradeMax)
    .map((entry) => ({ value: entry.subject, label: presetLabel(entry) }));
}

function usePresetSubjectOptions(grade?: string) {
  const presets = usePresetCurricula();
  const entries = presets.data?.presets ?? [];
  const options = grade ? presetOptionsFor(entries, grade) : entries.map((entry) => ({ value: entry.subject, label: presetLabel(entry) }));
  return { options, entries, loading: presets.isLoading, failed: presets.isError, first: options[0]?.value ?? '' };
}

function gradeLabel(grade: string) {
  if (grade === String(STADIO_GRADE)) return 'Stadio';
  if (grade === String(GRADE_R)) return 'Grade R';
  return `Grade ${grade}`;
}

function subjectHint(state: { loading: boolean; failed: boolean }, grade: string, subject: string) {
  if (subject || state.loading) return undefined;
  if (state.failed) return 'Subjects could not load — please refresh.';
  return `No subjects for ${gradeLabel(grade)} yet.`;
}

// The catalog arrives after the first render, so a subject held in form state can
// be stale (empty before the fetch resolves) or belong to another grade — either
// way the select still displays its first option, so the posted subject has to be
// resolved against the options actually offered for the chosen grade.
function resolveSubject(entries: Array<{ subject: string; gradeMin: number; gradeMax: number }>, grade: string, subject: string) {
  const options = presetOptionsFor(entries, grade);
  return options.some((option) => option.value === subject) ? subject : (options[0]?.value ?? '');
}
const NAV = [
  { href: '/teacher', label: 'Class overview', icon: Users },
  { href: '/teacher/classes', label: 'All my classes', icon: LayoutGrid },
  { href: '/teacher/lesson-plan', label: 'Lesson plan assistant', icon: NotebookPen },
  { href: '/teacher/assignments/new', label: 'Create assignment', icon: ClipboardList },
];
const STORAGE_KEY = 'slate-tis-class';

function cn(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(' ');
}

function formatDate(value: string | null, withTime = false) {
  if (!value) return 'No activity yet';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Not available';
  return new Intl.DateTimeFormat('en-ZA', { day: 'numeric', month: 'short', ...(withTime ? { hour: 'numeric', minute: '2-digit' } : {}) }).format(date);
}

function toLocalInput(date: Date) {
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function errorText(error: unknown) {
  if (error instanceof Error && error.message) return error.message;
  return 'Something went wrong. Please try again.';
}

function TisButton({ children, className, variant = 'primary', ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'gold' | 'ghost' | 'outline' }) {
  return (
    <button
      {...props}
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold transition-transform active:scale-[.98] disabled:cursor-not-allowed disabled:opacity-50',
        variant === 'primary' && 'bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] shadow-sm hover:-translate-y-0.5',
        variant === 'gold' && 'bg-[hsl(var(--accent))] text-[hsl(var(--accent-foreground))] shadow-sm hover:-translate-y-0.5',
        variant === 'outline' && 'border border-[hsl(var(--border))] bg-[hsl(var(--card))] hover:border-[hsl(var(--accent))]',
        variant === 'ghost' && 'text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))]',
        className,
      )}
    >
      {children}
    </button>
  );
}

function TisField({ label, value, onChange, testId, type = 'text', ...props }: { label: string; value: string; onChange: (value: string) => void; testId: string; type?: string } & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'>) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-bold text-[hsl(var(--muted-foreground))]">{label}</span>
      <input
        {...props}
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        data-testid={testId}
        className="w-full rounded-xl border border-[hsl(var(--input))] bg-[hsl(var(--background)/.55)] px-3.5 py-3 text-sm outline-none focus:border-[hsl(var(--accent))] focus:ring-4 focus:ring-[hsl(var(--accent)/.14)]"
      />
    </label>
  );
}

function TisSelect({ label, value, onChange, options, testId, hint, emptyLabel = 'Not available yet' }: { label: string; value: string; onChange: (value: string) => void; options: Array<{ value: string; label: string }>; testId: string; hint?: string; emptyLabel?: string }) {
  const empty = options.length === 0;
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-bold text-[hsl(var(--muted-foreground))]">{label}</span>
      <select
        value={empty ? '' : value}
        disabled={empty}
        onChange={(event) => onChange(event.target.value)}
        data-testid={testId}
        className="w-full rounded-xl border border-[hsl(var(--input))] bg-[hsl(var(--background)/.55)] px-3.5 py-3 text-sm outline-none focus:border-[hsl(var(--accent))] disabled:text-[hsl(var(--muted-foreground))]"
      >
        {empty
          ? <option value="">{emptyLabel}</option>
          : options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
      {hint && <span className="mt-1.5 block text-xs font-semibold text-[#93473a]">{hint}</span>}
    </label>
  );
}

// A titled card section, so the assignment form reads as a short, scannable
// sequence of steps instead of one dense wall of fields.
function TisFormCard({ step, title, description, children, className }: { step?: string; title: string; description?: string; children: ReactNode; className?: string }) {
  return (
    <section className={cn('rounded-[1.75rem] border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5 shadow-sm sm:p-7', className)}>
      <div className="flex items-start gap-3">
        {step && <span className="mono-face mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg bg-[hsl(var(--accent)/.22)] text-[11px] font-bold text-[hsl(var(--accent-foreground))]">{step}</span>}
        <div className="min-w-0">
          <h2 className="text-base font-bold">{title}</h2>
          {description && <p className="mt-1 text-xs leading-5 text-[hsl(var(--muted-foreground))]">{description}</p>}
        </div>
      </div>
      <div className="mt-5">{children}</div>
    </section>
  );
}

// A class can be picked from a dropdown (one, the common case) or toggled in
// "multiple" mode when the same assignment goes to several classes at once.
// Each option is a rich row (label, grade/school, learner count) rather than a
// flat <option>, which keeps a long class list readable.
function ClassPicker({ classes, selected, onChange, multiple }: { classes: TeacherClass[]; selected: string[]; onChange: (classIds: string[]) => void; multiple: boolean }) {
  const [open, setOpen] = useState(false);
  const toggle = (classId: string) => {
    if (multiple) onChange(selected.includes(classId) ? selected.filter((entry) => entry !== classId) : [...selected, classId]);
    else { onChange([classId]); setOpen(false); }
  };
  const primary = classes.find((entry) => entry.id === selected[0]) ?? null;
  if (!classes.length) return <Link href="/teacher/classes" data-testid="link-add-first-class" className="text-sm font-bold text-[hsl(var(--accent-foreground))] hover:underline">Add your first class to set an assignment</Link>;
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        data-testid="button-assignment-class-picker"
        className="flex w-full items-center justify-between gap-3 rounded-xl border border-[hsl(var(--input))] bg-[hsl(var(--background)/.55)] px-3.5 py-3 text-left text-sm font-bold"
      >
        <span className="min-w-0 truncate">
          {multiple
            ? (selected.length ? `${selected.length} ${selected.length === 1 ? 'class' : 'classes'} selected` : 'Choose one or more classes')
            : (primary?.label ?? 'Choose a class')}
        </span>
        <ChevronDown size={16} className={cn('shrink-0 transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="absolute z-30 mt-2 max-h-72 w-full overflow-auto rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-1.5 shadow-lg">
          {classes.map((entry) => (
            <button
              type="button"
              key={entry.id}
              onClick={() => toggle(entry.id)}
              data-testid={`button-assignment-class-${entry.id}`}
              className={cn('flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm hover:bg-[hsl(var(--muted))]', selected.includes(entry.id) && 'bg-[hsl(var(--accent)/.18)]')}
            >
              {multiple && <span className={cn('grid size-4 shrink-0 place-items-center rounded border', selected.includes(entry.id) ? 'border-[hsl(var(--accent))] bg-[hsl(var(--accent))] text-[hsl(var(--accent-foreground))]' : 'border-[hsl(var(--input))]')}>{selected.includes(entry.id) && <Check size={11} />}</span>}
              <span className="min-w-0 flex-1">
                <span className="block truncate font-bold">{entry.label}</span>
                <span className="mt-0.5 block truncate text-[11px] text-[hsl(var(--muted-foreground))]">{entry.schoolName} · {entry.learnerCount} learners</span>
              </span>
              {!multiple && selected.includes(entry.id) && <Check size={15} className="shrink-0 text-[hsl(var(--accent-foreground))]" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// Suggested topics pulled from the selected class curricula. Clicking a topic
// fills the concept/topic field, so the teacher rarely has to type one.
function TopicSuggestions({ topics, value, onPick, loading }: { topics: string[]; value: string; onPick: (topic: string) => void; loading?: boolean }) {
  return (
    <TisFormCard step="3" title="Suggested topics" description="Pull a topic straight from the selected class curriculum, or type your own above.">
      {loading ? (
        <div className="flex flex-wrap gap-2">{Array.from({ length: 6 }, (_, index) => <span key={index} className="h-8 w-32 animate-pulse rounded-full bg-[hsl(var(--muted))]" />)}</div>
      ) : topics.length === 0 ? (
        <p data-testid="status-topic-suggestions-empty" className="rounded-xl bg-[hsl(var(--muted)/.45)] p-4 text-xs text-[hsl(var(--muted-foreground))]">Pick a class above to see its curriculum topics, or type a topic in step 2.</p>
      ) : (
        <div data-testid="list-topic-suggestions" className="grid gap-2 sm:grid-cols-2">
          {topics.map((topic) => (
            <button
              type="button"
              key={topic}
              onClick={() => onPick(topic)}
              title={topic}
              data-testid={`button-topic-suggestion-${topic}`}
              className={cn('flex w-full items-center gap-2 rounded-xl border px-3.5 py-2.5 text-left text-xs font-semibold transition-colors', value === topic ? 'border-[hsl(var(--accent))] bg-[hsl(var(--accent))] text-[hsl(var(--accent-foreground))]' : 'border-[hsl(var(--border))] bg-[hsl(var(--card))] text-[hsl(var(--muted-foreground))] hover:border-[hsl(var(--accent))] hover:text-[hsl(var(--foreground))]')}
            >
              <BookOpenCheck size={13} className="shrink-0 opacity-70" />
              <span className="min-w-0 flex-1 truncate">{topic}</span>
              {value === topic && <Check size={13} className="shrink-0" />}
            </button>
          ))}
        </div>
      )}
    </TisFormCard>
  );
}

function TisLoading({ label = 'Reading your class data…' }: { label?: string }) {
  return <div className="space-y-4"><div className="h-8 w-52 animate-pulse rounded-lg bg-[hsl(var(--muted))]" /><div className="grid gap-4 md:grid-cols-3"><div className="h-28 animate-pulse rounded-3xl bg-[hsl(var(--muted))]" /><div className="h-28 animate-pulse rounded-3xl bg-[hsl(var(--muted))]" /><div className="h-28 animate-pulse rounded-3xl bg-[hsl(var(--muted))]" /></div><p className="mono-face text-xs text-[hsl(var(--muted-foreground))]">{label}</p></div>;
}

function TisError({ message, retry }: { message: string; retry?: () => void }) {
  return <div data-testid="status-tis-error" className="rounded-3xl border border-[#e7beb4] bg-[#fff4f1] p-6"><p className="font-bold text-[#93473a]">{message}</p>{retry && <TisButton variant="outline" className="mt-4" onClick={retry}>Try again</TisButton>}</div>;
}

function TisMark() {
  return (
    <Link href="/teacher" data-testid="link-tis-home" className="flex min-w-0 items-center gap-2.5">
      <BrandEmblem className="size-11 sm:size-12" />
      <span className="min-w-0 leading-none">
        <span className="display-face block whitespace-nowrap text-[17px] font-bold tracking-tight text-[hsl(var(--sidebar-foreground))] sm:text-xl">
          TIS<span className="hidden text-[hsl(var(--accent))] md:inline"> Teaching Intelligence System</span>
        </span>
        <span className="mt-1.5 hidden whitespace-nowrap text-[9px] font-semibold uppercase tracking-[.14em] text-[hsl(var(--sidebar-foreground)/.6)] min-[360px]:block sm:text-[10px]">
          <span className="md:hidden">Teaching Intelligence System</span>
          <span className="hidden md:inline">See every learner. Close every gap.</span>
        </span>
      </span>
    </Link>
  );
}

type TisContextValue = {
  teacher: { fullName: string; email: string; schoolName: string };
  classes: TeacherClass[];
  activeClass: TeacherClass | null;
  setActiveClassId: (classId: string) => void;
};

const TisContext = createContext<TisContextValue | null>(null);

export function useTis() {
  const value = useContext(TisContext);
  if (!value) throw new Error('useTis must be used inside the TIS layout');
  return value;
}

function ClassSwitcher() {
  const { classes, activeClass, setActiveClassId } = useTis();
  const [open, setOpen] = useState(false);
  if (!classes.length) return <Link href="/teacher/classes" data-testid="link-add-first-class" className="text-sm font-bold text-[hsl(var(--accent))]">Add your first class</Link>;
  return (
    <div className="relative w-full min-w-0 sm:w-[260px]">
      <button
        onClick={() => setOpen(!open)}
        data-testid="button-class-switcher"
        className="flex w-full items-center justify-between gap-3 rounded-xl border border-[hsl(var(--sidebar-border))] bg-[hsl(var(--sidebar-accent))] px-3.5 py-3 text-left text-sm font-bold text-[hsl(var(--sidebar-foreground))]"
      >
        <span className="min-w-0 truncate">{activeClass?.label ?? 'Choose a class'}</span>
        <ChevronDown size={16} className={cn('shrink-0 transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="absolute right-0 z-30 mt-2 w-full overflow-hidden rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] shadow-lg sm:min-w-[260px]">
          {classes.map((entry) => (
            <button
              key={entry.id}
              onClick={() => { setActiveClassId(entry.id); setOpen(false); }}
              data-testid={`button-class-option-${entry.id}`}
              className={cn('flex w-full items-center justify-between gap-3 px-4 py-3 text-left text-sm font-semibold hover:bg-[hsl(var(--muted))]', entry.id === activeClass?.id && 'bg-[hsl(var(--accent)/.18)]')}
            >
              <span className="min-w-0 flex-1">{entry.label}</span>
              <span className="mono-face shrink-0 text-[11px] text-[hsl(var(--muted-foreground))]">{entry.learnerCount} learners</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function TisLayout({ children }: { children: ReactNode }) {
  const [location, setLocation] = useLocation();
  const session = useTeacherSession();
  const logout = useTeacherLogout();
  const [activeClassId, setActiveClassIdState] = useState<string | null>(() => (typeof window === 'undefined' ? null : window.localStorage.getItem(STORAGE_KEY)));
  const teacher = session.data?.teacher ?? null;
  const classes = session.data?.classes ?? [];
  useEffect(() => { if (!session.isLoading && !teacher) setLocation('/teacher/login'); }, [session.isLoading, teacher, setLocation]);
  const activeClass = useMemo(() => classes.find((entry) => entry.id === activeClassId) ?? classes[0] ?? null, [classes, activeClassId]);
  const setActiveClassId = (classId: string) => {
    setActiveClassIdState(classId);
    window.localStorage.setItem(STORAGE_KEY, classId);
  };
  if (session.isLoading) return <div className="grain min-h-[100dvh] bg-[hsl(var(--background))] p-8"><TisLoading label="Opening your TIS dashboard…" /></div>;
  if (!teacher) return null;
  const value: TisContextValue = { teacher, classes, activeClass, setActiveClassId };
  return (
    <TisContext.Provider value={value}>
      <div className="grain min-h-[100dvh] bg-[hsl(var(--background))] text-[hsl(var(--foreground))]">
        <header className="bg-[hsl(var(--sidebar))]">
          <div className="mx-auto flex max-w-[1280px] flex-col gap-4 px-4 py-4 sm:px-8 sm:py-5 lg:flex-row lg:items-center lg:justify-between">
            <TisMark />
            <div className="flex min-w-0 items-center gap-3">
              <ClassSwitcher />
              <AvatarUploader name={teacher.fullName} image={teacher.profileImage} invalidateKeys={[['tis']]} className="hidden shrink-0 lg:block" />
              <div className="hidden shrink-0 text-right lg:block">
                <p data-testid="text-teacher-name" className="text-sm font-bold text-[hsl(var(--sidebar-foreground))]">{teacher.fullName}</p>
                <p className="text-[11px] text-[hsl(var(--sidebar-foreground)/.6)]">{teacher.schoolName}</p>
              </div>
              <button
                onClick={() => logout.mutate(undefined, { onSuccess: () => setLocation('/teacher/login') })}
                data-testid="button-teacher-logout"
                className="inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-xl px-2.5 py-2.5 text-sm font-bold text-[hsl(var(--sidebar-foreground)/.7)] hover:bg-[hsl(var(--sidebar-accent))] sm:px-3"
              >
                <LogOut size={16} />Sign out
              </button>
            </div>
          </div>
          <div className="mx-auto max-w-[1280px] overflow-x-auto px-4 sm:px-8">
            <nav className="flex gap-1 pb-1">
              {NAV.map(({ href, label, icon: Icon }) => {
                const active = href === '/teacher' ? location === '/teacher' : location.startsWith(href);
                return (
                  <Link
                    key={href}
                    href={href}
                    data-testid={`link-tis-${label.toLowerCase().replaceAll(' ', '-')}`}
                    className={cn(
                      'flex shrink-0 items-center gap-2 rounded-t-xl px-4 py-3 text-sm font-bold transition-colors',
                      active ? 'bg-[hsl(var(--background))] text-[hsl(var(--foreground))]' : 'text-[hsl(var(--sidebar-foreground)/.66)] hover:bg-[hsl(var(--sidebar-accent))]',
                    )}
                  >
                    <Icon size={16} />{label}
                  </Link>
                );
              })}
            </nav>
          </div>
        </header>
        <main className="mx-auto max-w-[1280px] px-4 py-8 sm:px-8 lg:py-10">{children}</main>
        <footer className="px-4 pb-8 sm:px-8"><PoweredBy /></footer>
      </div>
    </TisContext.Provider>
  );
}

export function TeacherAuth({ mode }: { mode: 'login' | 'register' }) {
  const isRegister = mode === 'register';
  const [, setLocation] = useLocation();
  const client = useQueryClient();
  const register = useTeacherRegister();
  const login = useTeacherLogin();
  const [error, setError] = useState('');
  const [form, setForm] = useState({ fullName: '', email: '', schoolName: '', password: '' });
  const presetOptions = usePresetSubjectOptions();
  const [classRows, setClassRows] = useState([{ grade: '5', section: 'A', subject: '' }]);
  const rows = classRows.map((row) => ({ ...row, subject: resolveSubject(presetOptions.entries, row.grade, row.subject) }));
  const pending = register.isPending || login.isPending;
  const onSuccess = (data: { teacher: unknown; classes: TeacherClass[] }) => {
    client.setQueryData(teacherKeys.me, data);
    setLocation('/teacher');
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    setError('');
    if (isRegister) {
      const uncovered = rows.find((row) => !row.subject.trim());
      if (uncovered) { setError(presetOptions.failed ? 'Subjects could not load — please refresh and try again.' : `${gradeLabel(uncovered.grade)} has no subjects yet — choose another grade.`); return; }
      const classes = rows.map((row) => ({ grade: Number(row.grade), section: row.section.trim().toUpperCase(), subject: row.subject.trim() }));
      if (!classes.length) { setError('Add at least one class you teach.'); return; }
      register.mutate({ ...form, classes }, { onSuccess, onError: (mutationError) => setError(errorText(mutationError)) });
      return;
    }
    login.mutate({ email: form.email, password: form.password }, { onSuccess, onError: (mutationError) => setError(errorText(mutationError)) });
  };
  return (
    <div className="grain min-h-[100dvh] bg-[hsl(var(--background))]">
      <header className="bg-[hsl(var(--sidebar))] px-4 py-4 sm:px-8 sm:py-5"><div className="mx-auto flex max-w-[1280px] items-center justify-between gap-3"><TisMark /><Link href="/" data-testid="link-learner-space" className="shrink-0 whitespace-nowrap text-xs font-bold text-[hsl(var(--sidebar-foreground)/.7)] hover:text-[hsl(var(--accent))] sm:text-sm">Learner space</Link></div></header>
      <main className="mx-auto grid max-w-5xl gap-8 px-5 py-10 sm:px-8 lg:grid-cols-[.8fr_1.2fr] lg:items-start lg:py-16">
        <div>
          <p className="mono-face text-[11px] uppercase tracking-[.2em] text-[hsl(var(--accent-foreground)/.75)]">TIS · Teaching Intelligence System</p>
          <h1 className="display-face mt-4 text-4xl font-bold leading-[1.02] tracking-[-.05em] sm:text-5xl">{isRegister ? <>Teach with the<br /><span className="text-[hsl(var(--accent-foreground))]">full picture</span>.</> : <>Welcome back,<br /><span className="text-[hsl(var(--accent-foreground))]">Teacher</span>.</>}</h1>
          <p className="mt-5 max-w-sm text-sm leading-7 text-[hsl(var(--muted-foreground))]">See every learner. Close every gap. TIS turns your learners' work into class-level insight, per class you teach.</p>
          <p className="mt-6 text-sm font-bold">{isRegister ? <>Already registered? <Link href="/teacher/login" data-testid="link-teacher-login" className="text-[hsl(var(--accent-foreground))] underline">Teacher login</Link></> : <>New to TIS? <Link href="/teacher/register" data-testid="link-teacher-register" className="text-[hsl(var(--accent-foreground))] underline">Create a teacher account</Link></>}</p>
        </div>
        <form onSubmit={submit} className="rounded-[2rem] border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-6 shadow-lg sm:p-8">
          <h2 className="text-xl font-bold">{isRegister ? 'Create your TIS account' : 'Teacher login'}</h2>
          <div className="mt-6 space-y-4">
            {isRegister && <TisField label="Full name" value={form.fullName} onChange={(value) => setForm({ ...form, fullName: value })} testId="input-teacher-name" required />}
            <TisField label="Email address" type="email" value={form.email} onChange={(value) => setForm({ ...form, email: value })} testId="input-teacher-email" required />
            {isRegister && <TisField label="School name" value={form.schoolName} onChange={(value) => setForm({ ...form, schoolName: value })} testId="input-teacher-school" required />}
            <TisField label="Password" type="password" value={form.password} onChange={(value) => setForm({ ...form, password: value })} testId="input-teacher-password" required minLength={isRegister ? 8 : undefined} />
            {isRegister && (
              <div className="rounded-2xl border border-[hsl(var(--border))] p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <p className="text-sm font-bold">Classes you teach</p>
                    <p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">One row per class — grade, section and subject.</p>
                  </div>
                  <TisButton type="button" variant="outline" className="shrink-0 whitespace-nowrap px-3 py-2" onClick={() => setClassRows([...classRows, { grade: '5', section: '', subject: '' }])} data-testid="button-add-class-row"><Plus size={15} />Add class</TisButton>
                </div>
                <div className="mt-4 space-y-4">
                  {rows.map((row, index) => (
                    <div key={index} className="space-y-3 border-t border-[hsl(var(--border))] pt-4 first:border-0 first:pt-0 sm:grid sm:grid-cols-[84px_84px_1fr_auto] sm:items-end sm:gap-2 sm:space-y-0 sm:border-0 sm:pt-0" data-testid={`row-class-${index}`}>
                      <div className="grid grid-cols-2 gap-3 sm:contents">
                        <TisSelect label="Grade" value={row.grade} onChange={(value) => setClassRows(classRows.map((item, position) => { if (position !== index) return item; const options = presetOptionsFor(presetOptions.entries, value); return { ...item, grade: value, subject: options[0]?.value ?? '' }; }))} testId={`select-class-grade-${index}`} options={CLASS_GRADE_OPTIONS} />
                        <TisField label="Section" value={row.section} onChange={(value) => setClassRows(classRows.map((item, position) => position === index ? { ...item, section: value } : item))} testId={`input-class-section-${index}`} placeholder="A" maxLength={3} />
                      </div>
                      <TisSelect label="Subject" value={row.subject} onChange={(value) => setClassRows(classRows.map((item, position) => position === index ? { ...item, subject: value } : item))} testId={`select-class-subject-${index}`} options={presetOptionsFor(presetOptions.entries, row.grade)} hint={subjectHint(presetOptions, row.grade, row.subject)} emptyLabel={presetOptions.loading ? 'Loading…' : 'Not available yet'} />
                      {rows.length > 1 && (
                        <button type="button" onClick={() => setClassRows(classRows.filter((_, position) => position !== index))} data-testid={`button-remove-class-${index}`} className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-[hsl(var(--border))] py-2.5 text-xs font-bold text-[hsl(var(--muted-foreground))] sm:mb-1 sm:w-auto sm:border-0 sm:p-2.5"><Trash2 size={16} /><span className="sm:hidden">Remove class</span></button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
          <TisButton type="submit" disabled={pending || (isRegister && presetOptions.loading)} data-testid="button-teacher-submit" className="mt-6 w-full py-3.5">{pending ? 'Just a moment…' : isRegister ? 'Create TIS account' : 'Log in to TIS'}<ArrowRight size={16} /></TisButton>
          {!isRegister && <p className="mt-3 text-center text-xs"><Link href="/recover" data-testid="link-teacher-forgot-password" className="font-bold text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--accent-foreground))] hover:underline">Forgot your password?</Link></p>}
          {error && <p data-testid="status-teacher-auth-error" className="mt-3 text-xs font-semibold text-[#93473a]">{error}</p>}
        </form>
      </main>
      <footer className="px-5 pb-8 sm:px-8"><PoweredBy /></footer>
    </div>
  );
}

function StatCard({ label, value, detail, tone = 'plain' }: { label: string; value: string; detail?: string; tone?: 'plain' | 'navy' | 'gold' }) {
  return (
    <div className={cn('rounded-[1.5rem] p-5', tone === 'navy' && 'bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]', tone === 'gold' && 'bg-[hsl(var(--accent))] text-[hsl(var(--accent-foreground))]', tone === 'plain' && 'border border-[hsl(var(--border))] bg-[hsl(var(--card))]')}>
      <p className={cn('mono-face text-[10px] uppercase tracking-[.16em]', tone === 'plain' ? 'text-[hsl(var(--muted-foreground))]' : 'opacity-70')}>{label}</p>
      <p className="display-face mt-3 text-3xl font-bold tracking-[-.04em]">{value}</p>
      {detail && <p className={cn('mt-1 text-xs font-semibold', tone === 'plain' ? 'text-[hsl(var(--muted-foreground))]' : 'opacity-75')}>{detail}</p>}
    </div>
  );
}

function LearnerFlag({ learner }: { learner: ClassLearnerRow }) {
  if (learner.flags.includes('NEVER_ATTENDED')) return <span data-testid={`flag-not-attending-${learner.id}`} className="inline-flex items-center gap-1.5 rounded-full bg-[#f8dcd6] px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-[#93473a]"><AlertTriangle size={12} />Never attended</span>;
  if (learner.flags.includes('NOT_ATTENDING')) return <span data-testid={`flag-not-attending-${learner.id}`} className="inline-flex items-center gap-1.5 rounded-full bg-[#f8dcd6] px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-[#93473a]"><AlertTriangle size={12} />{learner.attendance.daysSinceLastActive}d inactive</span>;
  if (learner.flags.includes('MISSED_WORK')) return <span data-testid={`flag-red-${learner.id}`} className="inline-flex items-center gap-1.5 rounded-full bg-[#f8dcd6] px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-[#93473a]"><AlertTriangle size={12} />{learner.missedAssignments} missed</span>;
  if (learner.flags.includes('LOW_AVERAGE')) return <span data-testid={`flag-amber-${learner.id}`} className="inline-flex items-center gap-1.5 rounded-full bg-[#f7e8be] px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-[#74551f]"><AlertTriangle size={12} />Below 50%</span>;
  return <span className="text-[11px] font-semibold text-[hsl(var(--muted-foreground))]">On track</span>;
}

function PerformanceChart({ performance }: { performance: ClassPerformance }) {
  const points = performance.points;
  if (points.length < 2) {
    return <p className="mt-5 text-sm text-[hsl(var(--muted-foreground))]">{points.length ? 'One marked assignment so far — the trend line appears from the second assignment.' : 'No marked assignments yet. The graph fills as learners submit.'}</p>;
  }
  const width = 100;
  const height = 42;
  const coords = points.map((point, index) => ({
    ...point,
    x: (index / (points.length - 1)) * width,
    y: height - (point.averageScore / 100) * height,
  }));
  const line = coords.map((point) => `${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(' ');
  return (
    <div className="mt-5">
      <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className="h-40 w-full" role="img" aria-label="Class average score per assignment">
        {[25, 50, 75].map((value) => <line key={value} x1={0} x2={width} y1={height - (value / 100) * height} y2={height - (value / 100) * height} stroke="hsl(var(--border))" strokeWidth={0.3} />)}
        <polyline points={line} fill="none" stroke="hsl(var(--primary))" strokeWidth={0.9} strokeLinejoin="round" />
        {coords.map((point) => <circle key={point.assignmentId} cx={point.x} cy={point.y} r={1.4} fill={point.isLowest ? 'hsl(var(--destructive))' : 'hsl(var(--accent))'} />)}
      </svg>
      <div className="mt-4 grid gap-2">
        {points.map((point) => (
          <div key={point.assignmentId} data-testid={`row-performance-${point.assignmentId}`} className={cn('flex items-center justify-between gap-3 rounded-xl px-3 py-2 text-sm', point.isLowest ? 'bg-[#f8dcd6]' : 'bg-[hsl(var(--muted))]')}>
            <span className="truncate font-semibold">{point.title}</span>
            <span className="mono-face shrink-0 text-xs">{point.averageScore}% · {point.submissions} submitted{point.isLowest ? ' · needs revisiting' : ''}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function PendingMarkingQueue({ submissions }: { submissions: Array<{
  submissionId: string;
  learnerName: string;
  assignmentTitle: string;
  submittedAt: string;
  questions: Array<{ index: number; prompt: string; concept: string; learnerAnswer: string; mark: { score: number | null; explanation: string } | null }>;
}> }) {
  const mark = useMarkSubmission();
  const [drafts, setDrafts] = useState<Record<string, { score: string; comment: string }>>({});
  if (!submissions.length) return null;
  const draftFor = (submissionId: string, index: number, score: number | null, comment: string) => drafts[`${submissionId}:${index}`] ?? { score: score === null ? '' : String(score), comment };
  const updateDraft = (key: string, patch: Partial<{ score: string; comment: string }>) => setDrafts((previous) => ({ ...previous, [key]: { ...(previous[key] ?? { score: '', comment: '' }), ...patch } }));
  return (
    <section data-testid="section-pending-marking" className="rounded-[1.75rem] border-2 border-[hsl(var(--accent)/.55)] bg-[#fffaf0] p-5 sm:p-7">
      <div className="flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-[hsl(var(--accent))] text-[hsl(var(--accent-foreground))]"><NotebookPen size={18} /></span>
        <div><p className="mono-face text-[10px] uppercase tracking-[.16em] text-[#74551f]">Teacher action</p><h2 className="mt-1 text-xl font-bold">Submissions waiting for marking</h2><p className="mt-1 text-sm text-[#74551f]">Add a score and comment for each held question. Learners will see the completed analysis when marking and the release rule allow it.</p></div>
      </div>
      <div className="mt-5 space-y-4">
        {submissions.map((submission) => (
          <div key={submission.submissionId} className="rounded-2xl border border-[#e8d59e] bg-[hsl(var(--card))] p-4">
            <div className="flex flex-wrap items-start justify-between gap-2"><div><p className="font-bold">{submission.learnerName}</p><p className="text-xs text-[hsl(var(--muted-foreground))]">{submission.assignmentTitle} · submitted {formatDate(submission.submittedAt, true)}</p></div><span className="rounded-full bg-[#f7e8be] px-2.5 py-1 text-[10px] font-bold text-[#74551f]">Needs review</span></div>
            <div className="mt-4 space-y-3">
              {submission.questions.map((question) => {
                const key = `${submission.submissionId}:${question.index}`;
                const draft = draftFor(submission.submissionId, question.index, question.mark?.score ?? null, question.mark?.explanation ?? '');
                return <div key={key} className="rounded-xl border border-[hsl(var(--border))] p-3">
                  <p className="text-xs font-bold">Question {question.index + 1} · {question.concept}</p>
                  <p className="mt-2 text-sm">{question.prompt}</p>
                  <p className="mt-2 rounded-lg bg-[hsl(var(--muted))] px-3 py-2 text-xs"><span className="font-bold">Learner answer:</span> {question.learnerAnswer || 'No answer'}</p>
                  <div className="mt-3 grid gap-2 sm:grid-cols-[110px_1fr_auto]">
                    <input type="number" min="0" max="100" value={draft.score} onChange={(event) => updateDraft(key, { score: event.target.value })} placeholder="Score %" className="rounded-lg border border-[hsl(var(--input))] bg-[hsl(var(--background)/.55)] px-3 py-2 text-sm outline-none focus:border-[hsl(var(--accent))]" />
                    <input value={draft.comment} onChange={(event) => updateDraft(key, { comment: event.target.value })} placeholder="Feedback comment" className="rounded-lg border border-[hsl(var(--input))] bg-[hsl(var(--background)/.55)] px-3 py-2 text-sm outline-none focus:border-[hsl(var(--accent))]" />
                    <TisButton type="button" disabled={mark.isPending || draft.score === ''} onClick={() => mark.mutate({ submissionId: submission.submissionId, questionIndex: question.index, score: Number(draft.score), comment: draft.comment })} variant="outline" data-testid={`button-mark-${submission.submissionId}-${question.index}`}>Save mark</TisButton>
                  </div>
                </div>;
              })}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

// Opens one learner's marked script, either from the submission list (by
// submissionId) or from a learner row (by learnerId + assignmentId).
function TeacherScriptView({ submissionId, learnerId, assignmentId, onClose }: { submissionId: string | null; learnerId?: string; assignmentId?: string; onClose: () => void }) {
  const { activeClass } = useTis();
  const bySubmission = useSubmissionScript(submissionId);
  const byLearner = useLearnerAssignmentScript(submissionId ? null : activeClass?.id ?? null, learnerId ?? '', assignmentId ?? null);
  const script = submissionId ? bySubmission : byLearner;
  if (script.isLoading) return <TisLoading label="Opening the marked script…" />;
  if (script.isError || !script.data) return <TisError message={errorText(script.error)} retry={() => script.refetch()} />;
  return <MarkedScriptView script={script.data} onBack={onClose} backLabel="Back to class overview" />;
}

export function TisOverview() {
  const { activeClass, classes } = useTis();
  const overview = useClassOverview(activeClass?.id ?? null);
  const [openScript, setOpenScript] = useState<{ submissionId: string | null; learnerId?: string; assignmentId?: string } | null>(null);
  if (!classes.length) {
    return <div className="rounded-3xl border border-dashed border-[hsl(var(--border))] p-8 text-center"><p className="font-bold">No classes yet</p><p className="mt-2 text-sm text-[hsl(var(--muted-foreground))]">Add the classes you teach to start seeing learner data.</p><Link href="/teacher/classes" data-testid="link-manage-classes" className="mt-4 inline-flex items-center gap-2 font-bold text-[hsl(var(--accent-foreground))]">Manage classes <ArrowRight size={15} /></Link></div>;
  }
  if (overview.isLoading) return <TisLoading />;
  if (overview.isError || !overview.data) return <TisError message={errorText(overview.error)} retry={() => overview.refetch()} />;
  if (openScript) return <TeacherScriptView {...openScript} onClose={() => setOpenScript(null)} />;
  const data = overview.data;
  const flagged = data.learners.filter((learner) => learner.flags.length > 0).length;
  return (
    <div className="space-y-6">
      <div>
        <p className="mono-face text-[11px] uppercase tracking-[.2em] text-[hsl(var(--accent-foreground)/.75)]">TIS · Class overview</p>
        <h1 data-testid="text-class-title" className="display-face mt-2 text-balance text-2xl font-bold leading-tight tracking-[-.04em] sm:text-3xl lg:text-4xl lg:tracking-[-.05em]">{data.class.label}</h1>
        <p className="mt-2 text-sm text-[hsl(var(--muted-foreground))]">{data.class.schoolName} · class code <span data-testid="text-class-code" className="mono-face font-bold text-[hsl(var(--foreground))]">{data.class.joinCode}</span></p>
      </div>

      {data.gapAlert && (
        <div data-testid="alert-class-gap" className="rounded-[1.75rem] border-2 border-[hsl(var(--destructive)/.35)] bg-[#fff2ee] p-6">
          <div className="flex items-start gap-4">
            <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-[hsl(var(--destructive))] text-[hsl(var(--destructive-foreground))]"><AlertTriangle size={22} /></span>
            <div>
              <p className="display-face text-xl font-bold leading-snug text-[#8f2f22] sm:text-2xl">{data.gapAlert.message}</p>
              <p className="mt-2 text-sm text-[#7d4a41]">{data.gapAlert.strugglingLearners} of {data.gapAlert.learnersAssessed} assessed learners are below 60% on this concept (class average {data.gapAlert.averageScore}%). Your lesson plan needs attention here.</p>
              <Link href="/teacher/lesson-plan" data-testid="link-gap-lesson-plan" className="mt-4 inline-flex items-center gap-2 text-sm font-bold text-[#8f2f22] underline">Analyse my lesson plan against this gap <ArrowRight size={15} /></Link>
            </div>
          </div>
        </div>
      )}

      <PendingMarkingQueue submissions={data.pendingMarking} />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard tone="navy" label="Learners" value={String(data.class.learnerCount)} detail={`${flagged} flagged`} />
        <StatCard tone="gold" label="Class average" value={`${data.performance.classAverage}%`} detail={data.performance.trend.toLowerCase().replaceAll('_', ' ')} />
        <StatCard label="Assignments set" value={String(data.assignments.length)} detail={`${data.assignments.filter((assignment) => assignment.status === 'OPEN').length} open now`} />
        <StatCard label="Concept gaps tracked" value={String(data.conceptGaps.length)} detail={data.conceptGaps[0] ? `${data.conceptGaps[0].concept}` : 'No submissions yet'} />
      </div>

      <section className="rounded-[1.75rem] border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5 sm:p-7">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="mono-face text-[10px] uppercase tracking-[.16em] text-[hsl(var(--muted-foreground))]">Class overview</p>
            <h2 className="mt-1 text-xl font-bold">Every learner in this class</h2>
          </div>
          <Users size={20} className="text-[hsl(var(--accent-foreground))]" />
        </div>
        {!data.learners.length ? (
          <p className="mt-5 text-sm text-[hsl(var(--muted-foreground))]">No learners have joined yet. Share class code <span className="mono-face font-bold">{data.class.joinCode}</span> with them.</p>
        ) : (
          <div className="mt-5 space-y-3">
            {data.learners.map((learner) => (
              <Link
                key={learner.id}
                href={`/teacher/learners/${learner.id}`}
                data-testid={`row-learner-${learner.id}`}
                className={cn(
                  'block rounded-2xl border p-4 transition-transform hover:-translate-y-0.5',
                  learner.flags.includes('MISSED_WORK') ? 'border-[#dfa79b] bg-[#fff4f1]' : learner.flags.includes('LOW_AVERAGE') ? 'border-[#e3cb8e] bg-[#fffaee]' : 'border-[hsl(var(--border))] bg-[hsl(var(--background)/.4)]',
                )}
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="font-bold">{learner.fullName}</p>
                    <p className="text-xs text-[hsl(var(--muted-foreground))]">@{learner.username} · last active {formatDate(learner.lastActive)}</p>
                  </div>
                  <LearnerFlag learner={learner} />
                </div>
                <div className="mt-4 grid gap-3 text-xs sm:grid-cols-4">
                  <div><p className="text-[hsl(var(--muted-foreground))]">Average</p><p className="mono-face mt-1 text-base font-medium">{learner.averageScore}%</p></div>
                  <div><p className="text-[hsl(var(--muted-foreground))]">Streak</p><p className="mono-face mt-1 text-base font-medium">{learner.streakDays} days</p></div>
                  <div><p className="text-[hsl(var(--muted-foreground))]">Strongest</p><p className="mt-1 font-semibold">{learner.strongestConcept ?? 'Not measured yet'}</p></div>
                  <div><p className="text-[hsl(var(--muted-foreground))]">Weakest</p><p className="mt-1 font-semibold">{learner.weakestConcept ?? 'Not measured yet'}</p></div>
                </div>
                <p className="mt-3 text-[11px] text-[hsl(var(--muted-foreground))]">
                  Attendance: <span className="font-bold text-[hsl(var(--foreground))]" data-testid={`text-attendance-${learner.id}`}>{learner.attendance.daysActive7} of 7 days active · {learner.attendance.daysActive30} of 30 days active</span>
                  {learner.attendance.daysSinceLastActive !== null && <> · last seen {learner.attendance.daysSinceLastActive === 0 ? 'today' : `${learner.attendance.daysSinceLastActive}d ago`}</>}
                </p>
              </Link>
            ))}
          </div>
        )}
      </section>

      {data.submissions.length > 0 && (
        <section className="rounded-[1.75rem] border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5 sm:p-7">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="mono-face text-[10px] uppercase tracking-[.16em] text-[hsl(var(--muted-foreground))]">Submitted work</p>
              <h2 className="mt-1 text-xl font-bold">Review a learner's answers</h2>
            </div>
            <NotebookPen size={20} className="text-[hsl(var(--accent-foreground))]" />
          </div>
          <div className="mt-5 space-y-2">
            {data.submissions.map((submission) => (
              <div key={submission.submissionId} data-testid={`row-submission-${submission.submissionId}`} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[hsl(var(--border))] px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate font-bold">{submission.learnerName}</p>
                  <p className="text-xs text-[hsl(var(--muted-foreground))]">{submission.assignmentTitle} · {formatDate(submission.submittedAt, true)} · {submission.score}% · {submission.markingStatus === 'MARKED' ? 'marked' : 'in marking'}</p>
                </div>
                <TisButton
                  variant="outline"
                  data-testid={`button-view-script-${submission.submissionId}`}
                  onClick={() => setOpenScript({ submissionId: submission.submissionId })}
                >
                  View script
                </TisButton>
              </div>
            ))}
          </div>
        </section>
      )}

      <div className="grid gap-5 lg:grid-cols-2">
        <section className="rounded-[1.75rem] border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5 sm:p-7">
          <div className="flex items-center justify-between"><div><p className="mono-face text-[10px] uppercase tracking-[.16em] text-[hsl(var(--muted-foreground))]">Live progress</p><h2 className="mt-1 text-xl font-bold">Assignments</h2></div><ClipboardList size={20} className="text-[hsl(var(--accent-foreground))]" /></div>
          {!data.assignments.length ? <p className="mt-5 text-sm text-[hsl(var(--muted-foreground))]">You have not set an assignment for this class yet.</p> : (
            <div className="mt-5 space-y-3">
              {data.assignments.map((assignment) => (
                <div key={assignment.id} data-testid={`row-assignment-${assignment.id}`} className="rounded-2xl border border-[hsl(var(--border))] p-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div><p className="font-bold">{assignment.title}</p><p className="text-xs text-[hsl(var(--muted-foreground))]">{assignment.topic} · {assignment.questionCount} questions</p></div>
                    <span className={cn('rounded-full px-2.5 py-1 text-[11px] font-bold uppercase', assignment.status === 'OPEN' ? 'bg-[hsl(var(--secondary))] text-[hsl(var(--secondary-foreground))]' : assignment.status === 'LOCKED' ? 'bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))]' : 'bg-[#f1e3d9] text-[#8a5334]')}>{assignment.status}</span>
                  </div>
                  <div className="mt-3 grid grid-cols-4 gap-2 text-center text-xs">
                    <div className="rounded-xl bg-[hsl(var(--muted))] py-2"><p className="mono-face text-base">{assignment.started}</p><p className="text-[hsl(var(--muted-foreground))]">started</p></div>
                    <div className="rounded-xl bg-[hsl(var(--secondary))] py-2"><p className="mono-face text-base">{assignment.submitted}</p><p className="text-[hsl(var(--secondary-foreground)/.8)]">submitted</p></div>
                    <div className="rounded-xl bg-[#f8dcd6] py-2"><p className="mono-face text-base">{assignment.missed}</p><p className="text-[#93473a]">missed</p></div>
                    <div className="rounded-xl bg-[#f7e8be] py-2"><p className="mono-face text-base">{assignment.averageScore}%</p><p className="text-[#74551f]">average</p></div>
                  </div>
                  <p className="mt-3 text-[11px] text-[hsl(var(--muted-foreground))]">Opens {formatDate(assignment.openAt, true)} · closes {formatDate(assignment.closeAt, true)}</p>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="rounded-[1.75rem] border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5 sm:p-7">
          <div className="flex items-center justify-between"><div><p className="mono-face text-[10px] uppercase tracking-[.16em] text-[hsl(var(--muted-foreground))]">Class performance over time</p><h2 className="mt-1 text-xl font-bold">{data.performance.trend === 'IMPROVING' ? 'Improving' : data.performance.trend === 'DECLINING' ? 'Declining' : data.performance.trend === 'STAGNATING' ? 'Stagnating' : 'Not enough data yet'}</h2></div>{data.performance.trend === 'DECLINING' ? <TrendingDown size={20} className="text-[hsl(var(--destructive))]" /> : <TrendingUp size={20} className="text-[hsl(var(--accent-foreground))]" />}</div>
          <PerformanceChart performance={data.performance} />
        </section>
      </div>

      {data.conceptGaps.length > 0 && (
        <section className="rounded-[1.75rem] border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5 sm:p-7">
          <div className="flex items-center justify-between"><div><p className="mono-face text-[10px] uppercase tracking-[.16em] text-[hsl(var(--muted-foreground))]">Measured from every submission</p><h2 className="mt-1 text-xl font-bold">Concept gaps in this class</h2></div><LineChart size={20} className="text-[hsl(var(--accent-foreground))]" /></div>
          <div className="mt-5 space-y-3">
            {data.conceptGaps.map((gap) => (
              <div key={gap.concept} data-testid={`row-gap-${gap.concept}`}>
                <div className="flex justify-between text-xs"><span className="font-bold">{gap.concept}</span><span className="mono-face text-[hsl(var(--muted-foreground))]">{gap.strugglingPercentage}% struggling · avg {gap.averageScore}%</span></div>
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-[hsl(var(--muted))]"><div className={cn('h-full rounded-full', gap.strugglingPercentage >= 50 ? 'bg-[hsl(var(--destructive))]' : 'bg-[hsl(var(--accent))]')} style={{ width: `${gap.strugglingPercentage}%` }} /></div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function ClassModeControls({ entry }: { entry: TeacherClass }) {
  const setMode = useSetClassMode();
  const upload = useUploadClassCurriculum();
  const [showUpload, setShowUpload] = useState(false);
  const [sequence, setSequence] = useState<string[]>([]);
  const select = (mode: ClassMode) => {
    if (mode === entry.mode && mode !== 'INDEPENDENT') return;
    setMode.mutate({ classId: entry.id, mode }, {
      onSuccess: () => { if (mode === 'INDEPENDENT') setShowUpload(true); },
    });
    if (mode === 'INDEPENDENT') setShowUpload(true);
  };
  return (
    <div className="mt-4 border-t border-[hsl(var(--border))] pt-4">
      <p className="mb-2 text-[11px] font-bold uppercase tracking-[.08em] text-[hsl(var(--muted-foreground))]">Operating mode</p>
      <ClassModeToggle mode={entry.mode} pending={setMode.isPending} onSelect={select} testIdPrefix={`class-${entry.id}`} />
      {entry.mode === 'INDEPENDENT' && (
        <p data-testid={`text-mode-note-${entry.id}`} className="mt-2 text-[11px] leading-4 text-[#1d6b3c]">
          Slate is teaching this class autonomously{entry.lessonSequence.length ? ` — ${entry.lessonSequence.length} topics in sequence, currently on step ${Math.min(entry.currentTopicIndex + 1, entry.lessonSequence.length)} of ${entry.lessonSequence.length}` : ''}.
        </p>
      )}
      {(showUpload || (entry.mode === 'INDEPENDENT' && !entry.hasCurriculum)) && (
        <CurriculumUpload
          pending={upload.isPending}
          error={upload.isError ? errorText(upload.error) : ''}
          sequence={sequence.length ? sequence : entry.lessonSequence}
          currentFileName={entry.curriculumFileName}
          testIdPrefix={`class-${entry.id}`}
          onUpload={(payload) => upload.mutate({ classId: entry.id, ...payload }, { onSuccess: (data) => setSequence(data.lessonSequence) })}
        />
      )}
      {entry.mode === 'INDEPENDENT' && entry.hasCurriculum && !showUpload && (
        <button
          type="button"
          onClick={(event) => { event.stopPropagation(); setShowUpload(true); }}
          data-testid={`button-replace-curriculum-${entry.id}`}
          className="mt-2 text-[11px] font-bold text-[hsl(var(--accent-foreground))] underline underline-offset-2"
        >
          Replace curriculum ({entry.curriculumFileName ?? 'uploaded'})
        </button>
      )}
    </div>
  );
}

const MATERIAL_KIND_OPTIONS = [
  { value: 'NOTE', label: 'Notes' },
  { value: 'REVISION', label: 'Revision' },
  { value: 'QUIZ', label: 'Class quiz' },
  { value: 'DEMONSTRATION', label: 'Demonstration' },
] as const;

function materialKindMeta(kind: string) {
  const map: Record<string, { label: string; icon: typeof FileText }> = {
    NOTE: { label: 'Notes', icon: FileText },
    REVISION: { label: 'Revision', icon: ListChecks },
    QUIZ: { label: 'Class quiz', icon: ClipboardList },
    DEMONSTRATION: { label: 'Demonstration', icon: Presentation },
  };
  return map[kind] ?? { label: 'Material', icon: Layers };
}

// Study material a teacher shares into the learner's classroom environment:
// notes, revision material, class quizzes and demonstrations. The learner sees
// these grouped inside the classroom; here the teacher adds and removes them.
function ClassMaterialsPanel({ entry }: { entry: TeacherClass }) {
  const materials = useClassMaterials(entry.id);
  const add = useAddClassMaterial();
  const remove = useDeleteClassMaterial();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ title: '', description: '', kind: 'NOTE' as 'NOTE' | 'REVISION' | 'QUIZ' | 'DEMONSTRATION', content: '' });
  const [file, setFile] = useState<{ name: string; type: string; base64: string } | null>(null);
  const [error, setError] = useState('');

  const pickFile = (chosen: File) => {
    setError('');
    if (chosen.size > 3 * 1024 * 1024) { setError('Keep attachments under 3 MB.'); return; }
    const reader = new FileReader();
    reader.onload = () => setFile({ name: chosen.name, type: chosen.type || 'application/octet-stream', base64: String(reader.result).split(',')[1] ?? '' });
    reader.onerror = () => setError('That file could not be read. Choose it again.');
    reader.readAsDataURL(chosen);
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setError('');
    if (form.title.trim().length < 2) { setError('Give the material a title.'); return; }
    if (!form.content.trim() && !file) { setError('Add notes or attach a file.'); return; }
    add.mutate({
      classId: entry.id,
      data: {
        title: form.title.trim(),
        description: form.description.trim(),
        kind: form.kind,
        ...(form.content.trim() ? { content: form.content.trim() } : {}),
        ...(file ? { fileName: file.name, fileType: file.type, fileBase64: file.base64 } : {}),
      },
    }, {
      onSuccess: () => { setForm({ title: '', description: '', kind: 'NOTE', content: '' }); setFile(null); },
      onError: (mutationError) => setError(errorText(mutationError)),
    });
  };

  const count = materials.data?.materials.length ?? 0;
  return (
    <div className="mt-4 border-t border-[hsl(var(--border))] pt-4" onClick={(event) => event.stopPropagation()}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] font-bold uppercase tracking-[.08em] text-[hsl(var(--muted-foreground))]">Study material</p>
        <button type="button" onClick={() => setOpen((value) => !value)} data-testid={`button-materials-${entry.id}`} className="text-[11px] font-bold text-[hsl(var(--accent-foreground))] underline underline-offset-2">{open ? 'Close' : count ? `Manage (${count})` : 'Add material'}</button>
      </div>

      {open && (
        <div data-testid={`panel-materials-${entry.id}`} className="mt-3 space-y-3">
          {materials.isLoading && <p className="text-[11px] text-[hsl(var(--muted-foreground))]">Loading material…</p>}
          {materials.data?.materials.map((material) => {
            const meta = materialKindMeta(material.kind);
            const Icon = meta.icon;
            return (
              <div key={material.id} data-testid={`row-material-${material.id}`} className="flex items-start justify-between gap-3 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--background)/.5)] p-3">
                <div className="flex min-w-0 items-start gap-2">
                  <Icon size={15} className="mt-0.5 shrink-0 text-[hsl(var(--accent-foreground))]" />
                  <div className="min-w-0">
                    <p className="truncate text-xs font-bold">{material.title}</p>
                    <p className="text-[10px] text-[hsl(var(--muted-foreground))]">{meta.label}{material.hasFile && material.fileName ? ` · ${material.fileName}` : material.hasContent ? ' · notes' : ''}</p>
                  </div>
                </div>
                <button type="button" disabled={remove.isPending} onClick={() => remove.mutate({ classId: entry.id, materialId: material.id })} data-testid={`button-remove-material-${material.id}`} className="shrink-0 rounded-lg p-1.5 text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))] disabled:opacity-50"><Trash2 size={14} /></button>
              </div>
            );
          })}

          <form onSubmit={submit} className="rounded-xl border border-dashed border-[hsl(var(--border))] p-3">
            <div className="grid gap-2 sm:grid-cols-2">
              <input value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} data-testid={`input-material-title-${entry.id}`} placeholder="Title (e.g. Fractions revision notes)" className="rounded-lg border border-[hsl(var(--input))] bg-[hsl(var(--background)/.55)] px-3 py-2 text-xs outline-none focus:border-[hsl(var(--accent))]" />
              <select value={form.kind} onChange={(event) => setForm({ ...form, kind: event.target.value as typeof form.kind })} data-testid={`select-material-kind-${entry.id}`} className="rounded-lg border border-[hsl(var(--input))] bg-[hsl(var(--background)/.55)] px-3 py-2 text-xs outline-none focus:border-[hsl(var(--accent))]">
                {MATERIAL_KIND_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </div>
            <input value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} data-testid={`input-material-description-${entry.id}`} placeholder="Short description (optional)" className="mt-2 w-full rounded-lg border border-[hsl(var(--input))] bg-[hsl(var(--background)/.55)] px-3 py-2 text-xs outline-none focus:border-[hsl(var(--accent))]" />
            <textarea value={form.content} onChange={(event) => setForm({ ...form, content: event.target.value })} rows={3} data-testid={`input-material-content-${entry.id}`} placeholder="Paste notes, a revision summary or quiz questions…" className="mt-2 w-full rounded-lg border border-[hsl(var(--input))] bg-[hsl(var(--background)/.55)] px-3 py-2 text-xs outline-none focus:border-[hsl(var(--accent))]" />
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-[hsl(var(--border))] px-3 py-2 text-[11px] font-bold hover:border-[hsl(var(--accent))]">
                <FileUp size={13} />{file ? file.name : 'Attach PDF / image'}
                <input type="file" accept="application/pdf,.pdf,image/*" className="hidden" data-testid={`input-material-file-${entry.id}`} onChange={(event) => { const chosen = event.target.files?.[0]; if (chosen) pickFile(chosen); event.target.value = ''; }} />
              </label>
              {file && <button type="button" onClick={() => setFile(null)} className="text-[11px] font-bold text-[hsl(var(--muted-foreground))]">Remove file</button>}
              <button type="submit" disabled={add.isPending} data-testid={`button-add-material-${entry.id}`} className="ml-auto inline-flex items-center gap-1.5 rounded-lg bg-[hsl(var(--primary))] px-3 py-2 text-[11px] font-bold text-[hsl(var(--primary-foreground))] disabled:opacity-50"><Plus size={13} />{add.isPending ? 'Saving…' : 'Share with class'}</button>
            </div>
            {error && <p data-testid={`status-material-error-${entry.id}`} className="mt-2 text-[11px] font-semibold text-[#93473a]">{error}</p>}
          </form>
        </div>
      )}
    </div>
  );
}

export function TisAllClasses() {
  const summary = useClassSummary();
  const addClass = useAddClass();
  const { setActiveClassId } = useTis();
  const [, setLocation] = useLocation();
  const presetOptions = usePresetSubjectOptions();
  const [form, setForm] = useState({ grade: '5', section: '', subject: '' });
  const subject = resolveSubject(presetOptions.entries, form.grade, form.subject);
  const [error, setError] = useState('');
  if (summary.isLoading) return <TisLoading label="Adding up every class…" />;
  if (summary.isError || !summary.data) return <TisError message={errorText(summary.error)} retry={() => summary.refetch()} />;
  const classes = summary.data.classes;
  const add = (event: FormEvent) => {
    event.preventDefault();
    setError('');
    if (!subject) { setError(presetOptions.failed ? 'Subjects could not load — please refresh and try again.' : `${gradeLabel(form.grade)} has no subjects yet — choose another grade.`); return; }
    addClass.mutate({ grade: Number(form.grade), section: form.section.trim().toUpperCase(), subject }, {
      onSuccess: () => setForm({ grade: '5', section: '', subject: '' }),
      onError: (mutationError) => setError(errorText(mutationError)),
    });
  };
  return (
    <div className="space-y-6">
      <div>
        <p className="mono-face text-[11px] uppercase tracking-[.2em] text-[hsl(var(--accent-foreground)/.75)]">TIS · Cross-class view</p>
        <h1 className="display-face mt-2 text-4xl font-bold tracking-[-.05em]">All my classes</h1>
        <p className="mt-2 text-sm text-[hsl(var(--muted-foreground))]">A bird's-eye view before you drill into one class.</p>
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {classes.map((entry) => (
          <div key={entry.id} className="rounded-[1.75rem] border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5 text-left transition-transform hover:-translate-y-1 hover:shadow-md">
            <button
              onClick={() => { setActiveClassId(entry.id); setLocation('/teacher'); }}
              data-testid={`card-class-${entry.id}`}
              className="block w-full text-left"
            >
              <div className="flex items-start justify-between gap-3">
                <div><p className="font-bold">{entry.label}</p><p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">{entry.learnerCount} learners · code {entry.joinCode}</p></div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <span className={cn('rounded-full px-2.5 py-1 text-[11px] font-bold', entry.mode === 'INDEPENDENT' ? 'bg-[#d9efe0] text-[#1d6b3c]' : 'bg-[#dbe7f6] text-[#1e4e8c]')} data-testid={`badge-mode-${entry.id}`}>{entry.mode === 'INDEPENDENT' ? 'Independent' : 'Teacher-led'}</span>
                  {entry.gapAlert ? <span className="rounded-full bg-[#f8dcd6] px-2.5 py-1 text-[11px] font-bold text-[#93473a]">Gap</span> : <span className="rounded-full bg-[hsl(var(--secondary))] px-2.5 py-1 text-[11px] font-bold text-[hsl(var(--secondary-foreground))]">Steady</span>}
                </div>
              </div>
              <div className="mt-5 grid grid-cols-3 gap-2 text-center text-xs">
                <div className="rounded-xl bg-[hsl(var(--muted))] py-2"><p className="mono-face text-base">{entry.classAverage}%</p><p className="text-[hsl(var(--muted-foreground))]">average</p></div>
                <div className="rounded-xl bg-[#f7e8be] py-2"><p className="mono-face text-base">{entry.learnersWithGaps}</p><p className="text-[#74551f]">flagged</p></div>
                <div className="rounded-xl bg-[hsl(var(--secondary))] py-2"><p className="mono-face text-base">{entry.topStrugglingPercentage}%</p><p className="text-[hsl(var(--secondary-foreground)/.8)]">struggling</p></div>
              </div>
              <p className="mt-4 text-xs text-[hsl(var(--muted-foreground))]">Most common struggling concept: <span className="font-bold text-[hsl(var(--foreground))]">{entry.topStrugglingConcept ?? 'None measured yet'}</span></p>
            </button>
            <ClassModeControls entry={entry} />
            <ClassMaterialsPanel entry={entry} />
          </div>
        ))}
      </div>
      <form onSubmit={add} className="rounded-[1.75rem] border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5 sm:p-7">
        <h2 className="text-lg font-bold">Add another class</h2>
        <div className="mt-4 space-y-3 sm:grid sm:grid-cols-[100px_100px_1fr_auto] sm:items-end sm:gap-3 sm:space-y-0">
          <div className="grid grid-cols-2 gap-3 sm:contents">
            <TisSelect label="Grade" value={form.grade} onChange={(value) => { const options = presetOptionsFor(presetOptions.entries, value); setForm({ ...form, grade: value, subject: options[0]?.value ?? '' }); }} testId="select-new-class-grade" options={CLASS_GRADE_OPTIONS} />
            <TisField label="Section" value={form.section} onChange={(value) => setForm({ ...form, section: value })} testId="input-new-class-section" placeholder="A" maxLength={3} />
          </div>
          <TisSelect label="Subject" value={subject} onChange={(value) => setForm({ ...form, subject: value })} testId="select-new-class-subject" options={presetOptionsFor(presetOptions.entries, form.grade)} hint={subjectHint(presetOptions, form.grade, subject)} emptyLabel={presetOptions.loading ? 'Loading…' : 'Not available yet'} />
          <TisButton type="submit" disabled={addClass.isPending || presetOptions.loading} className="w-full sm:mb-1 sm:w-auto" data-testid="button-add-class"><Plus size={15} />{addClass.isPending ? 'Adding…' : 'Add class'}</TisButton>
        </div>
        {error && <p data-testid="status-add-class-error" className="mt-3 text-xs font-semibold text-[#93473a]">{error}</p>}
      </form>
    </div>
  );
}

export function TisLessonPlan() {
  const { activeClass } = useTis();
  const overview = useClassOverview(activeClass?.id ?? null);
  const analyse = useAnalyseLessonPlan(activeClass?.id ?? null);
  const [lessonPlan, setLessonPlan] = useState('');
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const result = analyse.data;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    setError('');
    if (lessonPlan.trim().length < 20) { setError('Paste a little more of your lesson plan so the analysis is useful.'); return; }
    analyse.mutate({ lessonPlan }, { onError: (mutationError) => setError(errorText(mutationError)) });
  };
  return (
    <div className="space-y-6">
      <div>
        <p className="mono-face text-[11px] uppercase tracking-[.2em] text-[hsl(var(--accent-foreground)/.75)]">TIS · Lesson plan assistant</p>
        <h1 className="display-face mt-2 text-4xl font-bold tracking-[-.05em]">Analyse against class gaps</h1>
        <p className="mt-2 text-sm text-[hsl(var(--muted-foreground))]">Preparing for <span className="font-bold text-[hsl(var(--foreground))]">{activeClass?.label ?? 'no class selected'}</span>. Switch class at the top to prepare for another.</p>
      </div>
      {overview.data?.gapAlert && <div className="rounded-2xl bg-[#fff2ee] p-4 text-sm font-semibold text-[#8f2f22]">{overview.data.gapAlert.message}</div>}
      <form onSubmit={submit} className="rounded-[1.75rem] border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5 sm:p-7">
        <label className="block">
          <span className="mb-2 block text-sm font-bold">Your lesson plan</span>
          <textarea
            value={lessonPlan}
            onChange={(event) => setLessonPlan(event.target.value)}
            data-testid="input-lesson-plan"
            placeholder="Type or paste your lesson plan here…"
            className="min-h-[220px] w-full rounded-2xl border border-[hsl(var(--input))] bg-[hsl(var(--background)/.55)] p-4 text-sm outline-none focus:border-[hsl(var(--accent))]"
          />
        </label>
        <TisButton type="submit" disabled={analyse.isPending || !activeClass} data-testid="button-analyse-lesson-plan" className="mt-4"><Sparkles size={16} />{analyse.isPending ? 'Analysing against class gaps…' : 'Analyse against class gaps'}</TisButton>
        {error && <p data-testid="status-lesson-plan-error" className="mt-3 text-xs font-semibold text-[#93473a]">{error}</p>}
      </form>
      {result && (
        <div data-testid="panel-lesson-plan-analysis" className="space-y-5">
          <section className="rounded-[1.75rem] border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5 sm:p-7">
            <h2 className="text-xl font-bold">What your plan already covers</h2>
            {result.analysis.covered.length ? (
              <ul className="mt-4 space-y-3">
                {result.analysis.covered.map((item) => (
                  <li key={item.concept} className="rounded-2xl bg-[hsl(var(--secondary)/.55)] p-4"><p className="font-bold text-[hsl(var(--secondary-foreground))]">{item.concept}</p><p className="mt-1 text-sm text-[hsl(var(--secondary-foreground)/.85)]">{item.evidence}</p></li>
                ))}
              </ul>
            ) : <p className="mt-3 text-sm text-[hsl(var(--muted-foreground))]">None of the measured gaps are addressed by this plan yet.</p>}
          </section>
          <section className="rounded-[1.75rem] border border-[#e7beb4] bg-[#fff4f1] p-5 sm:p-7">
            <h2 className="text-xl font-bold text-[#8f2f22]">Gaps not covered</h2>
            {result.analysis.notCovered.length ? (
              <ul className="mt-4 space-y-3">
                {result.analysis.notCovered.map((item) => (
                  <li key={item.concept} data-testid={`row-gap-uncovered-${item.concept}`} className="rounded-2xl bg-[hsl(var(--card))] p-4"><p className="font-bold">{item.concept} <span className="mono-face text-xs text-[hsl(var(--muted-foreground))]">{item.strugglingPercentage}% struggling</span></p><p className="mt-1 text-sm text-[hsl(var(--muted-foreground))]">{item.why}</p></li>
                ))}
              </ul>
            ) : <p className="mt-3 text-sm text-[#7d4a41]">Every measured gap is covered by this plan.</p>}
          </section>
          <section className="rounded-[1.75rem] border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5 sm:p-7">
            <h2 className="text-xl font-bold">Suggested adjustments</h2>
            <ul className="mt-4 space-y-2 text-sm">
              {result.analysis.suggestions.map((suggestion, index) => (
                <li key={index} className="flex gap-3 rounded-2xl bg-[hsl(var(--muted))] p-4"><span className="mono-face shrink-0 text-xs text-[hsl(var(--accent-foreground))]">{String(index + 1).padStart(2, '0')}</span>{suggestion}</li>
              ))}
            </ul>
          </section>
          <section className="rounded-[1.75rem] bg-[hsl(var(--primary))] p-5 text-[hsl(var(--primary-foreground))] sm:p-7">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-xl font-bold">Revised lesson plan</h2>
              <TisButton
                variant="gold"
                onClick={() => { void navigator.clipboard?.writeText(result.analysis.revisedLessonPlan); setCopied(true); setTimeout(() => setCopied(false), 2500); }}
                data-testid="button-copy-lesson-plan"
              >
                <Copy size={15} />{copied ? 'Copied' : 'Copy plan'}
              </TisButton>
            </div>
            <pre data-testid="text-revised-lesson-plan" className="mt-5 max-h-[520px] overflow-auto whitespace-pre-wrap rounded-2xl bg-[hsl(var(--sidebar-accent))] p-5 text-sm leading-7">{result.analysis.revisedLessonPlan}</pre>
          </section>
        </div>
      )}
    </div>
  );
}

function blankAssignmentQuestion(index: number): ReviewedAssignmentQuestion {
  return { id: `q${index + 1}`, prompt: '', type: 'text', options: [], concept: '', answer: '' };
}

function readPdfAsBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('The PDF could not be read. Choose the file again.'));
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      const separator = result.indexOf(',');
      if (separator < 0) reject(new Error('The selected file could not be encoded as a PDF.'));
      else resolve(result.slice(separator + 1));
    };
    reader.readAsDataURL(file);
  });
}

export function TisNewAssignment() {
  const { classes, activeClass } = useTis();
  const create = useCreateClassAssignment();
  const publish = usePublishClassAssignment();
  const [selected, setSelected] = useState<string[]>(activeClass ? [activeClass.id] : []);
  const [multipleClasses, setMultipleClasses] = useState(false);
  const [form, setForm] = useState(() => {
    const now = new Date();
    const close = new Date(now.getTime() + 3 * 60 * 60 * 1000);
    return {
      title: '',
      topic: '',
      questionCount: '4',
      openAt: toLocalInput(now),
      closeAt: toLocalInput(close),
      markingMode: 'auto' as 'auto' | 'selective' | 'manual',
      questionTypes: ['multiple_choice', 'text'] as string[],
      questionSource: 'ai' as 'ai' | 'manual' | 'pdf',
      resultReleasePolicy: 'after_close' as 'after_close' | 'immediate',
      autoMarkInput: '1',
    };
  });
  const [error, setError] = useState('');
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [preparingPdf, setPreparingPdf] = useState(false);
  const [manualQuestions, setManualQuestions] = useState<ReviewedAssignmentQuestion[]>(
    () => Array.from({ length: 4 }, (_, index) => blankAssignmentQuestion(index)),
  );
  const [reviewAssignments, setReviewAssignments] = useState<Array<{
    id: string;
    classId: string | null;
    title: string;
    topic: string;
    questionCount: number;
    questions: ReviewedAssignmentQuestion[];
    published: boolean;
  }> | null>(null);
  const selectedClasses = classes.filter((entry) => selected.includes(entry.id));
  const curriculumTopics = [...new Set(selectedClasses.flatMap((entry) => entry.lessonSequence ?? []))].slice(0, 24);
  const toggleType = (type: string) => setForm((previous) => ({
    ...previous,
    questionTypes: previous.questionTypes.includes(type)
      ? previous.questionTypes.filter((entry) => entry !== type)
      : [...previous.questionTypes, type],
  }));
  const updateReviewQuestion = (assignmentId: string, questionId: string, patch: Partial<ReviewedAssignmentQuestion>) => {
    setReviewAssignments((previous) => previous ? previous.map((assignment) => assignment.id !== assignmentId
      ? assignment
      : { ...assignment, questions: assignment.questions.map((question) => question.id === questionId ? { ...question, ...patch } : question) }) : previous);
  };
  const updateManualQuestion = (index: number, patch: Partial<ReviewedAssignmentQuestion>) => {
    setManualQuestions((previous) => previous.map((question, questionIndex) => questionIndex === index ? { ...question, ...patch } : question));
  };
  const publishReviewedAssignment = (assignment: NonNullable<typeof reviewAssignments>[number]) => {
    const invalid = assignment.questions.some((question) =>
      !question.prompt.trim()
      || !question.concept.trim()
      || !question.answer.trim()
      || (question.type === 'multiple_choice' && (question.options?.filter((option) => option.trim()).length ?? 0) < 2),
    );
    if (invalid) { setError('Complete each prompt, concept, answer key and multiple-choice option before publishing.'); return; }
    setError('');
    publish.mutate(
      { assignmentId: assignment.id, questions: assignment.questions },
      {
        onSuccess: () => setReviewAssignments((previous) => previous ? previous.map((entry) => entry.id === assignment.id ? { ...entry, published: true } : entry) : previous),
        onError: (mutationError) => setError(errorText(mutationError)),
      },
    );
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    setReviewAssignments(null);
    if (!selected.length) { setError('Choose at least one class for this assignment.'); return; }
    if (!form.topic.trim()) { setError('Enter the concept or topic learners will work on.'); return; }
    if (form.questionSource !== 'manual' && !form.questionTypes.length) { setError('Choose at least one question type.'); return; }
    const autoMarkQuestions = form.autoMarkInput.split(',').map((value) => Number(value.trim()) - 1).filter((value) => Number.isInteger(value) && value >= 0);
    if (form.markingMode === 'selective' && !autoMarkQuestions.length) { setError('Choose at least one question number to auto-mark.'); return; }
    const questionCount = Number(form.questionCount);
    const authoredQuestions = manualQuestions.slice(0, questionCount).map((question, index) => ({
      ...question,
      id: `q${index + 1}`,
      prompt: question.prompt.trim(),
      concept: question.concept.trim(),
      answer: question.answer.trim(),
      options: question.options?.map((option) => option.trim()).filter(Boolean) ?? [],
    }));
    if (form.questionSource === 'manual') {
      const incomplete = authoredQuestions.some((question) =>
        !question.prompt.trim()
        || !question.concept.trim()
        || !question.answer.trim()
        || (question.type === 'multiple_choice' && (question.options?.filter((option) => option.trim()).length ?? 0) < 2),
      );
      if (incomplete) { setError('Complete every question, concept and answer key. Multiple-choice questions need at least two options.'); return; }
    }
    if (form.questionSource === 'pdf' && !pdfFile) { setError('Choose a PDF to extract editable question drafts.'); return; }
    setPreparingPdf(form.questionSource === 'pdf');
    try {
      const pdfBase64 = form.questionSource === 'pdf' && pdfFile ? await readPdfAsBase64(pdfFile) : undefined;
      setPreparingPdf(false);
      create.mutate({
        classIds: selected,
        title: form.title.trim() || undefined,
        topic: form.topic.trim(),
        questionCount,
        openAt: new Date(form.openAt).toISOString(),
        closeAt: new Date(form.closeAt).toISOString(),
        markingMode: form.markingMode,
        autoMarkQuestions,
        questionTypes: form.questionSource === 'manual'
          ? [...new Set(authoredQuestions.map((question) => question.type))]
          : form.questionTypes,
        resultReleasePolicy: form.resultReleasePolicy,
        questionSource: form.questionSource,
        ...(form.questionSource === 'manual' ? { questions: authoredQuestions } : {}),
        ...(pdfBase64 && pdfFile ? { pdfBase64, fileName: pdfFile.name } : {}),
      }, {
        onSuccess: (data) => setReviewAssignments(data.assignments.map((assignment) => ({
          id: assignment.id,
          classId: assignment.classId,
          title: assignment.title,
          topic: assignment.topic,
          questionCount: assignment.questionCount,
          questions: assignment.questions,
          published: assignment.isPublished,
        }))),
        onError: (mutationError) => setError(errorText(mutationError)),
      });
    } catch (readError) {
      setError(readError instanceof Error ? readError.message : 'The PDF could not be read.');
      setPreparingPdf(false);
    }
  };
  return (
    <div className="space-y-6">
      <div>
        <p className="mono-face text-[11px] uppercase tracking-[.2em] text-[hsl(var(--accent-foreground)/.75)]">TIS · Assignment creation</p>
        <h1 className="display-face mt-2 text-4xl font-bold tracking-[-.05em]">Set an assignment</h1>
        <p className="mt-2 text-sm text-[hsl(var(--muted-foreground))]">{form.questionSource === 'ai' ? 'Create AI question drafts aligned to your class curriculum, then approve them before learners can see the assignment.' : form.questionSource === 'pdf' ? 'Extract editable question drafts from a PDF, review them, then approve before learners can see the assignment.' : 'Write questions directly in the app, review the final set, then approve before learners can see the assignment.'}</p>
      </div>
      <form onSubmit={submit} className="space-y-6">
        <TisFormCard step="1" title="Choose a class" description="Pick the class this assignment is for.">
          <ClassPicker classes={classes} selected={selected} onChange={setSelected} multiple={multipleClasses} />
          <label className="mt-3 flex cursor-pointer items-center gap-2.5 text-xs font-semibold text-[hsl(var(--muted-foreground))]">
            <input type="checkbox" checked={multipleClasses} onChange={(event) => setMultipleClasses(event.target.checked)} data-testid="checkbox-assignment-multiple-classes" className="size-4 rounded border-[hsl(var(--input))] accent-[hsl(var(--accent))]" />
            Set this assignment for more than one class
          </label>
          {multipleClasses && selected.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {selectedClasses.map((entry) => (
                <span key={entry.id} className="inline-flex items-center gap-1.5 rounded-full bg-[hsl(var(--accent)/.18)] px-3 py-1.5 text-[11px] font-bold text-[hsl(var(--accent-foreground))]">
                  {entry.label}
                  <button type="button" onClick={() => setSelected((previous) => previous.filter((id) => id !== entry.id))} aria-label={`Remove ${entry.label}`} className="text-[hsl(var(--accent-foreground)/.7)] hover:text-[hsl(var(--accent-foreground))]"><X size={12} /></button>
                </span>
              ))}
            </div>
          )}
        </TisFormCard>

        <TisFormCard step="2" title="Assignment details" description="Name it, say what learners will work on, and choose how it is marked.">
          <div className="grid gap-4 sm:grid-cols-2">
            <TisField label="Concept / topic" value={form.topic} onChange={(value) => setForm({ ...form, topic: value })} testId="input-assignment-topic" placeholder="Equivalent fractions" required />
            <TisField label="Title (optional)" value={form.title} onChange={(value) => setForm({ ...form, title: value })} testId="input-assignment-title" placeholder="Fractions in the real world" />
          </div>
          <div className="mt-4 grid gap-4 sm:grid-cols-3">
            <TisSelect label="Question source" value={form.questionSource} onChange={(value) => setForm({ ...form, questionSource: value as typeof form.questionSource })} testId="select-assignment-question-source" options={[{ value: 'ai', label: 'AI question drafts' }, { value: 'manual', label: 'Write questions here' }, { value: 'pdf', label: 'Extract from a PDF' }]} />
            <TisSelect label="Number of questions" value={form.questionCount} onChange={(value) => {
              setForm((previous) => ({ ...previous, questionCount: value }));
              setManualQuestions((previous) => Array.from({ length: Number(value) }, (_, index) => previous[index] ?? blankAssignmentQuestion(index)));
            }} testId="select-assignment-questions" options={Array.from({ length: 10 }, (_, offset) => ({ value: String(offset + 1), label: String(offset + 1) }))} />
            <TisSelect label="Marking" value={form.markingMode} onChange={(value) => setForm({ ...form, markingMode: value as typeof form.markingMode })} testId="select-assignment-marking" options={[{ value: 'auto', label: 'Automatic marking' }, { value: 'selective', label: 'Hybrid: teacher marks some' }, { value: 'manual', label: 'Teacher marks all' }]} />
            <div className="grid grid-cols-2 gap-3 sm:col-span-2">
              <TisField label="Opens" type="datetime-local" value={form.openAt} onChange={(value) => setForm({ ...form, openAt: value })} testId="input-assignment-open" required />
              <TisField label="Closes" type="datetime-local" value={form.closeAt} onChange={(value) => setForm({ ...form, closeAt: value })} testId="input-assignment-close" required />
            </div>
            <TisSelect label="Release learner results" value={form.resultReleasePolicy} onChange={(value) => setForm({ ...form, resultReleasePolicy: value as typeof form.resultReleasePolicy })} testId="select-assignment-release" options={[{ value: 'after_close', label: 'After the assignment closes' }, { value: 'immediate', label: 'As soon as marking is complete' }]} />
          </div>
          {form.markingMode === 'selective' && <div className="mt-4 max-w-[280px]"><TisField label="Auto-mark question numbers" value={form.autoMarkInput} onChange={(value) => setForm({ ...form, autoMarkInput: value })} testId="input-assignment-auto-mark" placeholder="1, 3" /></div>}
        </TisFormCard>

        <TopicSuggestions topics={curriculumTopics} value={form.topic} onPick={(topic) => setForm((previous) => ({ ...previous, topic }))} />

        <TisFormCard step="4" title="Questions" description="Tell Slate how to build the question set, then prepare it for your review.">
          {form.questionSource !== 'manual' && (
            <div>
              <p className="text-xs font-bold text-[hsl(var(--muted-foreground))]">Question types</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {[['multiple_choice', 'Multiple choice'], ['text', 'Written response'], ['equation', 'Equation / working']].map(([value, label]) => (
                  <button type="button" key={value} onClick={() => toggleType(value)} data-testid={`button-assignment-question-type-${value}`} className={cn('rounded-full border px-3.5 py-2 text-xs font-bold transition-colors', form.questionTypes.includes(value) ? 'border-[hsl(var(--accent))] bg-[hsl(var(--accent))] text-[hsl(var(--accent-foreground))]' : 'border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))] hover:border-[hsl(var(--accent))]')}>{label}</button>
                ))}
              </div>
            </div>
          )}
          {form.questionSource === 'pdf' && <div className="mt-4 rounded-2xl border border-dashed border-[hsl(var(--border))] bg-[hsl(var(--background)/.4)] p-4">
            <label className="block text-xs font-bold" htmlFor="input-assignment-pdf">PDF to extract from</label>
            <input id="input-assignment-pdf" data-testid="input-assignment-pdf" type="file" accept="application/pdf,.pdf" onChange={(event) => {
              const file = event.target.files?.[0] ?? null;
              if (file && (file.size > 5 * 1024 * 1024 || (!(file.type === 'application/pdf') && !file.name.toLowerCase().endsWith('.pdf')))) {
                setPdfFile(null);
                setError(file.size > 5 * 1024 * 1024 ? 'Choose a PDF smaller than 5 MB.' : 'Choose a PDF file.');
                event.target.value = '';
                return;
              }
              setError('');
              setPdfFile(file);
            }} className="mt-2 block w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-[hsl(var(--secondary))] file:px-3 file:py-2 file:text-xs file:font-bold" />
            <p className="mt-2 text-xs leading-5 text-[hsl(var(--muted-foreground))]">{pdfFile ? `${pdfFile.name} · ${Math.ceil(pdfFile.size / 1024)} KB` : 'PDF only, up to 5 MB. The file is used for extraction and is not retained.'}</p>
          </div>}
          {form.questionSource === 'manual' && <div className="space-y-3">
            <div>
              <p className="text-sm font-bold">Write the questions</p>
              <p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">These approved drafts will be delivered as written, without AI rewriting them for each learner.</p>
            </div>
            {manualQuestions.slice(0, Number(form.questionCount)).map((question, index) => <section key={question.id} className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--background)/.4)] p-4">
              <p className="mb-3 text-xs font-black uppercase tracking-wider text-[hsl(var(--muted-foreground))]">Question {index + 1}</p>
              <label className="block"><span className="text-xs font-bold">Prompt</span><textarea value={question.prompt} onChange={(event) => updateManualQuestion(index, { prompt: event.target.value })} data-testid={`input-manual-prompt-${index}`} className="mt-1 min-h-20 w-full rounded-xl border border-[hsl(var(--input))] bg-[hsl(var(--card))] p-3 text-sm outline-none focus:border-[hsl(var(--accent))]" placeholder="Write the question exactly as learners should see it." /></label>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <TisSelect label="Question type" value={question.type} onChange={(value) => updateManualQuestion(index, { type: value as ReviewedAssignmentQuestion['type'], options: value === 'multiple_choice' ? (question.options?.length ? question.options : ['', '']) : [] })} testId={`select-manual-type-${index}`} options={[{ value: 'text', label: 'Written response' }, { value: 'equation', label: 'Equation / working' }, { value: 'multiple_choice', label: 'Multiple choice' }]} />
                <TisField label="Concept" value={question.concept} onChange={(value) => updateManualQuestion(index, { concept: value })} testId={`input-manual-concept-${index}`} placeholder="Equivalent fractions" />
                <TisField label="Answer key" value={question.answer} onChange={(value) => updateManualQuestion(index, { answer: value })} testId={`input-manual-answer-${index}`} placeholder="Expected answer or marking guide" />
                {question.type === 'multiple_choice' && <label className="block"><span className="text-xs font-bold">Options (one per line)</span><textarea value={(question.options ?? []).join('\n')} onChange={(event) => updateManualQuestion(index, { options: event.target.value.split(/\r?\n/).map((option) => option.trim()).filter(Boolean) })} data-testid={`input-manual-options-${index}`} className="mt-1 min-h-[88px] w-full rounded-xl border border-[hsl(var(--input))] bg-[hsl(var(--card))] p-3 text-sm outline-none focus:border-[hsl(var(--accent))]" placeholder={'Option one\nOption two'} /></label>}
              </div>
            </section>)}
          </div>}
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <TisButton variant="gold" type="submit" disabled={create.isPending || preparingPdf} data-testid="button-create-assignment"><CalendarClock size={16} />{preparingPdf ? 'Preparing PDF…' : create.isPending ? 'Preparing questions…' : 'Prepare questions for review'}</TisButton>
            {selected.length > 0 && <span className="text-xs font-semibold text-[hsl(var(--muted-foreground))]">{selected.length} {selected.length === 1 ? 'class' : 'classes'} selected</span>}
          </div>
          {error && <p data-testid="status-create-assignment-error" className="mt-3 rounded-xl border border-[#dfa79b] bg-[#fff4f1] px-4 py-3 text-xs font-semibold text-[#93473a]">{error}</p>}
        </TisFormCard>
      </form>
      {reviewAssignments && <div className="space-y-5">
        <div>
          <p className="mono-face text-[11px] uppercase tracking-[.2em] text-[hsl(var(--accent-foreground)/.75)]">Teacher review required</p>
          <h2 className="mt-2 text-2xl font-bold">Check the question set before publishing</h2>
          <p className="mt-2 text-sm text-[hsl(var(--muted-foreground))]">Review and edit every prompt, question type, option, concept label and answer key. Publishing stays under your control.</p>
        </div>
        <p data-testid="status-create-assignment-success" className="rounded-xl bg-[hsl(var(--secondary))] px-4 py-3 text-sm font-bold text-[hsl(var(--secondary-foreground))]">Questions generated. Review and publish each class version below before learners can see the assignment.</p>
        {reviewAssignments.map((assignment) => <section key={assignment.id} className="rounded-[1.75rem] border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5 sm:p-7">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div><p className="text-xs font-bold text-[hsl(var(--muted-foreground))]">{assignment.title}</p><h3 className="mt-1 text-lg font-bold">{assignment.topic}</h3></div>
            {assignment.published ? <span className="rounded-full bg-[hsl(var(--secondary))] px-3 py-1.5 text-xs font-bold text-[hsl(var(--secondary-foreground))]">Published</span> : <TisButton type="button" variant="gold" disabled={publish.isPending} onClick={() => publishReviewedAssignment(assignment)} data-testid={`button-publish-assignment-${assignment.id}`}><Sparkles size={15} />{publish.isPending ? 'Publishing…' : 'Approve and publish'}</TisButton>}
          </div>
          <div className="mt-5 space-y-3">
            {assignment.questions.map((question, index) => <div key={question.id} className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--background)/.4)] p-4">
              <div className="mb-3 flex items-center justify-between gap-3"><span className="mono-face text-[10px] uppercase tracking-[.15em] text-[hsl(var(--muted-foreground))]">Question {index + 1}</span><span className="text-[10px] font-bold text-[hsl(var(--muted-foreground))]">Answer key visible to teacher</span></div>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="sm:col-span-2"><span className="text-xs font-bold">Prompt</span><textarea value={question.prompt} onChange={(event) => updateReviewQuestion(assignment.id, question.id, { prompt: event.target.value })} className="mt-1 min-h-20 w-full rounded-xl border border-[hsl(var(--input))] bg-[hsl(var(--card))] p-3 text-sm outline-none focus:border-[hsl(var(--accent))]" /></label>
                <TisSelect label="Question type" value={question.type} onChange={(value) => updateReviewQuestion(assignment.id, question.id, { type: value as ReviewedAssignmentQuestion['type'], options: value === 'multiple_choice' ? (question.options?.length ? question.options : ['', '']) : [] })} testId={`select-review-type-${assignment.id}-${index}`} options={[{ value: 'text', label: 'Written response' }, { value: 'equation', label: 'Equation / working' }, { value: 'multiple_choice', label: 'Multiple choice' }]} />
                <TisField label="Concept" value={question.concept} onChange={(value) => updateReviewQuestion(assignment.id, question.id, { concept: value })} testId={`input-review-concept-${assignment.id}-${index}`} />
                <TisField label="Answer key" value={question.answer} onChange={(value) => updateReviewQuestion(assignment.id, question.id, { answer: value })} testId={`input-review-answer-${assignment.id}-${index}`} />
                {question.type === 'multiple_choice' && <label className="block"><span className="text-xs font-bold">Options (one per line)</span><textarea value={(question.options ?? []).join('\n')} onChange={(event) => updateReviewQuestion(assignment.id, question.id, { options: event.target.value.split(/\r?\n/).map((option) => option.trim()).filter(Boolean) })} data-testid={`input-review-options-${assignment.id}-${index}`} className="mt-1 min-h-[88px] w-full rounded-xl border border-[hsl(var(--input))] bg-[hsl(var(--card))] p-3 text-sm outline-none focus:border-[hsl(var(--accent))]" placeholder={'Option one\nOption two'} /></label>}
              </div>
            </div>)}
          </div>
        </section>)}
      </div>}
    </div>
  );
}

export function TisLearnerDetail() {
  const { activeClass } = useTis();
  const { learnerId = '' } = useParams<{ learnerId: string }>();
  const drillDown = useLearnerDrillDown(activeClass?.id ?? null, learnerId);
  const [scriptAssignmentId, setScriptAssignmentId] = useState<string | null>(null);
  if (drillDown.isLoading) return <TisLoading label="Opening this learner's history…" />;
  if (drillDown.isError || !drillDown.data) return <TisError message={errorText(drillDown.error)} retry={() => drillDown.refetch()} />;
  if (scriptAssignmentId) return <TeacherScriptView submissionId={null} learnerId={learnerId} assignmentId={scriptAssignmentId} onClose={() => setScriptAssignmentId(null)} />;
  const data = drillDown.data;
  return (
    <div className="space-y-6">
      <Link href="/teacher" data-testid="link-back-class" className="inline-flex items-center gap-2 text-sm font-bold text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"><ArrowLeft size={16} />Back to {data.class.label}</Link>
      <div>
        <p className="mono-face text-[11px] uppercase tracking-[.2em] text-[hsl(var(--accent-foreground)/.75)]">TIS · Learner drill-down</p>
        <h1 data-testid="text-learner-name" className="display-face mt-2 text-4xl font-bold tracking-[-.05em]">{data.learner.fullName}</h1>
        <p className="mt-2 text-sm text-[hsl(var(--muted-foreground))]">@{data.learner.username} · Grade {data.learner.grade} · {data.learner.schoolName}</p>
      </div>
      {data.persistentGaps.length > 0 && (
        <div data-testid="alert-persistent-gap" className="rounded-[1.5rem] border-2 border-[hsl(var(--destructive)/.35)] bg-[#fff2ee] p-5">
          <p className="font-bold text-[#8f2f22]">Persistent gap</p>
          {data.persistentGaps.map((gap) => (
            <p key={gap.concept} className="mt-2 text-sm text-[#7d4a41]">{gap.concept} — failed {gap.failures} times across {gap.formats.length} different activity types ({gap.formats.join(', ').toLowerCase()}). This learner needs direct teaching support.</p>
          ))}
        </div>
      )}
      <div className="grid gap-5 lg:grid-cols-2">
        <section className="rounded-[1.75rem] border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5 sm:p-7">
          <h2 className="text-xl font-bold">Assignment history</h2>
          {data.assignmentHistory.length ? (
            <div className="mt-4 space-y-2">
              {data.assignmentHistory.map((entry) => (
                <div key={`${entry.assignmentId}-${entry.submittedAt}`} data-testid={`row-history-${entry.assignmentId}`} className="flex items-center justify-between gap-3 rounded-xl bg-[hsl(var(--muted))] px-4 py-3 text-sm">
                  <div><p className="font-bold">{entry.title}</p><p className="text-xs text-[hsl(var(--muted-foreground))]">{entry.topic} · {formatDate(entry.submittedAt)}</p></div>
                  <div className="flex shrink-0 items-center gap-3">
                    <span className="mono-face text-base">{entry.score}%</span>
                    <TisButton variant="outline" data-testid={`button-view-script-history-${entry.assignmentId}`} onClick={() => setScriptAssignmentId(entry.assignmentId)}>Review answers</TisButton>
                  </div>
                </div>
              ))}
            </div>
          ) : <p className="mt-3 text-sm text-[hsl(var(--muted-foreground))]">No submissions in this class yet.</p>}
        </section>
        <section className="rounded-[1.75rem] border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5 sm:p-7">
          <h2 className="text-xl font-bold">Concepts</h2>
          <p className="mono-face mt-4 text-[10px] uppercase tracking-[.16em] text-[hsl(var(--muted-foreground))]">Mastered</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {data.conceptsMastered.length ? data.conceptsMastered.map((concept) => <span key={concept.concept} className="rounded-full bg-[hsl(var(--secondary))] px-3 py-1.5 text-xs font-bold text-[hsl(var(--secondary-foreground))]">{concept.concept} · {concept.averageScore}%</span>) : <span className="text-sm text-[hsl(var(--muted-foreground))]">Nothing mastered yet.</span>}
          </div>
          <p className="mono-face mt-5 text-[10px] uppercase tracking-[.16em] text-[hsl(var(--muted-foreground))]">Still developing</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {data.conceptsDeveloping.length ? data.conceptsDeveloping.map((concept) => <span key={concept.concept} className="rounded-full bg-[#f7e8be] px-3 py-1.5 text-xs font-bold text-[#74551f]">{concept.concept} · {concept.averageScore}%</span>) : <span className="text-sm text-[hsl(var(--muted-foreground))]">Nothing outstanding.</span>}
          </div>
        </section>
        <section className="rounded-[1.75rem] border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5 sm:p-7">
          <h2 className="text-xl font-bold">Learning style profile</h2>
          <p className="mt-1 text-sm text-[hsl(var(--muted-foreground))]">Activity types ranked by the scores this learner achieves.</p>
          <div className="mt-4 space-y-3">
            {data.learningStyle.length ? data.learningStyle.map((signal) => (
              <div key={signal.format}>
                <div className="flex justify-between text-xs"><span className="font-bold">{signal.format.replaceAll('_', ' ').toLowerCase()}</span><span className="mono-face text-[hsl(var(--muted-foreground))]">{signal.averageScore}% · {signal.attempts} attempts</span></div>
                <div className="mt-2 h-1.5 rounded-full bg-[hsl(var(--muted))]"><div className="h-full rounded-full bg-[hsl(var(--accent))]" style={{ width: `${signal.averageScore}%` }} /></div>
              </div>
            )) : <p className="text-sm text-[hsl(var(--muted-foreground))]">Not enough activity yet.</p>}
          </div>
        </section>
        <section className="rounded-[1.75rem] border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5 sm:p-7">
          <h2 className="text-xl font-bold">Adaptive activities</h2>
          {data.activities.length ? (
            <div className="mt-4 space-y-2">
              {data.activities.map((activity) => (
                <div key={activity.id} data-testid={`row-activity-${activity.id}`} className="rounded-xl bg-[hsl(var(--muted))] px-4 py-3 text-sm">
                  <div className="flex items-center justify-between gap-3"><p className="font-bold">{activity.title}</p><span className="mono-face text-xs">{activity.score === null ? 'not completed' : `${activity.score}%`}</span></div>
                  <p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">{activity.concept} · {activity.format.toLowerCase()} · {activity.helped === null ? 'no follow-up evidence yet' : activity.helped ? 'scores improved afterwards' : 'scores did not improve afterwards'}</p>
                </div>
              ))}
            </div>
          ) : <p className="mt-3 text-sm text-[hsl(var(--muted-foreground))]">No adaptive activities generated yet.</p>}
        </section>
      </div>
    </div>
  );
}

export function TeacherLoginLink() {
  return <Link href="/teacher/login" data-testid="link-teacher-login-home" className="inline-flex items-center gap-2 rounded-xl px-3 py-2.5 text-sm font-bold text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))]"><BookOpenCheck size={16} />Teacher login</Link>;
}

export { X as TisCloseIcon };
