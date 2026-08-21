import { createContext, useContext, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useLocation, useParams } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  BookOpenCheck,
  CalendarClock,
  ChevronDown,
  ClipboardList,
  Copy,
  GraduationCap,
  LayoutGrid,
  LineChart,
  LogOut,
  NotebookPen,
  Plus,
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
  useAnalyseLessonPlan,
  useClassOverview,
  useClassSummary,
  useCreateClassAssignment,
  useLearnerDrillDown,
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
} from '@/lib/tis-api';
import { ClassModeToggle, CurriculumUpload } from '@/components/class-mode';

const SUBJECTS = ['Mathematics', 'English', 'Natural Sciences', 'Physical Sciences', 'Life Sciences', 'Social Sciences', 'Accounting', 'Technology', 'Life Orientation'];
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

function TisSelect({ label, value, onChange, options, testId }: { label: string; value: string; onChange: (value: string) => void; options: Array<{ value: string; label: string }>; testId: string }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-bold text-[hsl(var(--muted-foreground))]">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        data-testid={testId}
        className="w-full rounded-xl border border-[hsl(var(--input))] bg-[hsl(var(--background)/.55)] px-3.5 py-3 text-sm outline-none focus:border-[hsl(var(--accent))]"
      >
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </label>
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
    <Link href="/teacher" data-testid="link-tis-home" className="flex items-center gap-3">
      <span className="grid size-9 place-items-center rounded-[11px] bg-[hsl(var(--accent))] text-[hsl(var(--accent-foreground))]"><GraduationCap size={19} strokeWidth={2.6} /></span>
      <span>
        <span className="display-face block text-base font-bold leading-tight tracking-tight text-[hsl(var(--sidebar-foreground))]">TIS <span className="text-[hsl(var(--accent))]">Teaching Intelligence System</span></span>
        <span className="block text-[11px] text-[hsl(var(--sidebar-foreground)/.6)]">See every learner. Close every gap.</span>
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
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        data-testid="button-class-switcher"
        className="flex w-full items-center justify-between gap-3 rounded-xl border border-[hsl(var(--sidebar-border))] bg-[hsl(var(--sidebar-accent))] px-3.5 py-3 text-left text-sm font-bold text-[hsl(var(--sidebar-foreground))] sm:w-[260px]"
      >
        <span className="truncate">{activeClass?.label ?? 'Choose a class'}</span>
        <ChevronDown size={16} className={cn('shrink-0 transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="absolute right-0 z-30 mt-2 w-full min-w-[260px] overflow-hidden rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] shadow-lg">
          {classes.map((entry) => (
            <button
              key={entry.id}
              onClick={() => { setActiveClassId(entry.id); setOpen(false); }}
              data-testid={`button-class-option-${entry.id}`}
              className={cn('flex w-full items-center justify-between gap-3 px-4 py-3 text-left text-sm font-semibold hover:bg-[hsl(var(--muted))]', entry.id === activeClass?.id && 'bg-[hsl(var(--accent)/.18)]')}
            >
              <span>{entry.label}</span>
              <span className="mono-face text-[11px] text-[hsl(var(--muted-foreground))]">{entry.learnerCount} learners</span>
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
          <div className="mx-auto flex max-w-[1280px] flex-col gap-4 px-5 py-5 sm:px-8 lg:flex-row lg:items-center lg:justify-between">
            <TisMark />
            <div className="flex flex-wrap items-center gap-3">
              <ClassSwitcher />
              <div className="hidden text-right sm:block">
                <p data-testid="text-teacher-name" className="text-sm font-bold text-[hsl(var(--sidebar-foreground))]">{teacher.fullName}</p>
                <p className="text-[11px] text-[hsl(var(--sidebar-foreground)/.6)]">{teacher.schoolName}</p>
              </div>
              <button
                onClick={() => logout.mutate(undefined, { onSuccess: () => setLocation('/teacher/login') })}
                data-testid="button-teacher-logout"
                className="inline-flex items-center gap-2 rounded-xl px-3 py-2.5 text-sm font-bold text-[hsl(var(--sidebar-foreground)/.7)] hover:bg-[hsl(var(--sidebar-accent))]"
              >
                <LogOut size={16} />Sign out
              </button>
            </div>
          </div>
          <div className="mx-auto max-w-[1280px] overflow-x-auto px-5 sm:px-8">
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
        <main className="mx-auto max-w-[1280px] px-5 py-8 sm:px-8 lg:py-10">{children}</main>
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
  const [classRows, setClassRows] = useState([{ grade: '8', section: 'A', subject: 'Mathematics' }]);
  const pending = register.isPending || login.isPending;
  const onSuccess = (data: { teacher: unknown; classes: TeacherClass[] }) => {
    client.setQueryData(teacherKeys.me, data);
    setLocation('/teacher');
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    setError('');
    if (isRegister) {
      const classes = classRows
        .filter((row) => row.subject.trim() && row.grade)
        .map((row) => ({ grade: Number(row.grade), section: row.section.trim().toUpperCase(), subject: row.subject.trim() }));
      if (!classes.length) { setError('Add at least one class you teach.'); return; }
      register.mutate({ ...form, classes }, { onSuccess, onError: (mutationError) => setError(errorText(mutationError)) });
      return;
    }
    login.mutate({ email: form.email, password: form.password }, { onSuccess, onError: (mutationError) => setError(errorText(mutationError)) });
  };
  return (
    <div className="grain min-h-[100dvh] bg-[hsl(var(--background))]">
      <header className="bg-[hsl(var(--sidebar))] px-5 py-5 sm:px-8"><div className="mx-auto flex max-w-[1280px] items-center justify-between"><TisMark /><Link href="/" data-testid="link-learner-space" className="text-sm font-bold text-[hsl(var(--sidebar-foreground)/.7)] hover:text-[hsl(var(--accent))]">Learner space</Link></div></header>
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
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-bold">Classes you teach</p>
                    <p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">One row per class — grade, section and subject.</p>
                  </div>
                  <TisButton type="button" variant="outline" className="px-3 py-2" onClick={() => setClassRows([...classRows, { grade: '8', section: '', subject: 'Mathematics' }])} data-testid="button-add-class-row"><Plus size={15} />Add class</TisButton>
                </div>
                <div className="mt-4 space-y-3">
                  {classRows.map((row, index) => (
                    <div key={index} className="grid grid-cols-[80px_80px_1fr_auto] items-end gap-2" data-testid={`row-class-${index}`}>
                      <TisSelect label="Grade" value={row.grade} onChange={(value) => setClassRows(classRows.map((item, position) => position === index ? { ...item, grade: value } : item))} testId={`select-class-grade-${index}`} options={Array.from({ length: 9 }, (_, offset) => ({ value: String(offset + 4), label: String(offset + 4) }))} />
                      <TisField label="Section" value={row.section} onChange={(value) => setClassRows(classRows.map((item, position) => position === index ? { ...item, section: value } : item))} testId={`input-class-section-${index}`} placeholder="A" maxLength={3} />
                      <TisSelect label="Subject" value={row.subject} onChange={(value) => setClassRows(classRows.map((item, position) => position === index ? { ...item, subject: value } : item))} testId={`select-class-subject-${index}`} options={SUBJECTS.map((subject) => ({ value: subject, label: subject }))} />
                      <button type="button" onClick={() => setClassRows(classRows.filter((_, position) => position !== index))} disabled={classRows.length === 1} data-testid={`button-remove-class-${index}`} className="mb-1 rounded-xl p-2.5 text-[hsl(var(--muted-foreground))] disabled:opacity-30"><Trash2 size={16} /></button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
          <TisButton type="submit" disabled={pending} data-testid="button-teacher-submit" className="mt-6 w-full py-3.5">{pending ? 'Just a moment…' : isRegister ? 'Create TIS account' : 'Log in to TIS'}<ArrowRight size={16} /></TisButton>
          {error && <p data-testid="status-teacher-auth-error" className="mt-3 text-xs font-semibold text-[#93473a]">{error}</p>}
        </form>
      </main>
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

export function TisOverview() {
  const { activeClass, classes } = useTis();
  const overview = useClassOverview(activeClass?.id ?? null);
  if (!classes.length) {
    return <div className="rounded-3xl border border-dashed border-[hsl(var(--border))] p-8 text-center"><p className="font-bold">No classes yet</p><p className="mt-2 text-sm text-[hsl(var(--muted-foreground))]">Add the classes you teach to start seeing learner data.</p><Link href="/teacher/classes" data-testid="link-manage-classes" className="mt-4 inline-flex items-center gap-2 font-bold text-[hsl(var(--accent-foreground))]">Manage classes <ArrowRight size={15} /></Link></div>;
  }
  if (overview.isLoading) return <TisLoading />;
  if (overview.isError || !overview.data) return <TisError message={errorText(overview.error)} retry={() => overview.refetch()} />;
  const data = overview.data;
  const flagged = data.learners.filter((learner) => learner.flags.length > 0).length;
  return (
    <div className="space-y-6">
      <div>
        <p className="mono-face text-[11px] uppercase tracking-[.2em] text-[hsl(var(--accent-foreground)/.75)]">TIS · Class overview</p>
        <h1 data-testid="text-class-title" className="display-face mt-2 text-4xl font-bold tracking-[-.05em]">{data.class.label}</h1>
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
              </Link>
            ))}
          </div>
        )}
      </section>

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

export function TisAllClasses() {
  const summary = useClassSummary();
  const addClass = useAddClass();
  const { setActiveClassId } = useTis();
  const [, setLocation] = useLocation();
  const [form, setForm] = useState({ grade: '8', section: '', subject: 'Mathematics' });
  const [error, setError] = useState('');
  if (summary.isLoading) return <TisLoading label="Adding up every class…" />;
  if (summary.isError || !summary.data) return <TisError message={errorText(summary.error)} retry={() => summary.refetch()} />;
  const classes = summary.data.classes;
  const add = (event: FormEvent) => {
    event.preventDefault();
    setError('');
    addClass.mutate({ grade: Number(form.grade), section: form.section.trim().toUpperCase(), subject: form.subject }, {
      onSuccess: () => setForm({ grade: '8', section: '', subject: 'Mathematics' }),
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
          </div>
        ))}
      </div>
      <form onSubmit={add} className="rounded-[1.75rem] border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5 sm:p-7">
        <h2 className="text-lg font-bold">Add another class</h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-[100px_100px_1fr_auto] sm:items-end">
          <TisSelect label="Grade" value={form.grade} onChange={(value) => setForm({ ...form, grade: value })} testId="select-new-class-grade" options={Array.from({ length: 9 }, (_, offset) => ({ value: String(offset + 4), label: String(offset + 4) }))} />
          <TisField label="Section" value={form.section} onChange={(value) => setForm({ ...form, section: value })} testId="input-new-class-section" placeholder="A" maxLength={3} />
          <TisSelect label="Subject" value={form.subject} onChange={(value) => setForm({ ...form, subject: value })} testId="select-new-class-subject" options={SUBJECTS.map((subject) => ({ value: subject, label: subject }))} />
          <TisButton type="submit" disabled={addClass.isPending} data-testid="button-add-class"><Plus size={15} />{addClass.isPending ? 'Adding…' : 'Add class'}</TisButton>
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

export function TisNewAssignment() {
  const { classes, activeClass } = useTis();
  const create = useCreateClassAssignment();
  const [selected, setSelected] = useState<string[]>(activeClass ? [activeClass.id] : []);
  const [form, setForm] = useState(() => {
    const now = new Date();
    const close = new Date(now.getTime() + 3 * 60 * 60 * 1000);
    return { title: '', topic: '', questionCount: '4', openAt: toLocalInput(now), closeAt: toLocalInput(close) };
  });
  const [error, setError] = useState('');
  const [created, setCreated] = useState<string[] | null>(null);
  const toggle = (classId: string) => setSelected((previous) => previous.includes(classId) ? previous.filter((entry) => entry !== classId) : [...previous, classId]);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    setError('');
    setCreated(null);
    if (!selected.length) { setError('Choose at least one class for this assignment.'); return; }
    if (!form.topic.trim()) { setError('Enter the concept or topic learners will work on.'); return; }
    create.mutate({
      classIds: selected,
      title: form.title.trim() || undefined,
      topic: form.topic.trim(),
      questionCount: Number(form.questionCount),
      openAt: new Date(form.openAt).toISOString(),
      closeAt: new Date(form.closeAt).toISOString(),
    }, {
      onSuccess: (data) => setCreated(data.assignments.map((assignment) => assignment.id)),
      onError: (mutationError) => setError(errorText(mutationError)),
    });
  };
  return (
    <div className="space-y-6">
      <div>
        <p className="mono-face text-[11px] uppercase tracking-[.2em] text-[hsl(var(--accent-foreground)/.75)]">TIS · Assignment creation</p>
        <h1 className="display-face mt-2 text-4xl font-bold tracking-[-.05em]">Set an assignment</h1>
        <p className="mt-2 text-sm text-[hsl(var(--muted-foreground))]">Each learner gets their own AI-generated question set on this concept, inside your time window.</p>
      </div>
      <form onSubmit={submit} className="rounded-[1.75rem] border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5 sm:p-7">
        <p className="text-sm font-bold">Classes</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {classes.map((entry) => (
            <button
              type="button"
              key={entry.id}
              onClick={() => toggle(entry.id)}
              data-testid={`button-assignment-class-${entry.id}`}
              className={cn('rounded-full border px-3.5 py-2 text-xs font-bold', selected.includes(entry.id) ? 'border-[hsl(var(--accent))] bg-[hsl(var(--accent))] text-[hsl(var(--accent-foreground))]' : 'border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))]')}
            >
              {entry.label}
            </button>
          ))}
        </div>
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <TisField label="Concept / topic" value={form.topic} onChange={(value) => setForm({ ...form, topic: value })} testId="input-assignment-topic" placeholder="Equivalent fractions" required />
          <TisField label="Title (optional)" value={form.title} onChange={(value) => setForm({ ...form, title: value })} testId="input-assignment-title" placeholder="Fractions in the real world" />
          <TisSelect label="Number of questions" value={form.questionCount} onChange={(value) => setForm({ ...form, questionCount: value })} testId="select-assignment-questions" options={Array.from({ length: 10 }, (_, offset) => ({ value: String(offset + 1), label: String(offset + 1) }))} />
          <div className="grid grid-cols-2 gap-3">
            <TisField label="Opens" type="datetime-local" value={form.openAt} onChange={(value) => setForm({ ...form, openAt: value })} testId="input-assignment-open" required />
            <TisField label="Closes" type="datetime-local" value={form.closeAt} onChange={(value) => setForm({ ...form, closeAt: value })} testId="input-assignment-close" required />
          </div>
        </div>
        <TisButton type="submit" disabled={create.isPending} data-testid="button-create-assignment" className="mt-6"><CalendarClock size={16} />{create.isPending ? 'Creating…' : 'Create assignment'}</TisButton>
        {error && <p data-testid="status-create-assignment-error" className="mt-3 text-xs font-semibold text-[#93473a]">{error}</p>}
        {created && <p data-testid="status-create-assignment-success" className="mt-3 rounded-xl bg-[hsl(var(--secondary))] px-4 py-3 text-sm font-bold text-[hsl(var(--secondary-foreground))]">Assignment created for {created.length} class{created.length === 1 ? '' : 'es'}. Learners in {created.length === 1 ? 'that class' : 'those classes'} will see it when it opens.</p>}
      </form>
    </div>
  );
}

export function TisLearnerDetail() {
  const { activeClass } = useTis();
  const { learnerId = '' } = useParams<{ learnerId: string }>();
  const drillDown = useLearnerDrillDown(activeClass?.id ?? null, learnerId);
  if (drillDown.isLoading) return <TisLoading label="Opening this learner's history…" />;
  if (drillDown.isError || !drillDown.data) return <TisError message={errorText(drillDown.error)} retry={() => drillDown.refetch()} />;
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
                  <span className="mono-face text-base">{entry.score}%</span>
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
