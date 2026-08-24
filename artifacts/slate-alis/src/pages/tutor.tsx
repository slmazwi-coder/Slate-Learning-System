import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useLocation } from 'wouter';
import {
  AlertTriangle,
  BookOpen,
  ClipboardList,
  LayoutGrid,
  Loader2,
  LogOut,
  Plus,
  TrendingUp,
  Users,
  Zap,
} from 'lucide-react';
import { ClassModeToggle, CurriculumUpload } from '@/components/class-mode';
import {
  useAddTutorLearner,
  useSetTutorClassMode,
  useTutorClassOverview,
  useTutorCreateClass,
  useTutorLearners,
  useTutorLogin,
  useTutorLogout,
  useTutorRegister,
  useTutorSession,
  useTutorSummary,
  useUploadTutorCurriculum,
  type FamilyClass,
  type FamilyCredentials,
  type FamilyLearner,
} from '@/lib/family-api';
import { usePresetCurricula, type ClassLearnerRow, type ClassMode } from '@/lib/tis-api';

const SUBJECTS = ['Mathematics', 'English', 'Natural Sciences', 'Physical Sciences', 'Life Sciences', 'Social Sciences', 'Accounting', 'Technology', 'Life Orientation'];

// Class creation is gated on a hardwired preset curriculum; learner subject
// chips may stay free-form for programme notes but class subjects must match.
const STADIO_GRADE = 13;

function presetLabel(entry: { subject: string; gradeMin: number; gradeMax: number }) {
  if (entry.gradeMin === STADIO_GRADE) return `${entry.subject} (Stadio)`;
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
  return { options, entries, loading: presets.isLoading, first: options[0]?.value ?? '' };
}
const GRADES = [...Array.from({ length: 12 }, (_, index) => index + 1), STADIO_GRADE];
const gradeLabel = (grade: number) => (grade === STADIO_GRADE ? 'Stadio' : `Grade ${grade}`);
const NAV = [
  { href: '/tutor', label: 'Class view', icon: Users },
  { href: '/tutor/classes', label: 'Classes & programme', icon: LayoutGrid },
  { href: '/tutor/learners', label: 'My learners', icon: BookOpen },
];
const STORAGE_KEY = 'slate-tutor-class';

function cn(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(' ');
}

function formatDate(value: string | null, withTime = false) {
  if (!value) return 'No activity yet';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Not available';
  return new Intl.DateTimeFormat('en-ZA', { day: 'numeric', month: 'short', ...(withTime ? { hour: 'numeric', minute: '2-digit' } : {}) }).format(date);
}

function errorText(error: unknown) {
  if (error instanceof Error && error.message) return error.message;
  return 'Something went wrong. Please try again.';
}

function TutorButton({ children, className, variant = 'primary', ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'ghost' | 'secondary' }) {
  return (
    <button
      {...props}
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold transition-transform active:scale-[.98] disabled:cursor-not-allowed disabled:opacity-50',
        variant === 'primary' && 'bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] shadow-sm hover:-translate-y-0.5',
        variant === 'secondary' && 'border border-[hsl(var(--border))] bg-[hsl(var(--card))] hover:border-[hsl(var(--accent))]',
        variant === 'ghost' && 'text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))]',
        className,
      )}
    >
      {children}
    </button>
  );
}

function TutorField({ label, value, onChange, testId, type = 'text', ...props }: { label: string; value: string; onChange: (value: string) => void; testId: string; type?: string } & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'>) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-bold text-[hsl(var(--muted-foreground))]">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        data-testid={testId}
        className="w-full rounded-xl border border-[hsl(var(--input))] bg-[hsl(var(--background)/.55)] px-3.5 py-3 text-sm outline-none focus:border-[hsl(var(--accent))]"
        {...props}
      />
    </label>
  );
}

export function TutorLoginLink() {
  return <Link href="/tutor/login" data-testid="link-tutor-login-home" className="inline-flex items-center gap-2 rounded-xl px-3 py-2.5 text-sm font-bold text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))]"><Zap size={16} />Tutor</Link>;
}

export function TutorAuth({ mode }: { mode: 'login' | 'register' }) {
  const isRegister = mode === 'register';
  const [, setLocation] = useLocation();
  const register = useTutorRegister();
  const login = useTutorLogin();
  const [form, setForm] = useState({ fullName: '', email: '', password: '', confirm: '' });
  const [error, setError] = useState('');
  const submit = (event: FormEvent) => {
    event.preventDefault();
    setError('');
    if (isRegister && form.password !== form.confirm) {
      setError('Those passwords do not match.');
      return;
    }
    const onSuccess = () => setLocation('/tutor');
    const onError = (mutationError: unknown) => setError(errorText(mutationError));
    if (isRegister) {
      register.mutate({ fullName: form.fullName, email: form.email, password: form.password }, { onSuccess, onError });
    } else {
      login.mutate({ email: form.email, password: form.password }, { onSuccess, onError });
    }
  };
  const pending = register.isPending || login.isPending;
  return (
    <div className="grain flex min-h-[100dvh] items-center justify-center bg-[hsl(var(--background))] px-5 py-10">
      <form onSubmit={submit} className="w-full max-w-md rounded-[2rem] border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-8 shadow-xl">
        <div className="mb-8 flex items-center gap-3">
          <span className="grid size-11 place-items-center rounded-2xl bg-[hsl(var(--accent))] text-[hsl(var(--accent-foreground))]"><Zap size={21} /></span>
          <div>
            <h1 className="display-face text-xl font-bold tracking-tight">{isRegister ? 'Create your tutor account' : 'Tutor sign in'}</h1>
            <p className="text-xs text-[hsl(var(--muted-foreground))]">{isRegister ? 'Deliver your own programme with AI questions and marking.' : 'Welcome back to your tutoring space.'}</p>
          </div>
        </div>
        <div className="space-y-4">
          {isRegister && <TutorField label="Your full name" value={form.fullName} onChange={(value) => setForm({ ...form, fullName: value })} testId="input-tutor-name" required />}
          <TutorField label="Email address" type="email" value={form.email} onChange={(value) => setForm({ ...form, email: value })} testId="input-tutor-email" required />
          <TutorField label={isRegister ? 'Password (8+ characters)' : 'Password'} type="password" value={form.password} onChange={(value) => setForm({ ...form, password: value })} testId="input-tutor-password" minLength={isRegister ? 8 : 1} required />
          {isRegister && <TutorField label="Confirm password" type="password" value={form.confirm} onChange={(value) => setForm({ ...form, confirm: value })} testId="input-tutor-confirm" minLength={8} required />}
        </div>
        {error && <p data-testid="status-tutor-auth-error" className="mt-4 text-xs font-semibold text-[#93473a]">{error}</p>}
        <TutorButton type="submit" disabled={pending} data-testid="button-tutor-submit" className="mt-6 w-full">{pending ? <Loader2 size={15} className="animate-spin" /> : null}{isRegister ? 'Create tutor account' : 'Sign in'}</TutorButton>
        <p className="mt-5 text-center text-xs text-[hsl(var(--muted-foreground))]">
          {isRegister ? 'Already have a tutor account?' : 'New here as a tutor?'}{' '}
          <Link href={isRegister ? '/tutor/login' : '/tutor/register'} data-testid="link-tutor-auth-switch" className="font-bold text-[hsl(var(--accent-foreground))]">{isRegister ? 'Sign in' : 'Create one'}</Link>
        </p>
        <p className="mt-3 text-center text-[11px] text-[hsl(var(--muted-foreground))]"><Link href="/" data-testid="link-tutor-home" className="underline underline-offset-2">Back to SLATE home</Link></p>
      </form>
    </div>
  );
}

export function TutorLayout({ children }: { children: ReactNode }) {
  const [location, setLocation] = useLocation();
  const session = useTutorSession();
  const logout = useTutorLogout();
  const tutor = session.data?.tutor ?? null;
  useEffect(() => { if (!session.isLoading && !tutor) setLocation('/tutor/login'); }, [session.isLoading, tutor, setLocation]);
  if (session.isLoading) {
    return <div className="grain flex min-h-[100dvh] items-center justify-center bg-[hsl(var(--background))]"><Loader2 size={22} className="animate-spin text-[hsl(var(--accent-foreground))]" /></div>;
  }
  if (!tutor) return null;
  return (
    <div className="grain min-h-[100dvh] bg-[hsl(var(--background))]">
      <header className="bg-[hsl(var(--sidebar))]">
        <div className="mx-auto flex max-w-[1280px] flex-wrap items-center justify-between gap-3 px-5 py-4 sm:px-8">
          <Link href="/tutor" data-testid="link-tutor-home-mark" className="flex items-center gap-3">
            <span className="grid size-9 place-items-center rounded-[11px] bg-[hsl(var(--accent))] text-[hsl(var(--accent-foreground))]"><Zap size={18} /></span>
            <span>
              <span className="display-face block text-base font-bold leading-tight text-[hsl(var(--sidebar-foreground))]">SLATE <span className="text-[hsl(var(--accent))]">Tutor</span></span>
              <span className="block text-[11px] text-[hsl(var(--sidebar-foreground)/.6)]">Your programme, delivered by Slate</span>
            </span>
          </Link>
          <div className="flex items-center gap-3">
            <div className="text-right">
              <p data-testid="text-tutor-name" className="text-sm font-bold text-[hsl(var(--sidebar-foreground))]">{tutor.fullName}</p>
              <p className="text-[11px] text-[hsl(var(--sidebar-foreground)/.6)]">{tutor.email}</p>
            </div>
            <button onClick={() => logout.mutate(undefined, { onSuccess: () => setLocation('/tutor/login') })} data-testid="button-tutor-logout" className="inline-flex items-center gap-2 rounded-xl px-3 py-2.5 text-sm font-bold text-[hsl(var(--sidebar-foreground)/.7)] hover:bg-[hsl(var(--sidebar-accent))]"><LogOut size={16} />Sign out</button>
          </div>
        </div>
        <div className="mx-auto max-w-[1280px] overflow-x-auto px-5 sm:px-8">
          <nav className="flex gap-1 pb-1">
            {NAV.map(({ href, label, icon: Icon }) => {
              const active = href === '/tutor' ? location === '/tutor' : location.startsWith(href);
              return (
                <Link
                  key={href}
                  href={href}
                  data-testid={`link-tutor-nav-${label.toLowerCase().replaceAll(' ', '-')}`}
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
  );
}

function LearnerFlag({ learner }: { learner: ClassLearnerRow }) {
  if (learner.flags.includes('MISSED_WORK')) return <span className="rounded-full bg-[#f8dcd6] px-2.5 py-1 text-[11px] font-bold text-[#93473a]"><AlertTriangle size={11} className="mr-1 inline" />Missed work</span>;
  if (learner.flags.includes('LOW_AVERAGE')) return <span className="rounded-full bg-[#f7e8be] px-2.5 py-1 text-[11px] font-bold text-[#74551f]"><TrendingUp size={11} className="mr-1 inline" />Low average</span>;
  return <span className="rounded-full bg-[hsl(var(--secondary))] px-2.5 py-1 text-[11px] font-bold text-[hsl(var(--secondary-foreground))]">On track</span>;
}

export function TutorClassView() {
  const session = useTutorSession();
  const [activeClassId, setActiveClassId] = useState<string | null>(() => window.localStorage.getItem(STORAGE_KEY));
  const classes = session.data?.classes ?? [];
  const activeClass = useMemo(() => classes.find((entry) => entry.id === activeClassId) ?? classes[0] ?? null, [classes, activeClassId]);
  const overview = useTutorClassOverview(activeClass?.id ?? null);
  const summary = useTutorSummary();
  if (!classes.length) {
    return (
      <div className="rounded-[1.75rem] border border-dashed border-[hsl(var(--border))] p-10 text-center">
        <p className="text-sm font-bold">No classes yet.</p>
        <p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">Create a class on the "Classes & programme" tab, then add your learners.</p>
        <Link href="/tutor/classes" data-testid="link-tutor-first-class"><TutorButton className="mt-4"><Plus size={15} />Create a class</TutorButton></Link>
      </div>
    );
  }
  const data = overview.data;
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="mono-face text-[11px] uppercase tracking-[.2em] text-[hsl(var(--accent-foreground)/.75)]">Tutor dashboard</p>
          <h1 className="display-face mt-2 text-3xl font-bold tracking-[-.04em]">{activeClass?.label ?? 'Class view'}</h1>
          <p className="mt-2 text-sm text-[hsl(var(--muted-foreground))]">All your learners in this class, live from their ALIS submissions.</p>
        </div>
        <select
          value={activeClass?.id ?? ''}
          onChange={(event) => { setActiveClassId(event.target.value); window.localStorage.setItem(STORAGE_KEY, event.target.value); }}
          data-testid="select-tutor-class"
          className="rounded-xl border border-[hsl(var(--input))] bg-[hsl(var(--background)/.55)] px-3.5 py-3 text-sm font-bold outline-none focus:border-[hsl(var(--accent))]"
        >
          {classes.map((entry) => <option key={entry.id} value={entry.id}>{entry.label} — {entry.mode === 'INDEPENDENT' ? 'Independent' : 'Teacher-dependent'}</option>)}
        </select>
      </div>

      {overview.isLoading ? (
        <div className="flex min-h-[30vh] items-center justify-center"><Loader2 size={22} className="animate-spin text-[hsl(var(--accent-foreground))]" /></div>
      ) : overview.isError || !data ? (
        <p data-testid="status-tutor-overview-error" className="rounded-2xl border border-[#dfa79b] bg-[#fff4f1] p-5 text-sm font-semibold text-[#93473a]">{errorText(overview.error)}</p>
      ) : (
        <div className="space-y-6">
          {summary.data?.classes?.length ? (
            <div className="grid gap-4 md:grid-cols-3">
              <div className="rounded-[1.75rem] border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5">
                <p className="text-xs font-bold text-[hsl(var(--muted-foreground))]">Class average</p>
                <p data-testid="text-tutor-class-average" className="mono-face mt-2 text-3xl">{data.performance.classAverage}%</p>
                <p className="mt-1 text-[11px] text-[hsl(var(--muted-foreground))]">{data.performance.trend === 'IMPROVING' ? 'Improving' : data.performance.trend === 'DECLINING' ? 'Declining' : data.performance.trend === 'STAGNATING' ? 'Stagnating' : 'Not enough data yet'}</p>
              </div>
              <div className="rounded-[1.75rem] border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5">
                <p className="text-xs font-bold text-[hsl(var(--muted-foreground))]">Learners</p>
                <p className="mono-face mt-2 text-3xl">{data.class.learnerCount}</p>
                <p className="mt-1 text-[11px] text-[hsl(var(--muted-foreground))]">enrolled in this class</p>
              </div>
              <div className="rounded-[1.75rem] border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5">
                <p className="text-xs font-bold text-[hsl(var(--muted-foreground))]">Mode</p>
                <p className={cn('mt-2 text-lg font-bold', data.class.mode === 'INDEPENDENT' ? 'text-[#1d6b3c]' : 'text-[#1e4e8c]')}>{data.class.mode === 'INDEPENDENT' ? 'Independent' : 'Teacher-dependent'}</p>
                <p className="mt-1 text-[11px] text-[hsl(var(--muted-foreground))]">{data.class.mode === 'INDEPENDENT' ? 'Slate delivers your programme automatically' : 'You drive the assignments'}</p>
              </div>
            </div>
          ) : null}

          {data.gapAlert && (
            <div data-testid="alert-tutor-gap" className="rounded-2xl border border-[#dfa79b] bg-[#fff4f1] p-4 text-sm font-semibold text-[#93473a]">{data.gapAlert.message}</div>
          )}

          <section className="rounded-[1.75rem] border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5 sm:p-7">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="mono-face text-[10px] uppercase tracking-[.16em] text-[hsl(var(--muted-foreground))]">Class view</p>
                <h2 className="mt-1 text-xl font-bold">Your learners in this class</h2>
              </div>
              <Users size={20} className="text-[hsl(var(--accent-foreground))]" />
            </div>
            {!data.learners.length ? (
              <p className="mt-5 text-sm text-[hsl(var(--muted-foreground))]">No learners yet — add them from the "My learners" tab.</p>
            ) : (
              <div className="mt-5 space-y-3">
                {data.learners.map((learner) => (
                  <div key={learner.id} data-testid={`row-tutor-learner-${learner.id}`} className={cn('rounded-2xl border p-4', learner.flags.includes('MISSED_WORK') ? 'border-[#dfa79b] bg-[#fff4f1]' : learner.flags.includes('LOW_AVERAGE') ? 'border-[#e3cb8e] bg-[#fffaee]' : 'border-[hsl(var(--border))] bg-[hsl(var(--background)/.4)]')}>
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
                  </div>
                ))}
              </div>
            )}
          </section>

          <div className="grid gap-5 lg:grid-cols-2">
            <section className="rounded-[1.75rem] border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5 sm:p-7">
              <div className="flex items-center justify-between"><div><p className="mono-face text-[10px] uppercase tracking-[.16em] text-[hsl(var(--muted-foreground))]">Live progress</p><h2 className="mt-1 text-xl font-bold">Assignments</h2></div><ClipboardList size={20} className="text-[hsl(var(--accent-foreground))]" /></div>
              {!data.assignments.length ? <p className="mt-5 text-sm text-[hsl(var(--muted-foreground))]">No assignments yet. In Independent mode Slate will start generating them once learners have joined.</p> : (
                <div className="mt-5 space-y-3">
                  {data.assignments.map((assignment) => (
                    <div key={assignment.id} data-testid={`row-tutor-assignment-${assignment.id}`} className="rounded-2xl border border-[hsl(var(--border))] p-4">
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
              <div className="flex items-center justify-between"><div><p className="mono-face text-[10px] uppercase tracking-[.16em] text-[hsl(var(--muted-foreground))]">Measured from submissions</p><h2 className="mt-1 text-xl font-bold">Concept gaps</h2></div><TrendingUp size={20} className="text-[hsl(var(--accent-foreground))]" /></div>
              {!data.conceptGaps.length ? <p className="mt-5 text-sm text-[hsl(var(--muted-foreground))]">Gaps appear here once learners start submitting.</p> : (
                <div className="mt-5 space-y-3">
                  {data.conceptGaps.map((gap) => (
                    <div key={gap.concept} data-testid={`row-tutor-gap-${gap.concept}`}>
                      <div className="flex justify-between text-xs"><span className="font-bold">{gap.concept}</span><span className="mono-face text-[hsl(var(--muted-foreground))]">{gap.strugglingPercentage}% struggling · avg {gap.averageScore}%</span></div>
                      <div className="mt-2 h-2 overflow-hidden rounded-full bg-[hsl(var(--muted))]"><div className={cn('h-full rounded-full', gap.strugglingPercentage >= 50 ? 'bg-[hsl(var(--destructive))]' : 'bg-[hsl(var(--accent))]')} style={{ width: `${gap.strugglingPercentage}%` }} /></div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        </div>
      )}
    </div>
  );
}

function TutorClassCard({ entry }: { entry: FamilyClass }) {
  const setMode = useSetTutorClassMode();
  const upload = useUploadTutorCurriculum();
  const [showUpload, setShowUpload] = useState(false);
  const [sequence, setSequence] = useState<string[]>([]);
  const select = (mode: ClassMode) => {
    setMode.mutate({ classId: entry.id, mode });
    if (mode === 'INDEPENDENT') setShowUpload(true);
  };
  return (
    <div data-testid={`card-tutor-class-${entry.id}`} className="rounded-[1.75rem] border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-bold">{entry.label}</p>
          <p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">{entry.learnerCount} learners · {entry.assignmentWindowDays}-day windows</p>
        </div>
        <span className={cn('rounded-full px-2.5 py-1 text-[11px] font-bold', entry.mode === 'INDEPENDENT' ? 'bg-[#d9efe0] text-[#1d6b3c]' : 'bg-[#dbe7f6] text-[#1e4e8c]')} data-testid={`badge-tutor-mode-${entry.id}`}>{entry.mode === 'INDEPENDENT' ? 'Independent' : 'Teacher-dependent'}</span>
      </div>
      <div className="mt-4">
        <p className="mb-2 text-[11px] font-bold uppercase tracking-[.08em] text-[hsl(var(--muted-foreground))]">Operating mode</p>
        <ClassModeToggle mode={entry.mode} pending={setMode.isPending} onSelect={select} testIdPrefix={`tutor-class-${entry.id}`} />
      </div>
      <div className="mt-4">
        <p className="mb-2 text-[11px] font-bold uppercase tracking-[.08em] text-[hsl(var(--muted-foreground))]">Your programme</p>
        {!showUpload && entry.hasCurriculum ? (
          <button type="button" onClick={() => setShowUpload(true)} data-testid={`button-tutor-programme-${entry.id}`} className="text-[11px] font-bold text-[hsl(var(--accent-foreground))] underline underline-offset-2">
            Replace programme ({entry.curriculumFileName ?? 'uploaded'} · {entry.lessonSequence.length} topics)
          </button>
        ) : null}
        {(showUpload || !entry.hasCurriculum) && (
          <CurriculumUpload
            pending={upload.isPending}
            error={upload.isError ? errorText(upload.error) : ''}
            sequence={sequence.length ? sequence : entry.lessonSequence}
            currentFileName={entry.curriculumFileName}
            testIdPrefix={`tutor-class-${entry.id}`}
            onUpload={(payload) => upload.mutate({ classId: entry.id, ...payload }, { onSuccess: (data) => { setSequence(data.lessonSequence); setShowUpload(false); } })}
          />
        )}
      </div>
    </div>
  );
}

export function TutorClasses() {
  const session = useTutorSession();
  const createClass = useTutorCreateClass();
  const presetOptions = usePresetSubjectOptions();
  const [form, setForm] = useState({ grade: '5', section: '', subject: presetOptions.first, windowDays: '7' });
  const [error, setError] = useState('');
  const classes = session.data?.classes ?? [];
  const add = (event: FormEvent) => {
    event.preventDefault();
    setError('');
    createClass.mutate({ grade: Number(form.grade), section: form.section, subject: form.subject, assignmentWindowDays: Number(form.windowDays) }, {
      onSuccess: () => setForm({ grade: '5', section: '', subject: presetOptions.first, windowDays: '7' }),
      onError: (mutationError) => setError(errorText(mutationError)),
    });
  };
  return (
    <div className="space-y-6">
      <div>
        <p className="mono-face text-[11px] uppercase tracking-[.2em] text-[hsl(var(--accent-foreground)/.75)]">Tutor · Classes</p>
        <h1 className="display-face mt-2 text-3xl font-bold tracking-[-.04em]">Classes & programme</h1>
        <p className="mt-2 text-sm text-[hsl(var(--muted-foreground))]">Upload your own programme per class — Slate delivers it with AI questions and marking, in your order.</p>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {classes.map((entry) => <TutorClassCard key={entry.id} entry={entry} />)}
      </div>
      <form onSubmit={add} className="rounded-[1.75rem] border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5 sm:p-7">
        <h2 className="text-lg font-bold">Add a class</h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-[120px_120px_1fr_160px_auto] sm:items-end">
          <label className="block">
            <span className="mb-1.5 block text-xs font-bold text-[hsl(var(--muted-foreground))]">Grade</span>
            <select value={form.grade} onChange={(event) => { const options = presetOptionsFor(presetOptions.entries, event.target.value); setForm({ ...form, grade: event.target.value, subject: options[0]?.value ?? '' }); }} data-testid="select-tutor-class-grade" className="w-full rounded-xl border border-[hsl(var(--input))] bg-[hsl(var(--background)/.55)] px-3.5 py-3 text-sm outline-none focus:border-[hsl(var(--accent))]">
              {GRADES.map((grade) => <option key={grade} value={grade}>{gradeLabel(grade)}</option>)}
            </select>
          </label>
          <TutorField label="Section (optional)" value={form.section} onChange={(value) => setForm({ ...form, section: value })} testId="input-tutor-class-section" placeholder="A" maxLength={3} />
          <label className="block">
            <span className="mb-1.5 block text-xs font-bold text-[hsl(var(--muted-foreground))]">Subject</span>
            <select value={form.subject} onChange={(event) => setForm({ ...form, subject: event.target.value })} data-testid="select-tutor-class-subject" className="w-full rounded-xl border border-[hsl(var(--input))] bg-[hsl(var(--background)/.55)] px-3.5 py-3 text-sm outline-none focus:border-[hsl(var(--accent))]">
              {presetOptionsFor(presetOptions.entries, form.grade).map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs font-bold text-[hsl(var(--muted-foreground))]">Window</span>
            <select value={form.windowDays} onChange={(event) => setForm({ ...form, windowDays: event.target.value })} data-testid="select-tutor-class-window" className="w-full rounded-xl border border-[hsl(var(--input))] bg-[hsl(var(--background)/.55)] px-3.5 py-3 text-sm outline-none focus:border-[hsl(var(--accent))]">
              {[3, 5, 7, 10, 14, 21, 30].map((days) => <option key={days} value={days}>{days} days</option>)}
            </select>
          </label>
          <TutorButton type="submit" disabled={createClass.isPending} data-testid="button-tutor-add-class"><Plus size={15} />{createClass.isPending ? 'Adding…' : 'Add class'}</TutorButton>
        </div>
        {error && <p data-testid="status-tutor-add-class-error" className="mt-3 text-xs font-semibold text-[#93473a]">{error}</p>}
      </form>
    </div>
  );
}

export function TutorLearners() {
  const learnersQuery = useTutorLearners();
  const addLearner = useAddTutorLearner();
  const presetOptions = usePresetSubjectOptions();
  const [form, setForm] = useState({ fullName: '', grade: '5', subjects: [] as string[] });
  const [error, setError] = useState('');
  const [credentials, setCredentials] = useState<{ credentials: FamilyCredentials; name: string } | null>(null);
  const toggle = (subject: string) => {
    setForm((current) => ({ ...current, subjects: current.subjects.includes(subject) ? current.subjects.filter((entry) => entry !== subject) : [...current.subjects, subject] }));
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    setError('');
    if (!form.subjects.length) {
      setError('Choose at least one subject.');
      return;
    }
    addLearner.mutate({ fullName: form.fullName, grade: Number(form.grade), subjects: form.subjects }, {
      onSuccess: (data) => {
        setCredentials({ credentials: data.credentials, name: data.learner.fullName });
        setForm({ fullName: '', grade: '5', subjects: [] });
      },
      onError: (mutationError) => setError(errorText(mutationError)),
    });
  };
  const learners = learnersQuery.data?.learners ?? [];
  return (
    <div className="space-y-6">
      <div>
        <p className="mono-face text-[11px] uppercase tracking-[.2em] text-[hsl(var(--accent-foreground)/.75)]">Tutor · Learners</p>
        <h1 className="display-face mt-2 text-3xl font-bold tracking-[-.04em]">My learners</h1>
        <p className="mt-2 text-sm text-[hsl(var(--muted-foreground))]">Add your students — Slate creates a learner account for each and enrols them in your classes.</p>
      </div>
      {credentials && (
        <div data-testid="panel-tutor-credentials" className="rounded-2xl border border-[#b7d8c3] bg-[#edf7f0] p-5">
          <p className="text-sm font-bold text-[#1d6b3c]">Sign-in details for {credentials.name}</p>
          <p className="mt-1 text-xs text-[#2b5e40]">Share these with your learner so they can sign in on the learner app. Shown once.</p>
          <div className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
            <div className="rounded-xl bg-white/70 p-3"><p className="text-[#2b5e40]">Username</p><p data-testid="text-tutor-learner-username" className="mono-face mt-1 text-sm font-medium">{credentials.credentials.username}</p></div>
            <div className="rounded-xl bg-white/70 p-3"><p className="text-[#2b5e40]">Password</p><p data-testid="text-tutor-learner-password" className="mono-face mt-1 text-sm font-medium">{credentials.credentials.password}</p></div>
          </div>
        </div>
      )}
      <form onSubmit={submit} className="rounded-[1.75rem] border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-6 sm:p-8">
        <div className="flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-2xl bg-[hsl(var(--accent))] text-[hsl(var(--accent-foreground))]"><Plus size={18} /></span>
          <div>
            <h2 className="text-lg font-bold">Add a learner</h2>
            <p className="text-xs text-[hsl(var(--muted-foreground))]">Their account is created instantly and enrolled in your matching classes.</p>
          </div>
        </div>
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <TutorField label="Learner's full name" value={form.fullName} onChange={(value) => setForm({ ...form, fullName: value })} testId="input-tutor-learner-name" required />
          <label className="block">
            <span className="mb-1.5 block text-xs font-bold text-[hsl(var(--muted-foreground))]">Grade</span>
            <select value={form.grade} onChange={(event) => setForm({ ...form, grade: event.target.value })} data-testid="select-tutor-learner-grade" className="w-full rounded-xl border border-[hsl(var(--input))] bg-[hsl(var(--background)/.55)] px-3.5 py-3 text-sm outline-none focus:border-[hsl(var(--accent))]">
              {GRADES.map((grade) => <option key={grade} value={grade}>{gradeLabel(grade)}</option>)}
            </select>
          </label>
        </div>
        <div className="mt-4">
          <p className="mb-2 text-xs font-bold text-[hsl(var(--muted-foreground))]">Subjects</p>
          <div className="flex flex-wrap gap-2">
            {presetOptionsFor(presetOptions.entries, form.grade).map((option) => (
              <button
                type="button"
                key={option.value}
                onClick={() => toggle(option.value)}
                data-testid={`button-tutor-subject-${option.value.toLowerCase().replaceAll(/[\s—]/g, '-')}`}
                className={cn('rounded-full border px-3 py-2 text-xs font-bold', form.subjects.includes(option.value) ? 'border-[hsl(var(--accent))] bg-[hsl(var(--accent))]' : 'border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))]')}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
        {error && <p data-testid="status-add-tutor-learner-error" className="mt-4 text-xs font-semibold text-[#93473a]">{error}</p>}
        <TutorButton type="submit" disabled={addLearner.isPending} data-testid="button-add-tutor-learner" className="mt-5"><Plus size={15} />{addLearner.isPending ? 'Adding…' : 'Add learner'}</TutorButton>
      </form>
      <section className="rounded-[1.75rem] border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-6 sm:p-8">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold">Your learner profiles</h2>
          <Users size={18} className="text-[hsl(var(--accent-foreground))]" />
        </div>
        {learnersQuery.isLoading ? (
          <div className="mt-6 flex justify-center"><Loader2 size={20} className="animate-spin text-[hsl(var(--accent-foreground))]" /></div>
        ) : !learners.length ? (
          <p className="mt-4 text-sm text-[hsl(var(--muted-foreground))]">No learners yet. Add your first student above.</p>
        ) : (
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            {learners.map((learner: FamilyLearner) => (
              <div key={learner.id} data-testid={`row-tutor-learner-profile-${learner.id}`} className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--background)/.4)] p-4">
                <p className="font-bold">{learner.fullName}</p>
                <p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">Grade {learner.grade} · @{learner.username}</p>
                <p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">{learner.subjects.join(', ') || 'No subjects'}</p>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
