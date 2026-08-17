import { type FormEvent, type ReactNode, useEffect, useMemo, useState } from 'react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import {
  Activity,
  ArrowLeft,
  ArrowRight,
  BarChart3,
  BookOpen,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleHelp,
  Clock3,
  Compass,
  DoorOpen,
  FileQuestion,
  Flame,
  GraduationCap,
  HeartPulse,
  Info,
  Layers3,
  LockKeyhole,
  LogOut,
  Menu,
  PenLine,
  Play,
  RotateCcw,
  Save,
  Send,
  Sparkles,
  Target,
  Timer,
  TrendingUp,
  UserRound,
  X,
  XCircle,
} from 'lucide-react';
import {
  AssignmentStatus,
  getGetAssignmentQueryKey,
  getGetCurrentLearnerQueryKey,
  getGetDashboardSummaryQueryKey,
  getGetLearningProfileQueryKey,
  getGetRecentLearningActivityQueryKey,
  getListAssignmentsQueryKey,
  useGetAssignment,
  useGetCurrentLearner,
  useGetDashboardSummary,
  useGetLearningProfile,
  useGetRecentLearningActivity,
  useHealthCheck,
  useListAssignments,
  useLoginLearner,
  useLogoutLearner,
  useOpenAssignment,
  useRegisterLearner,
  useRespondToRemediation,
  useSubmitAssignment,
  useUpdateLearnerProfile,
} from '@workspace/api-client-react';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import { Route, Switch, Link, Router as WouterRouter, useLocation, useParams } from 'wouter';

const queryClient = new QueryClient();
const subjects = ['English', 'Mathematics', 'Natural Sciences', 'Social Sciences', 'Technology', 'Life Orientation', 'Accounting'];
const navItems = [
  { href: '/dashboard', label: 'Today', icon: Compass },
  { href: '/assignments', label: 'Assignments', icon: BookOpen },
  { href: '/profile', label: 'My profile', icon: UserRound },
];

function cn(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(' ');
}

function formatDate(value: string, withTime = false) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Not available';
  return new Intl.DateTimeFormat('en-ZA', { day: 'numeric', month: 'short', ...(withTime ? { hour: 'numeric', minute: '2-digit' } : {}) }).format(date);
}

function errorText(error: unknown) {
  if (error && typeof error === 'object' && 'error' in error) return String((error as { error: unknown }).error);
  return 'Something went wrong. Please try again.';
}

function Button({ children, className, variant = 'primary', ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost' | 'danger' }) {
  return (
    <button
      {...props}
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold transition-transform duration-200 active:scale-[.98] disabled:cursor-not-allowed disabled:opacity-50',
        variant === 'primary' && 'bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] shadow-sm hover:-translate-y-0.5 hover:shadow-md',
        variant === 'secondary' && 'border border-[hsl(var(--border))] bg-[hsl(var(--card))] text-[hsl(var(--foreground))] hover:-translate-y-0.5 hover:border-[hsl(var(--accent))]',
        variant === 'ghost' && 'text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))]',
        variant === 'danger' && 'bg-[hsl(var(--destructive))] text-[hsl(var(--destructive-foreground))]',
        className,
      )}
    >
      {children}
    </button>
  );
}

function StatusPill({ status }: { status: string }) {
  const config: Record<string, { label: string; className: string; icon: typeof Check }> = {
    LOCKED: { label: 'Locked', className: 'bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))]', icon: LockKeyhole },
    OPEN: { label: 'Open now', className: 'bg-[hsl(var(--secondary))] text-[hsl(var(--secondary-foreground))]', icon: Play },
    CLOSED: { label: 'Closed', className: 'bg-[#f8e2dd] text-[#93473a]', icon: XCircle },
    SUBMITTED: { label: 'Submitted', className: 'bg-[#e5def0] text-[#604c78]', icon: CheckCircle2 },
    MISSED: { label: 'Missed', className: 'bg-[#f5ddd0] text-[#914d31]', icon: Clock3 },
  };
  const item = config[status] ?? config.LOCKED;
  const Icon = item.icon;
  return <span data-testid={`status-assignment-${status.toLowerCase()}`} className={cn('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-[.08em]', item.className)}><Icon size={13} />{item.label}</span>;
}

function Logo() {
  return <Link href="/" data-testid="link-home" className="flex items-center gap-2.5"><span className="grid size-9 place-items-center rounded-[11px] bg-[hsl(var(--accent))] text-[hsl(var(--accent-foreground))] shadow-sm"><Layers3 size={19} strokeWidth={2.6} /></span><span className="display-face text-lg font-bold tracking-tight">SLATE <span className="text-[hsl(var(--accent))]">ALIS</span></span></Link>;
}

function AppShell({ children, learner }: { children: ReactNode; learner?: { fullName: string; grade: number; schoolName: string } }) {
  const [, setLocation] = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const logout = useLogoutLearner();
  const client = useQueryClient();
  const initials = learner?.fullName?.split(' ').map((word) => word[0]).slice(0, 2).join('').toUpperCase() || 'SL';
  const handleLogout = () => logout.mutate(undefined, { onSuccess: () => { client.clear(); setLocation('/'); } });
  return (
    <div className="grain min-h-[100dvh] bg-[hsl(var(--background))] text-[hsl(var(--foreground))]">
      <header className="sticky top-0 z-10 flex h-[72px] items-center justify-between border-b border-[hsl(var(--border))] bg-[hsl(var(--background)/.9)] px-5 backdrop-blur-md lg:hidden">
        <Logo /><Button variant="ghost" className="px-2" onClick={() => setMobileOpen(!mobileOpen)} data-testid="button-menu"><Menu size={22} /></Button>
      </header>
      <aside className={cn('fixed inset-y-0 left-0 z-20 flex w-[254px] -translate-x-full flex-col bg-[hsl(var(--sidebar))] px-5 py-6 text-[hsl(var(--sidebar-foreground))] transition-transform duration-300 lg:translate-x-0', mobileOpen && 'translate-x-0')}>
        <Logo />
        <div className="mt-14">
          <p className="mono-face mb-3 px-3 text-[10px] uppercase tracking-[.18em] text-[hsl(var(--sidebar-foreground)/.5)]">Your space</p>
          <nav className="space-y-1">
            {navItems.map(({ href, label, icon: Icon }) => <Link key={href} href={href} onClick={() => setMobileOpen(false)} data-testid={`link-nav-${label.toLowerCase().replace(' ', '-')}`} className="flex items-center gap-3 rounded-xl px-3 py-3 text-sm font-semibold text-[hsl(var(--sidebar-foreground)/.68)] transition-colors hover:bg-[hsl(var(--sidebar-accent))] hover:text-[hsl(var(--sidebar-foreground))]"><Icon size={18} />{label}</Link>)}
          </nav>
        </div>
        <div className="mt-auto">
          <div className="mb-4 rounded-2xl border border-[hsl(var(--sidebar-border))] bg-[hsl(var(--sidebar-accent)/.7)] p-4">
            <div className="mb-3 flex size-8 items-center justify-center rounded-full bg-[hsl(var(--accent))] text-xs font-black text-[hsl(var(--accent-foreground))]">{initials}</div>
            <p data-testid="text-sidebar-name" className="truncate text-sm font-bold">{learner?.fullName || 'Your learning space'}</p>
            <p className="mt-1 text-xs text-[hsl(var(--sidebar-foreground)/.55)]">{learner ? `Grade ${learner.grade} · ${learner.schoolName}` : 'Keep moving forward'}</p>
          </div>
          <button onClick={handleLogout} disabled={logout.isPending} data-testid="button-logout" className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-sm font-semibold text-[hsl(var(--sidebar-foreground)/.58)] hover:bg-[hsl(var(--sidebar-accent))] hover:text-[hsl(var(--sidebar-foreground))]"><LogOut size={17} />{logout.isPending ? 'Signing out…' : 'Sign out'}</button>
        </div>
      </aside>
      <main className="min-h-[100dvh] lg:ml-[254px]">
        <div className="mx-auto max-w-[1260px] px-5 py-8 sm:px-8 lg:px-12 lg:py-11">{children}</div>
      </main>
    </div>
  );
}

function LoadingState({ label = 'Finding your next step…' }: { label?: string }) {
  return <div className="space-y-5"><div className="h-7 w-44 animate-pulse rounded-lg bg-[hsl(var(--muted))]" /><div className="grid gap-4 md:grid-cols-3"><div className="h-32 animate-pulse rounded-3xl bg-[hsl(var(--muted))]" /><div className="h-32 animate-pulse rounded-3xl bg-[hsl(var(--muted))]" /><div className="h-32 animate-pulse rounded-3xl bg-[hsl(var(--muted))]" /></div><p className="mono-face text-xs text-[hsl(var(--muted-foreground))]">{label}</p></div>;
}

function ErrorState({ message, retry }: { message?: string; retry?: () => void }) {
  return <div className="rounded-3xl border border-[#e7beb4] bg-[#fff4f1] p-7"><div className="mb-3 flex size-10 items-center justify-center rounded-xl bg-[#f5d7d1] text-[#994738]"><HeartPulse size={20} /></div><h2 className="display-face text-xl font-bold">We lost the thread.</h2><p className="mt-2 max-w-md text-sm leading-6 text-[#7d5148]">{message || 'Your learning data could not be loaded right now.'}</p>{retry && <Button variant="secondary" onClick={retry} data-testid="button-retry" className="mt-5 border-[#e7beb4] bg-transparent text-[#7d5148]"><RotateCcw size={15} />Try again</Button>}</div>;
}

function PageIntro({ eyebrow, title, detail, action }: { eyebrow: string; title: string; detail?: string; action?: ReactNode }) {
  return <div className="mb-9 flex flex-col justify-between gap-5 md:flex-row md:items-end"><div><p className="mono-face mb-3 text-[11px] font-medium uppercase tracking-[.2em] text-[hsl(var(--accent-foreground)/.7)]">{eyebrow}</p><h1 data-testid="text-page-title" className="display-face text-4xl font-bold tracking-[-.04em] text-[hsl(var(--foreground))] sm:text-5xl">{title}</h1>{detail && <p className="mt-3 max-w-xl text-sm leading-6 text-[hsl(var(--muted-foreground))]">{detail}</p>}</div>{action}</div>;
}

function PublicShell({ children }: { children: ReactNode }) {
  return <div className="grain min-h-[100dvh] bg-[hsl(var(--background))]"><header className="mx-auto flex max-w-7xl items-center justify-between px-5 py-6 sm:px-8"><Logo /><div className="flex items-center gap-2"><Link href="/login" data-testid="link-login-header" className="rounded-xl px-4 py-2.5 text-sm font-bold text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))]">Log in</Link><Link href="/register" data-testid="link-register-header" className="rounded-xl bg-[hsl(var(--primary))] px-4 py-2.5 text-sm font-bold text-[hsl(var(--primary-foreground))] shadow-sm hover:-translate-y-0.5">Create account</Link></div></header>{children}</div>;
}

function Home() {
  const [, setLocation] = useLocation();
  const current = useGetCurrentLearner({ query: { queryKey: getGetCurrentLearnerQueryKey(), retry: false } });
  useEffect(() => { if (current.data?.learner) setLocation('/dashboard'); }, [current.data, setLocation]);
  if (current.isLoading) return <PublicShell><div className="mx-auto flex min-h-[70vh] max-w-7xl items-center px-5"><LoadingState label="Opening your learning space…" /></div></PublicShell>;
  if (current.data?.learner) return null;
  return <PublicShell><div className="mx-auto grid max-w-7xl gap-12 px-5 pb-20 pt-14 sm:px-8 lg:grid-cols-[1.05fr_.95fr] lg:items-center lg:gap-20 lg:pt-20"><div className="rise-in"><div className="mb-7 inline-flex items-center gap-2 rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 py-1.5 text-xs font-bold text-[hsl(var(--muted-foreground))]"><span className="pulse-soft size-2 rounded-full bg-[hsl(var(--accent))]" />A clearer way to learn</div><h1 className="display-face max-w-2xl text-6xl font-bold leading-[.94] tracking-[-.07em] sm:text-7xl lg:text-[92px]">Your next<br /><span className="text-[hsl(var(--accent-foreground))]">step</span> is here.</h1><p className="mt-8 max-w-lg text-base leading-7 text-[hsl(var(--muted-foreground))]">SLATE ALIS turns schoolwork into a path you can actually see. Know what is open, understand where you are growing, and keep going with feedback made for you.</p><div className="mt-9 flex flex-wrap items-center gap-3"><Link href="/register" data-testid="link-start-learning" className="group inline-flex items-center gap-3 rounded-xl bg-[hsl(var(--primary))] px-5 py-3.5 text-sm font-bold text-[hsl(var(--primary-foreground))] shadow-md transition-transform hover:-translate-y-1">Start your learning space <ArrowRight size={17} className="transition-transform group-hover:translate-x-1" /></Link><Link href="/login" data-testid="link-existing-learner" className="inline-flex items-center gap-2 rounded-xl px-5 py-3.5 text-sm font-bold text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))]">I already have an account</Link></div></div><div className="relative rise-in delay-2"><div className="absolute -inset-8 rounded-[4rem] bg-[hsl(var(--secondary)/.55)] blur-3xl" /><div className="relative overflow-hidden rounded-[2.25rem] border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5 shadow-xl sm:p-7"><div className="flex items-center justify-between border-b border-[hsl(var(--border))] pb-5"><div><p className="mono-face text-[10px] uppercase tracking-[.16em] text-[hsl(var(--muted-foreground))]">A small win, today</p><p className="mt-1 text-sm font-bold">Your learning pulse</p></div><div className="grid size-10 place-items-center rounded-full bg-[hsl(var(--accent))]"><TrendingUp size={18} /></div></div><div className="grid grid-cols-[1fr_auto] items-end gap-4 py-8"><div><p className="display-face text-7xl font-bold tracking-[-.08em]">74<span className="text-3xl text-[hsl(var(--muted-foreground))]">%</span></p><p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">average across recent work</p></div><div className="rounded-xl bg-[hsl(var(--secondary))] px-3 py-2 text-right"><p className="mono-face text-lg font-medium text-[hsl(var(--secondary-foreground))]">6</p><p className="text-[10px] font-bold uppercase tracking-wider text-[hsl(var(--secondary-foreground)/.7)]">day streak</p></div></div><div className="space-y-3"><div className="flex items-center justify-between text-xs"><span className="font-semibold">Mathematics · Patterns</span><span className="mono-face text-[hsl(var(--muted-foreground))]">82%</span></div><div className="h-2 overflow-hidden rounded-full bg-[hsl(var(--muted))]"><div className="h-full w-[82%] rounded-full bg-[hsl(var(--accent))]" /></div><div className="flex items-center justify-between text-xs"><span className="font-semibold">Natural Sciences · Matter</span><span className="mono-face text-[hsl(var(--muted-foreground))]">61%</span></div><div className="h-2 overflow-hidden rounded-full bg-[hsl(var(--muted))]"><div className="h-full w-[61%] rounded-full bg-[hsl(var(--primary))]" /></div></div><div className="mt-8 flex items-center gap-3 rounded-2xl border border-dashed border-[hsl(var(--border))] p-3"><div className="grid size-9 place-items-center rounded-xl bg-[#f6e7c3] text-[#8a6421]"><Target size={17} /></div><div><p className="text-xs font-bold">Next focus</p><p className="text-xs text-[hsl(var(--muted-foreground))]">Fractions: equivalent parts</p></div><ChevronRight className="ml-auto text-[hsl(var(--muted-foreground))]" size={16} /></div></div></div></div><div className="mx-auto grid max-w-7xl grid-cols-1 gap-4 px-5 pb-16 sm:grid-cols-3 sm:px-8"><div className="border-t border-[hsl(var(--border))] pt-4"><p className="mono-face text-xs text-[hsl(var(--accent-foreground)/.75)]">01</p><p className="mt-3 font-bold">See the right work</p><p className="mt-1 text-sm leading-6 text-[hsl(var(--muted-foreground))]">No guessing what matters next.</p></div><div className="border-t border-[hsl(var(--border))] pt-4"><p className="mono-face text-xs text-[hsl(var(--accent-foreground)/.75)]">02</p><p className="mt-3 font-bold">Learn how you learn</p><p className="mt-1 text-sm leading-6 text-[hsl(var(--muted-foreground))]">Signals reveal the formats that help ideas stick.</p></div><div className="border-t border-[hsl(var(--border))] pt-4"><p className="mono-face text-xs text-[hsl(var(--accent-foreground)/.75)]">03</p><p className="mt-3 font-bold">Turn feedback into progress</p><p className="mt-1 text-sm leading-6 text-[hsl(var(--muted-foreground))]">Every result points somewhere useful.</p></div></div></PublicShell>;
}

function AuthPage({ mode }: { mode: 'login' | 'register' }) {
  const [, setLocation] = useLocation();
  const register = useRegisterLearner();
  const login = useLoginLearner();
  const [error, setError] = useState('');
  const [form, setForm] = useState({ username: '', password: '', fullName: '', grade: '8', schoolName: '', subjects: ['Mathematics'] });
  const isRegister = mode === 'register';
  const mutation = isRegister ? register : login;
  const update = (field: string, value: string) => setForm((prev) => ({ ...prev, [field]: value }));
  const toggleSubject = (subject: string) => setForm((prev) => ({ ...prev, subjects: prev.subjects.includes(subject) ? prev.subjects.filter((item) => item !== subject) : [...prev.subjects, subject] }));
  const submit = (event: FormEvent) => {
    event.preventDefault(); setError('');
    if (isRegister) {
      if (form.subjects.length === 0) { setError('Choose at least one subject to continue.'); return; }
      register.mutate({ data: { username: form.username, password: form.password, fullName: form.fullName, grade: Number(form.grade), schoolName: form.schoolName, subjects: form.subjects } }, { onSuccess: () => setLocation('/dashboard'), onError: (e) => setError(errorText(e)) });
    } else login.mutate({ data: { username: form.username, password: form.password } }, { onSuccess: () => setLocation('/dashboard'), onError: (e) => setError(errorText(e)) });
  };
  return <PublicShell><main className="mx-auto grid max-w-6xl gap-10 px-5 py-12 sm:px-8 lg:grid-cols-[.72fr_1fr] lg:items-center lg:py-20"><div className="hidden lg:block"><p className="mono-face text-[11px] uppercase tracking-[.2em] text-[hsl(var(--accent-foreground)/.75)]">SLATE ALIS / {isRegister ? '01' : '02'}</p><h1 className="display-face mt-5 max-w-md text-6xl font-bold leading-[.95] tracking-[-.06em]">{isRegister ? <>Make a little<br /><span className="text-[hsl(var(--accent-foreground))]">space</span> for progress.</> : <>Good to see<br /><span className="text-[hsl(var(--accent-foreground))]">you</span> again.</>}</h1><p className="mt-7 max-w-sm text-sm leading-7 text-[hsl(var(--muted-foreground))]">{isRegister ? 'A personal learning companion for the work that happens between the bell and the breakthrough.' : 'Pick up exactly where you left off. Your path is still here.'}</p></div><div className="mx-auto w-full max-w-[520px] rounded-[2rem] border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-6 shadow-lg sm:p-9"><div className="mb-8 lg:hidden"><p className="mono-face text-[11px] uppercase tracking-[.2em] text-[hsl(var(--accent-foreground)/.75)]">SLATE ALIS</p><h1 className="display-face mt-3 text-4xl font-bold tracking-[-.05em]">{isRegister ? 'Start your learning space.' : 'Welcome back.'}</h1></div><div className="mb-8 hidden items-center justify-between lg:flex"><div><p className="text-xl font-bold">{isRegister ? 'Create your account' : 'Log in to continue'}</p><p className="mt-1 text-sm text-[hsl(var(--muted-foreground))]">{isRegister ? 'Tell us a little about you.' : 'Your next step is waiting.'}</p></div><div className="grid size-11 place-items-center rounded-2xl bg-[hsl(var(--secondary))] text-[hsl(var(--secondary-foreground))]">{isRegister ? <PenLine size={20} /> : <DoorOpen size={20} />}</div></div><form onSubmit={submit} className="space-y-4"><Field label="Username" value={form.username} onChange={(value) => update('username', value)} placeholder="e.g. thando.m" testId="input-username" minLength={3} required />{isRegister && <Field label="Full name" value={form.fullName} onChange={(value) => update('fullName', value)} placeholder="What should we call you?" testId="input-full-name" required />}{isRegister && <div className="grid grid-cols-2 gap-3"><Field label="Grade" type="number" value={form.grade} onChange={(value) => update('grade', value)} min="4" max="12" testId="input-grade" required /><Field label="School" value={form.schoolName} onChange={(value) => update('schoolName', value)} placeholder="School name" testId="input-school" required /></div>}<Field label="Password" type="password" value={form.password} onChange={(value) => update('password', value)} placeholder={isRegister ? 'At least 8 characters' : 'Your password'} testId="input-password" minLength={isRegister ? 8 : 1} required />{isRegister && <div><p className="mb-2 text-xs font-bold text-[hsl(var(--muted-foreground))]">Your subjects</p><div className="flex flex-wrap gap-2">{subjects.map((subject) => <button type="button" key={subject} onClick={() => toggleSubject(subject)} data-testid={`button-subject-${subject.toLowerCase().replaceAll(' ', '-')}`} className={cn('rounded-full border px-3 py-2 text-xs font-semibold transition-colors', form.subjects.includes(subject) ? 'border-[hsl(var(--accent))] bg-[hsl(var(--accent))] text-[hsl(var(--accent-foreground))]' : 'border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))] hover:border-[hsl(var(--accent))]')}>{subject}</button>)}</div></div>}{error && <div data-testid="status-auth-error" className="flex gap-2 rounded-xl bg-[#fff1ee] p-3 text-xs font-semibold text-[#93473a]"><Info size={15} className="shrink-0" />{error}</div>}<Button type="submit" disabled={mutation.isPending} data-testid={`button-${mode}-submit`} className="mt-3 w-full py-3.5">{mutation.isPending ? 'One moment…' : isRegister ? 'Create my space' : 'Log in'}<ArrowRight size={16} /></Button></form><p className="mt-6 text-center text-sm text-[hsl(var(--muted-foreground))]">{isRegister ? 'Already learning here?' : 'New to SLATE ALIS?'} <Link href={isRegister ? '/login' : '/register'} data-testid={`link-switch-${mode}`} className="font-bold text-[hsl(var(--accent-foreground))] hover:underline">{isRegister ? 'Log in' : 'Create an account'}</Link></p></div></main></PublicShell>;
}

function Field({ label, value, onChange, testId, type = 'text', placeholder, ...props }: { label: string; value: string; onChange: (value: string) => void; testId: string; type?: string; placeholder?: string } & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type' | 'placeholder'>) {
  return <label className="block"><span className="mb-1.5 block text-xs font-bold text-[hsl(var(--muted-foreground))]">{label}</span><input {...props} type={type} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} data-testid={testId} className="w-full rounded-xl border border-[hsl(var(--input))] bg-[hsl(var(--background)/.55)] px-3.5 py-3 text-sm outline-none transition-shadow placeholder:text-[hsl(var(--muted-foreground)/.6)] focus:border-[hsl(var(--accent))] focus:ring-4 focus:ring-[hsl(var(--accent)/.14)]" /></label>;
}

type SpeechRecognitionInstance = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};

function VoiceAnswerButton({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const [listening, setListening] = useState(false);
  const [supported, setSupported] = useState(true);
  const recognitionRef = useState<{ current: SpeechRecognitionInstance | null }>({ current: null })[0];
  const toggle = () => {
    const speechWindow = window as typeof window & { SpeechRecognition?: new () => SpeechRecognitionInstance; webkitSpeechRecognition?: new () => SpeechRecognitionInstance };
    const Recognition = speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition;
    if (!Recognition) {
      setSupported(false);
      return;
    }
    if (listening) {
      recognitionRef.current?.stop();
      return;
    }
    const recognition = new Recognition();
    recognition.lang = 'en-ZA';
    recognition.interimResults = false;
    recognition.continuous = false;
    recognition.onresult = (event) => {
      const transcript = Array.from({ length: event.results.length }, (_, index) => event.results[index][0]?.transcript ?? '').join(' ').trim();
      if (transcript) onChange(`${value.trim()}${value.trim() ? ' ' : ''}${transcript}`);
    };
    recognition.onerror = () => setListening(false);
    recognition.onend = () => { setListening(false); recognitionRef.current = null; };
    recognitionRef.current = recognition;
    setListening(true);
    recognition.start();
  };
  if (!supported) return <p className="mt-2 text-[11px] text-[hsl(var(--muted-foreground))]">Voice input is available in Chrome or Edge.</p>;
  return <button type="button" onClick={toggle} data-testid="button-voice-answer" className={cn('mt-2 inline-flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs font-bold transition-colors', listening ? 'bg-[#f5d7d1] text-[#93473a]' : 'bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--secondary))]')}><span className={cn('size-2 rounded-full', listening ? 'pulse-soft bg-[#93473a]' : 'bg-[hsl(var(--accent))]')} />{listening ? 'Listening…' : 'Use voice input'}</button>;
}

function Protected({ children }: { children: (learner: any) => ReactNode }) {
  const [, setLocation] = useLocation();
  const current = useGetCurrentLearner({ query: { queryKey: getGetCurrentLearnerQueryKey(), retry: false } });
  useEffect(() => { if (!current.isLoading && !current.data?.learner) setLocation('/login'); }, [current.isLoading, current.data, setLocation]);
  if (current.isLoading) return <AppShell><LoadingState label="Checking your learning space…" /></AppShell>;
  if (!current.data?.learner) return null;
  return <AppShell learner={current.data.learner}>{children(current.data.learner)}</AppShell>;
}

function Dashboard() {
  const summary = useGetDashboardSummary({ query: { queryKey: getGetDashboardSummaryQueryKey(), staleTime: 30000 } });
  const activity = useGetRecentLearningActivity({ query: { queryKey: getGetRecentLearningActivityQueryKey(), staleTime: 30000 } });
  const [, setLocation] = useLocation();
  if (summary.isLoading) return <LoadingState />;
  if (summary.isError) return <ErrorState message={errorText(summary.error)} retry={() => summary.refetch()} />;
  const data = summary.data;
  if (!data) return <ErrorState />;
  const next = data.nextActivity;
  return <><PageIntro eyebrow={`Tuesday · Grade ${data.learner.grade}`} title={`Hi, ${data.learner.fullName.split(' ')[0]}.`} detail="A focused check-in, then one useful next step." action={<Link href="/assignments" data-testid="link-dashboard-assignments" className="inline-flex items-center gap-2 text-sm font-bold text-[hsl(var(--accent-foreground))] hover:underline">View all work <ArrowRight size={15} /></Link>} /><div className="grid gap-4 md:grid-cols-[1.35fr_.65fr]"><section className="relative overflow-hidden rounded-[2rem] bg-[hsl(var(--primary))] p-7 text-[hsl(var(--primary-foreground))] shadow-lg sm:p-9"><div className="absolute -right-16 -top-24 size-72 rounded-full border-[28px] border-[hsl(var(--accent)/.18)]" /><div className="relative"><div className="flex items-center justify-between"><span className="rounded-full bg-[hsl(var(--accent))] px-3 py-1.5 text-[11px] font-black uppercase tracking-wider text-[hsl(var(--accent-foreground))]">Your next focus</span><Sparkles className="text-[hsl(var(--accent))]" size={22} /></div><h2 data-testid="text-next-focus" className="display-face mt-8 max-w-lg text-3xl font-bold leading-tight tracking-[-.04em] sm:text-4xl">{data.nextFocus || 'Keep your momentum going.'}</h2><p className="mt-3 max-w-md text-sm leading-6 text-[hsl(var(--primary-foreground)/.67)]">Small, steady work is how the bigger picture takes shape.</p>{next && <Button onClick={() => { sessionStorage.setItem(`slate-remediation-${next.id}`, JSON.stringify(next)); setLocation(`/remediation/${next.id}`); }} data-testid="button-next-focus" className="mt-7 bg-[hsl(var(--accent))] text-[hsl(var(--accent-foreground))]">Start a 5-minute activity <ArrowRight size={16} /></Button>}</div></section><div className="grid grid-cols-2 gap-4"><Metric icon={<Flame size={18} />} value={String(data.streakDays)} label="day streak" tone="yellow" /><Metric icon={<BarChart3 size={18} />} value={`${Math.round(data.averageScore)}%`} label="average score" tone="mint" /><div className="col-span-2 rounded-[1.5rem] border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5"><div className="flex items-center justify-between"><span className="text-sm font-bold">Assignment pulse</span><Link href="/assignments" data-testid="link-pulse-assignments" className="text-xs font-bold text-[hsl(var(--accent-foreground))]">Details</Link></div><div className="mt-5 grid grid-cols-2 gap-y-4 text-xs"><Pulse label="Open" value={data.assignments.open} /><Pulse label="Upcoming" value={data.assignments.upcoming} /><Pulse label="Completed" value={data.assignments.completed} /><Pulse label="Missed" value={data.assignments.missed} /></div></div></div></div><div className="mt-5 grid gap-5 lg:grid-cols-[1fr_.8fr]"><section className="rounded-[1.75rem] border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-6"><div className="mb-6 flex items-center justify-between"><div><p className="mono-face text-[10px] uppercase tracking-[.16em] text-[hsl(var(--muted-foreground))]">Recent movement</p><h2 className="mt-1 text-lg font-bold">Your learning trail</h2></div><Activity size={19} className="text-[hsl(var(--accent-foreground))]" /></div>{activity.isLoading ? <div className="space-y-4"><div className="h-10 animate-pulse rounded-xl bg-[hsl(var(--muted))]" /><div className="h-10 animate-pulse rounded-xl bg-[hsl(var(--muted))]" /></div> : activity.isError ? <ErrorState message={errorText(activity.error)} retry={() => activity.refetch()} /> : !activity.data?.length ? <EmptyState icon={<Activity size={21} />} title="Your trail starts here" detail="Complete an assignment to see your progress build." action={<Link href="/assignments" data-testid="link-empty-activity" className="font-bold text-[hsl(var(--accent-foreground))]">See assignments</Link>} /> : <div className="space-y-1">{activity.data.slice(0, 4).map((item) => <div key={item.id} data-testid={`row-activity-${item.id}`} className="flex items-center gap-3 rounded-xl px-2 py-3 hover:bg-[hsl(var(--muted)/.6)]"><div className="grid size-9 shrink-0 place-items-center rounded-xl bg-[hsl(var(--secondary))] text-[hsl(var(--secondary-foreground))]"><Check size={16} /></div><div className="min-w-0 flex-1"><p className="truncate text-sm font-bold">{item.label}</p><p className="mt-0.5 text-xs text-[hsl(var(--muted-foreground))]">{item.subject} · {formatDate(item.timestamp, true)}</p></div><span className="mono-face text-sm font-medium text-[hsl(var(--accent-foreground))]">{item.score}%</span></div>)}</div>}</section><section className="rounded-[1.75rem] border border-[hsl(var(--border))] bg-[hsl(var(--secondary)/.55)] p-6"><div className="flex size-10 items-center justify-center rounded-xl bg-[hsl(var(--secondary))] text-[hsl(var(--secondary-foreground))]"><GraduationCap size={20} /></div><h2 className="display-face mt-6 text-2xl font-bold tracking-[-.03em]">Progress is not a straight line.</h2><p className="mt-3 text-sm leading-6 text-[hsl(var(--secondary-foreground)/.8)]">Missed something? That is information, not a verdict. Come back to the concept and try it in a new way.</p><Link href="/profile" data-testid="link-dashboard-profile" className="mt-6 inline-flex items-center gap-2 text-sm font-bold text-[hsl(var(--secondary-foreground))]">See your learning style <ArrowRight size={15} /></Link></section></div></>;
}

function Metric({ icon, value, label, tone }: { icon: ReactNode; value: string; label: string; tone: 'yellow' | 'mint' }) {
  return <div className={cn('rounded-[1.5rem] p-5', tone === 'yellow' ? 'bg-[#f7e8be]' : 'bg-[hsl(var(--secondary))]')}><div className={cn('mb-4 grid size-9 place-items-center rounded-xl', tone === 'yellow' ? 'bg-[#f3d98a] text-[#74551f]' : 'bg-[#b9ded1] text-[#275c4e]')}>{icon}</div><p className="display-face text-3xl font-bold tracking-[-.04em]">{value}</p><p className="mt-1 text-xs font-semibold text-[hsl(var(--foreground)/.62)]">{label}</p></div>;
}

function Pulse({ label, value }: { label: string; value: number }) { return <div><p className="text-[hsl(var(--muted-foreground))]">{label}</p><p className="mono-face mt-1 text-lg font-medium">{value}</p></div>; }
function EmptyState({ icon, title, detail, action }: { icon: ReactNode; title: string; detail: string; action?: ReactNode }) { return <div className="rounded-2xl border border-dashed border-[hsl(var(--border))] p-7 text-center"><div className="mx-auto grid size-11 place-items-center rounded-2xl bg-[hsl(var(--muted))] text-[hsl(var(--accent-foreground))]">{icon}</div><p className="mt-4 font-bold">{title}</p><p className="mx-auto mt-1 max-w-xs text-sm leading-6 text-[hsl(var(--muted-foreground))]">{detail}</p>{action && <div className="mt-4">{action}</div>}</div>; }

function Assignments() {
  const query = useListAssignments({ query: { queryKey: getListAssignmentsQueryKey(), staleTime: 30000 } });
  const [filter, setFilter] = useState('ALL');
  if (query.isLoading) return <LoadingState label="Laying out your assignments…" />;
  if (query.isError) return <ErrorState message={errorText(query.error)} retry={() => query.refetch()} />;
  const assignments = query.data || [];
  const filtered = filter === 'ALL' ? assignments : assignments.filter((assignment) => assignment.status === filter);
  return <><PageIntro eyebrow="Your work" title="Assignments" detail="Open when you are ready. Locked when the timing matters. Every status tells you what to do next." /><div className="mb-6 flex flex-wrap gap-2">{['ALL', 'OPEN', 'LOCKED', 'SUBMITTED', 'CLOSED', 'MISSED'].map((item) => <button key={item} onClick={() => setFilter(item)} data-testid={`button-filter-${item.toLowerCase()}`} className={cn('rounded-full border px-3 py-2 text-xs font-bold transition-colors', filter === item ? 'border-[hsl(var(--primary))] bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]' : 'border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))] hover:border-[hsl(var(--accent))]')}>{item === 'ALL' ? 'All work' : item[0] + item.slice(1).toLowerCase()}</button>)}</div>{!assignments.length ? <EmptyState icon={<BookOpen size={21} />} title="Nothing assigned yet" detail="When your teacher shares work, it will appear here." /> : !filtered.length ? <EmptyState icon={<FileQuestion size={21} />} title="No assignments in this view" detail="Try another status to find what you are looking for." /> : <div className="grid gap-4 md:grid-cols-2">{filtered.map((assignment, index) => <AssignmentCard key={assignment.id} assignment={assignment} index={index} />)}</div>}</>;
}

function AssignmentCard({ assignment, index }: { assignment: any; index: number }) {
  const isClickable = assignment.status === AssignmentStatus.OPEN || assignment.status === AssignmentStatus.SUBMITTED;
  return <Link href={isClickable ? `/assignments/${assignment.id}` : '#'} onClick={(event) => { if (!isClickable) event.preventDefault(); }} data-testid={`card-assignment-${assignment.id}`} className={cn('rise-in group block rounded-[1.6rem] border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-6 shadow-sm transition-transform duration-200', `delay-${Math.min(index + 1, 4)}`, isClickable ? 'hover:-translate-y-1 hover:shadow-md' : 'opacity-80')}><div className="flex items-start justify-between gap-3"><div><p className="mono-face text-[10px] uppercase tracking-[.16em] text-[hsl(var(--muted-foreground))]">{assignment.subject}</p><h2 className="mt-2 text-lg font-bold tracking-tight">{assignment.title}</h2></div><StatusPill status={assignment.status} /></div><p className="mt-2 text-sm text-[hsl(var(--muted-foreground))]">{assignment.topic}</p><div className="mt-7 flex items-center justify-between border-t border-[hsl(var(--border))] pt-4 text-xs text-[hsl(var(--muted-foreground))]"><span className="flex items-center gap-1.5"><FileQuestion size={14} />{assignment.questionCount} questions</span>{assignment.status === 'LOCKED' ? <span className="flex items-center gap-1.5"><LockKeyhole size={13} />Opens {formatDate(assignment.openAt)}</span> : assignment.status === 'OPEN' ? <span className="flex items-center gap-1.5 font-semibold text-[hsl(var(--accent-foreground))]"><Clock3 size={13} />Closes {formatDate(assignment.closeAt)}</span> : <span className="flex items-center gap-1.5"><Clock3 size={13} />{assignment.status === 'MISSED' ? `Closed ${formatDate(assignment.closeAt)}` : `Due ${formatDate(assignment.closeAt)}`}</span>}</div>{assignment.status === 'OPEN' && <div className="mt-4"><div className="mb-1.5 flex justify-between text-[10px] font-bold uppercase tracking-wider text-[hsl(var(--muted-foreground))]"><span>Progress</span><span>{assignment.progress}%</span></div><div className="h-1.5 overflow-hidden rounded-full bg-[hsl(var(--muted))]"><div className="h-full rounded-full bg-[hsl(var(--accent))]" style={{ width: `${assignment.progress}%` }} /></div></div>}{isClickable && <div className="mt-5 flex items-center gap-2 text-sm font-bold text-[hsl(var(--accent-foreground))]">{assignment.status === 'SUBMITTED' ? 'Review result' : assignment.progress ? 'Continue assignment' : 'Start assignment'}<ArrowRight size={15} className="transition-transform group-hover:translate-x-1" /></div>}</Link>;
}

function AssignmentDetail() {
  const { id = '' } = useParams<{ id: string }>();
  const query = useGetAssignment(id, { query: { queryKey: getGetAssignmentQueryKey(id), enabled: Boolean(id) } });
  const open = useOpenAssignment();
  const submit = useSubmitAssignment();
  const client = useQueryClient();
  const [session, setSession] = useState<any>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState('');
  const [currentQuestion, setCurrentQuestion] = useState(0);
  if (query.isLoading) return <LoadingState label="Preparing this assignment…" />;
  if (query.isError || !query.data) return <ErrorState message={errorText(query.error)} retry={() => query.refetch()} />;
  const assignment = query.data;
  const start = () => { setError(''); open.mutate({ assignmentId: id }, { onSuccess: (data) => { setSession(data); setCurrentQuestion(0); }, onError: (e) => setError(errorText(e)) }); };
  const submitAnswers = () => {
    if (!session) return;
    const payload = { sessionId: session.sessionId, answers: session.questions.map((question: any) => ({ questionId: question.id, answer: answers[question.id] || '' })) };
    if (payload.answers.some((answer: { questionId: string; answer: string }) => !answer.answer.trim())) { setError('Answer each question before submitting. You can move between questions to check your work.'); return; }
    submit.mutate({ assignmentId: id, data: payload }, { onSuccess: (data) => { setResult(data); client.invalidateQueries({ queryKey: getListAssignmentsQueryKey() }); client.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() }); }, onError: (e) => setError(errorText(e)) });
  };
  if (result) return <ResultView result={result} assignment={assignment} />;
  if (session) {
    const question = session.questions[currentQuestion];
    const answered = Object.keys(answers).filter((key) => answers[key]?.trim()).length;
    return <div className="mx-auto max-w-3xl"><Link href="/assignments" data-testid="link-back-assignments" className="mb-7 inline-flex items-center gap-2 text-sm font-bold text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"><ArrowLeft size={16} />Back to assignments</Link><div className="mb-8 flex flex-wrap items-end justify-between gap-4"><div><p className="mono-face text-[10px] uppercase tracking-[.16em] text-[hsl(var(--accent-foreground))]">{assignment.subject} · {assignment.topic}</p><h1 className="display-face mt-2 text-3xl font-bold tracking-[-.04em]">{assignment.title}</h1></div><div className="flex items-center gap-2 rounded-xl bg-[#f7e8be] px-3 py-2 text-xs font-bold text-[#74551f]"><Timer size={15} />Finishes {formatDate(session.expiresAt, true)}</div></div><div className="mb-5 flex items-center justify-between text-xs text-[hsl(var(--muted-foreground))]"><span>Question {currentQuestion + 1} of {session.questions.length}</span><span>{answered} answered</span></div><div className="mb-8 flex gap-1.5">{session.questions.map((item: any, index: number) => <button key={item.id} onClick={() => setCurrentQuestion(index)} data-testid={`button-question-${index + 1}`} className={cn('h-1.5 flex-1 rounded-full transition-colors', index === currentQuestion ? 'bg-[hsl(var(--primary))]' : answers[item.id] ? 'bg-[hsl(var(--accent))]' : 'bg-[hsl(var(--muted))]')} />)}</div><div className="rounded-[2rem] border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-6 shadow-sm sm:p-10"><div className="mb-8 flex items-center justify-between"><span className="rounded-full bg-[hsl(var(--secondary))] px-3 py-1.5 text-[11px] font-black uppercase tracking-wider text-[hsl(var(--secondary-foreground))]">{question.type.replace('_', ' ')}</span><span className="mono-face text-xs text-[hsl(var(--muted-foreground))]">{question.concept}</span></div><h2 data-testid={`text-question-${question.id}`} className="display-face max-w-2xl text-2xl font-bold leading-tight tracking-[-.03em] sm:text-3xl">{question.prompt}</h2>{question.type === 'multiple_choice' && question.options ? <div className="mt-9 grid gap-3">{question.options.map((option: string, index: number) => <button key={option} onClick={() => setAnswers((prev) => ({ ...prev, [question.id]: option }))} data-testid={`button-answer-${index}`} className={cn('flex w-full items-center gap-3 rounded-2xl border p-4 text-left text-sm font-semibold transition-colors', answers[question.id] === option ? 'border-[hsl(var(--accent))] bg-[hsl(var(--accent)/.18)]' : 'border-[hsl(var(--border))] hover:border-[hsl(var(--accent))]')}><span className="grid size-7 place-items-center rounded-lg bg-[hsl(var(--muted))] text-xs font-black">{String.fromCharCode(65 + index)}</span>{option}{answers[question.id] === option && <Check className="ml-auto text-[hsl(var(--accent-foreground))]" size={17} />}</button>)}</div> : <div className="mt-9"><textarea value={answers[question.id] || ''} onChange={(event) => setAnswers((prev) => ({ ...prev, [question.id]: event.target.value }))} data-testid={`input-answer-${question.id}`} className="min-h-[150px] w-full resize-y rounded-2xl border border-[hsl(var(--input))] bg-[hsl(var(--background)/.55)] p-4 text-sm leading-6 outline-none focus:border-[hsl(var(--accent))] focus:ring-4 focus:ring-[hsl(var(--accent)/.14)]" placeholder="Write your answer here…" />{assignment.subject.toLowerCase() !== 'mathematics' && <VoiceAnswerButton value={answers[question.id] || ''} onChange={(value) => setAnswers((prev) => ({ ...prev, [question.id]: value }))} />}</div>}</div>{error && <p data-testid="status-assignment-error" className="mt-4 rounded-xl bg-[#fff1ee] p-3 text-xs font-semibold text-[#93473a]">{error}</p>}<div className="mt-5 flex items-center justify-between"><Button variant="ghost" disabled={currentQuestion === 0} onClick={() => setCurrentQuestion((value) => value - 1)} data-testid="button-previous-question"><ArrowLeft size={16} />Previous</Button>{currentQuestion < session.questions.length - 1 ? <Button onClick={() => setCurrentQuestion((value) => value + 1)} data-testid="button-next-question">Next question <ArrowRight size={16} /></Button> : <Button onClick={submitAnswers} disabled={submit.isPending} data-testid="button-submit-assignment">{submit.isPending ? 'Marking…' : 'Submit assignment'}<Send size={16} /></Button>}</div></div>;
  }
  return <div className="mx-auto max-w-3xl"><Link href="/assignments" data-testid="link-back-assignment-list" className="mb-8 inline-flex items-center gap-2 text-sm font-bold text-[hsl(var(--muted-foreground))]"><ArrowLeft size={16} />Back to assignments</Link><div className="rounded-[2rem] border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-7 shadow-sm sm:p-10"><div className="flex flex-wrap items-start justify-between gap-5"><div><StatusPill status={assignment.status} /><p className="mono-face mt-5 text-[10px] uppercase tracking-[.16em] text-[hsl(var(--muted-foreground))]">{assignment.subject} · {assignment.topic}</p><h1 data-testid="text-assignment-title" className="display-face mt-2 text-4xl font-bold tracking-[-.05em]">{assignment.title}</h1></div><div className="grid size-16 place-items-center rounded-2xl bg-[hsl(var(--secondary))] text-[hsl(var(--secondary-foreground))]"><FileQuestion size={28} /></div></div><div className="mt-9 grid gap-3 border-y border-[hsl(var(--border))] py-5 text-sm sm:grid-cols-3"><div><p className="text-xs text-[hsl(var(--muted-foreground))]">Questions</p><p className="mt-1 font-bold">{assignment.questionCount}</p></div><div><p className="text-xs text-[hsl(var(--muted-foreground))]">{assignment.status === 'LOCKED' ? 'Opens' : 'Closes'}</p><p className="mt-1 font-bold">{formatDate(assignment.status === 'LOCKED' ? assignment.openAt : assignment.closeAt, true)}</p></div><div><p className="text-xs text-[hsl(var(--muted-foreground))]">Current progress</p><p className="mt-1 font-bold">{assignment.progress}%</p></div></div>{assignment.status === 'LOCKED' && <div className="mt-7 flex gap-3 rounded-2xl bg-[hsl(var(--muted))] p-4"><LockKeyhole size={18} className="mt-0.5 shrink-0 text-[hsl(var(--muted-foreground))]" /><div><p className="text-sm font-bold">This work opens {formatDate(assignment.openAt, true)}.</p><p className="mt-1 text-xs leading-5 text-[hsl(var(--muted-foreground))]">Your teacher has set a start time. Check back then and it will be ready for you.</p></div></div>}{assignment.status === 'CLOSED' && <div className="mt-7 flex gap-3 rounded-2xl bg-[#fff1ee] p-4 text-[#93473a]"><Clock3 size={18} className="mt-0.5 shrink-0" /><div><p className="text-sm font-bold">This assignment is closed.</p><p className="mt-1 text-xs leading-5">The close time was {formatDate(assignment.closeAt, true)}.</p></div></div>}{assignment.status === 'MISSED' && <div className="mt-7 flex gap-3 rounded-2xl bg-[#fff1ee] p-4 text-[#93473a]"><Info size={18} className="mt-0.5 shrink-0" /><div><p className="text-sm font-bold">This one was missed.</p><p className="mt-1 text-xs leading-5">That is a signal, not a sentence. Your next open assignment is still waiting.</p></div></div>}{assignment.status === 'OPEN' && <><p className="mt-7 text-sm leading-6 text-[hsl(var(--muted-foreground))]">You will get a unique set of questions when you begin. Take your time, read carefully, and submit before the close time.</p><Button onClick={start} disabled={open.isPending} data-testid="button-open-assignment" className="mt-6">{open.isPending ? 'Preparing questions…' : assignment.progress ? 'Continue assignment' : 'Begin assignment'}<Play size={16} /></Button>{error && <p data-testid="status-open-error" className="mt-3 text-xs font-semibold text-[#93473a]">{error}</p>}</>}{assignment.status === 'SUBMITTED' && <div className="mt-7"><p className="text-sm leading-6 text-[hsl(var(--muted-foreground))]">You submitted this work. Open it to review your result and the ideas worth revisiting.</p><p className="mt-2 text-xs font-semibold text-[hsl(var(--muted-foreground))]">Submitted assignments cannot be changed.</p></div>}</div></div>;
}

function ResultView({ result, assignment }: { result: any; assignment: any }) {
  const [, setLocation] = useLocation();
  const verdict = result.overallVerdict === 'CORRECT' ? 'Strong work.' : result.overallVerdict === 'PARTIALLY_CORRECT' ? 'You are getting there.' : 'There is a useful next step here.';
  return <div className="mx-auto max-w-4xl"><Link href="/assignments" data-testid="link-result-back" className="mb-8 inline-flex items-center gap-2 text-sm font-bold text-[hsl(var(--muted-foreground))]"><ArrowLeft size={16} />Back to assignments</Link><div className="grid gap-5 lg:grid-cols-[.72fr_1.28fr]"><section className="rounded-[2rem] bg-[hsl(var(--primary))] p-7 text-[hsl(var(--primary-foreground))] shadow-lg sm:p-9"><p className="mono-face text-[10px] uppercase tracking-[.16em] text-[hsl(var(--accent))]">Marked · {assignment.subject}</p><h1 className="display-face mt-8 text-4xl font-bold leading-none tracking-[-.05em]">{verdict}</h1><div className="mt-10 flex items-end gap-2"><span data-testid="text-submission-score" className="display-face text-8xl font-bold leading-none tracking-[-.09em] text-[hsl(var(--accent))]">{Math.round(result.score)}</span><span className="mb-2 text-2xl text-[hsl(var(--primary-foreground)/.5)]">%</span></div><p className="mt-3 text-sm leading-6 text-[hsl(var(--primary-foreground)/.65)]">{result.feedback}</p>{result.remediation && <Button onClick={() => { sessionStorage.setItem(`slate-remediation-${result.remediation.id}`, JSON.stringify(result.remediation)); setLocation(`/remediation/${result.remediation.id}`); }} data-testid="button-start-remediation" className="mt-7 bg-[hsl(var(--accent))] text-[hsl(var(--accent-foreground))]">Try a different angle <Sparkles size={16} /></Button>}</section><section className="rounded-[2rem] border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-7 sm:p-9"><div className="flex items-center justify-between"><div><p className="mono-face text-[10px] uppercase tracking-[.16em] text-[hsl(var(--muted-foreground))]">Question by question</p><h2 className="mt-1 text-xl font-bold">What your answers show</h2></div><CheckCircle2 className="text-[hsl(var(--accent-foreground))]" size={23} /></div><div className="mt-7 space-y-3">{result.marks.map((mark: any, index: number) => <div key={mark.questionId} data-testid={`row-mark-${mark.questionId}`} className="rounded-2xl border border-[hsl(var(--border))] p-4"><div className="flex items-center gap-3"><span className={cn('grid size-8 place-items-center rounded-xl', mark.verdict === 'CORRECT' ? 'bg-[hsl(var(--secondary))] text-[hsl(var(--secondary-foreground))]' : 'bg-[#f7e8be] text-[#74551f]')}>{mark.verdict === 'CORRECT' ? <Check size={15} /> : <CircleHelp size={16} />}</span><p className="text-sm font-bold">Question {index + 1}</p><span className="mono-face ml-auto text-xs text-[hsl(var(--muted-foreground))]">{mark.score}%</span></div><p className="mt-3 text-xs leading-5 text-[hsl(var(--muted-foreground))]">{mark.explanation}</p>{mark.gap && <p className="mt-2 text-xs font-bold text-[#8b6424]">Worth revisiting: {mark.gap}</p>}</div>)}</div></section></div></div>;
}

function Remediation() {
  const { id = '' } = useParams<{ id: string }>();
  const respond = useRespondToRemediation();
  const [activity, setActivity] = useState<any>(null);
  const [answer, setAnswer] = useState('');
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState('');
  useEffect(() => { try { const saved = sessionStorage.getItem(`slate-remediation-${id}`); if (saved) setActivity(JSON.parse(saved)); } catch { setError('This activity could not be opened.'); } }, [id]);
  if (!activity) return <><PageIntro eyebrow="Adaptive practice" title="A new angle" detail="This activity is not available yet. Return to your assignments and choose another next step." /><EmptyState icon={<Sparkles size={21} />} title="Activity unavailable" detail={error || 'The activity may have expired or already been completed.'} action={<Link href="/dashboard" data-testid="link-remediation-dashboard" className="inline-flex items-center gap-2 font-bold text-[hsl(var(--accent-foreground))]">Back to today <ArrowRight size={15} /></Link>} /></>;
  const submit = (followUp = false) => { if (!answer.trim()) { setError('Choose or write an answer first.'); return; } setError(''); respond.mutate({ activityId: activity.id, data: { answer, followUp } }, { onSuccess: (data) => { setResult(data); setAnswer(''); }, onError: (e) => setError(errorText(e)) }); };
  if (result) return <div className="mx-auto max-w-2xl"><Link href="/dashboard" data-testid="link-remediation-result-back" className="mb-8 inline-flex items-center gap-2 text-sm font-bold text-[hsl(var(--muted-foreground))]"><ArrowLeft size={16} />Back to your dashboard</Link><div className={cn('rounded-[2rem] p-8 sm:p-12', result.correct ? 'bg-[hsl(var(--secondary))]' : 'bg-[#f7e8be]')}><div className="grid size-12 place-items-center rounded-2xl bg-[hsl(var(--card)/.65)]">{result.correct ? <CheckCircle2 size={25} /> : <RotateCcw size={24} />}</div><p className="mono-face mt-8 text-[10px] uppercase tracking-[.17em] text-[hsl(var(--muted-foreground))]">{result.correct ? 'Concept clicked' : 'Keep turning it over'}</p><h1 className="display-face mt-3 text-4xl font-bold tracking-[-.05em]">{result.correct ? 'That is the idea.' : 'Not quite yet.'}</h1><p data-testid="text-remediation-feedback" className="mt-4 text-sm leading-7 text-[hsl(var(--foreground)/.75)]">{result.feedback}</p><div className="mt-7 flex items-center gap-5"><div><p className="mono-face text-3xl font-medium">{Math.round(result.score)}%</p><p className="text-xs text-[hsl(var(--muted-foreground))]">activity score</p></div>{result.improved !== null && <div className="border-l border-[hsl(var(--foreground)/.14)] pl-5"><p className="text-sm font-bold">{result.improved ? 'You improved' : 'Keep practising'}</p><p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">Your effort is showing.</p></div>}</div>{result.followUpQuestion ? <Button onClick={() => { setActivity({ ...activity, id: activity.id, prompt: result.followUpQuestion.prompt, options: result.followUpQuestion.options, instruction: 'One more, while the idea is fresh.' }); setResult(null); }} data-testid="button-follow-up-remediation" className="mt-8">One more question <ArrowRight size={16} /></Button> : <Link href="/dashboard" data-testid="link-remediation-done" className="mt-8 inline-flex items-center gap-2 text-sm font-bold">Done for now <ArrowRight size={15} /></Link>}</div></div>;
  return <div className="mx-auto max-w-2xl"><Link href="/dashboard" data-testid="link-remediation-back" className="mb-8 inline-flex items-center gap-2 text-sm font-bold text-[hsl(var(--muted-foreground))]"><ArrowLeft size={16} />Back to dashboard</Link><div className="rounded-[2rem] border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-7 shadow-sm sm:p-11"><div className="flex items-start justify-between gap-4"><div><span className="rounded-full bg-[hsl(var(--accent))] px-3 py-1.5 text-[11px] font-black uppercase tracking-wider text-[hsl(var(--accent-foreground))]">{activity.format.replace('_', ' ')}</span><p className="mono-face mt-5 text-[10px] uppercase tracking-[.16em] text-[hsl(var(--muted-foreground))]">{activity.concept}</p><h1 data-testid="text-remediation-title" className="display-face mt-2 text-4xl font-bold tracking-[-.05em]">{activity.title}</h1></div><Sparkles className="text-[hsl(var(--accent-foreground))]" size={24} /></div><div className="mt-9 rounded-2xl bg-[hsl(var(--secondary)/.6)] p-5"><p className="text-xs font-bold text-[hsl(var(--secondary-foreground))]">{activity.instruction}</p><p data-testid="text-remediation-prompt" className="display-face mt-4 text-2xl font-bold leading-tight tracking-[-.03em]">{activity.prompt}</p></div>{activity.options?.length ? <div className="mt-6 grid gap-3">{activity.options.map((option: string, index: number) => <button key={option} onClick={() => setAnswer(option)} data-testid={`button-remediation-option-${index}`} className={cn('flex items-center gap-3 rounded-2xl border p-4 text-left text-sm font-bold transition-colors', answer === option ? 'border-[hsl(var(--accent))] bg-[hsl(var(--accent)/.18)]' : 'border-[hsl(var(--border))] hover:border-[hsl(var(--accent))]')}><span className="grid size-7 place-items-center rounded-lg bg-[hsl(var(--muted))] text-xs">{String.fromCharCode(65 + index)}</span>{option}{answer === option && <Check className="ml-auto" size={16} />}</button>)}</div> : <textarea value={answer} onChange={(event) => setAnswer(event.target.value)} data-testid="input-remediation-answer" className="mt-6 min-h-[120px] w-full rounded-2xl border border-[hsl(var(--input))] bg-[hsl(var(--background)/.55)] p-4 text-sm outline-none focus:border-[hsl(var(--accent))]" placeholder="Your answer…" />}<Button onClick={() => submit()} disabled={respond.isPending} data-testid="button-submit-remediation" className="mt-6 w-full py-3.5">{respond.isPending ? 'Checking your thinking…' : 'Check my answer'}<ArrowRight size={16} /></Button>{error && <p data-testid="status-remediation-error" className="mt-3 text-xs font-semibold text-[#93473a]">{error}</p>}</div></div>;
}

function Profile() {
  const current = useGetCurrentLearner({ query: { queryKey: getGetCurrentLearnerQueryKey(), staleTime: 30000 } });
  const profile = useGetLearningProfile({ query: { queryKey: getGetLearningProfileQueryKey(), staleTime: 30000 } });
  const update = useUpdateLearnerProfile();
  const client = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [saved, setSaved] = useState(false);
  const learner = current.data?.learner;
  const [form, setForm] = useState({ fullName: '', grade: '', schoolName: '', subjects: [] as string[] });
  useEffect(() => { if (learner) setForm({ fullName: learner.fullName, grade: String(learner.grade), schoolName: learner.schoolName, subjects: learner.subjects }); }, [learner]);
  if (current.isLoading || profile.isLoading) return <LoadingState label="Reading your learning signals…" />;
  if (current.isError || profile.isError || !learner) return <ErrorState message={errorText(current.error || profile.error)} retry={() => { current.refetch(); profile.refetch(); }} />;
  const learning = profile.data;
  const save = (event: FormEvent) => { event.preventDefault(); update.mutate({ data: { fullName: form.fullName, grade: Number(form.grade), schoolName: form.schoolName, subjects: form.subjects } }, { onSuccess: () => { setEditing(false); setSaved(true); client.invalidateQueries({ queryKey: getGetCurrentLearnerQueryKey() }); setTimeout(() => setSaved(false), 3000); } }); };
  const toggle = (subject: string) => setForm((prev) => ({ ...prev, subjects: prev.subjects.includes(subject) ? prev.subjects.filter((item) => item !== subject) : [...prev.subjects, subject] }));
  return <><PageIntro eyebrow="About your learning" title="My profile" detail="This is your space: the details you share and the patterns SLATE ALIS notices as you learn." action={saved ? <span data-testid="status-profile-saved" className="inline-flex items-center gap-2 rounded-xl bg-[hsl(var(--secondary))] px-4 py-2.5 text-sm font-bold text-[hsl(var(--secondary-foreground))]"><Check size={16} />Saved</span> : !editing && <Button variant="secondary" onClick={() => setEditing(true)} data-testid="button-edit-profile"><PenLine size={15} />Edit details</Button>} /><div className="grid gap-5 lg:grid-cols-[.78fr_1.22fr]"><section className="rounded-[2rem] bg-[hsl(var(--primary))] p-7 text-[hsl(var(--primary-foreground))] sm:p-9"><div className="grid size-16 place-items-center rounded-3xl bg-[hsl(var(--accent))] text-xl font-black text-[hsl(var(--accent-foreground))]">{learner.fullName.split(' ').map((word) => word[0]).slice(0, 2).join('').toUpperCase()}</div><p className="mono-face mt-8 text-[10px] uppercase tracking-[.16em] text-[hsl(var(--accent))]">Learner profile</p><h2 data-testid="text-profile-name" className="display-face mt-2 text-3xl font-bold tracking-[-.04em]">{learner.fullName}</h2><p className="mt-2 text-sm text-[hsl(var(--primary-foreground)/.62)]">@{learner.username} · Grade {learner.grade}</p><div className="mt-9 border-t border-[hsl(var(--primary-foreground)/.15)] pt-5"><p className="text-xs text-[hsl(var(--primary-foreground)/.5)]">School</p><p className="mt-1 text-sm font-bold">{learner.schoolName}</p></div></section><div className="space-y-5">{editing ? <form onSubmit={save} className="rounded-[2rem] border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-6 sm:p-8"><div className="mb-6 flex items-center justify-between"><h2 className="text-lg font-bold">Update your details</h2><button type="button" onClick={() => setEditing(false)} data-testid="button-cancel-profile" className="text-[hsl(var(--muted-foreground))]"><X size={18} /></button></div><div className="space-y-4"><Field label="Full name" value={form.fullName} onChange={(value) => setForm({ ...form, fullName: value })} testId="input-profile-name" required /><div className="grid grid-cols-2 gap-3"><Field label="Grade" type="number" value={form.grade} onChange={(value) => setForm({ ...form, grade: value })} testId="input-profile-grade" min="4" max="12" required /><Field label="School" value={form.schoolName} onChange={(value) => setForm({ ...form, schoolName: value })} testId="input-profile-school" required /></div><div><p className="mb-2 text-xs font-bold text-[hsl(var(--muted-foreground))]">Subjects</p><div className="flex flex-wrap gap-2">{subjects.map((subject) => <button type="button" key={subject} onClick={() => toggle(subject)} data-testid={`button-profile-subject-${subject.toLowerCase().replaceAll(' ', '-')}`} className={cn('rounded-full border px-3 py-2 text-xs font-bold', form.subjects.includes(subject) ? 'border-[hsl(var(--accent))] bg-[hsl(var(--accent))]' : 'border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))]')}>{subject}</button>)}</div></div></div><Button type="submit" disabled={update.isPending} data-testid="button-save-profile" className="mt-6"><Save size={15} />{update.isPending ? 'Saving…' : 'Save changes'}</Button>{update.isError && <p className="mt-3 text-xs font-semibold text-[#93473a]">{errorText(update.error)}</p>}</form> : <section className="rounded-[2rem] border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-6 sm:p-8"><div className="flex items-center justify-between"><div><p className="mono-face text-[10px] uppercase tracking-[.16em] text-[hsl(var(--muted-foreground))]">Learning signals</p><h2 className="mt-1 text-xl font-bold">How you learn best</h2></div><BarChart3 className="text-[hsl(var(--accent-foreground))]" size={21} /></div><div className="mt-7 rounded-2xl bg-[hsl(var(--secondary)/.65)] p-5"><div className="flex items-end justify-between gap-3"><div><p className="text-xs text-[hsl(var(--secondary-foreground)/.7)]">Primary style</p><p data-testid="text-primary-style" className="display-face mt-1 text-2xl font-bold text-[hsl(var(--secondary-foreground))]">{learning?.primaryStyle || 'Still discovering'}</p></div><p data-testid="text-profile-confidence" className="mono-face text-sm text-[hsl(var(--secondary-foreground))]">{learning?.confidence || 0}% confidence</p></div><div className="mt-4 h-2 overflow-hidden rounded-full bg-[hsl(var(--secondary-foreground)/.14)]"><div className="h-full rounded-full bg-[hsl(var(--secondary-foreground))]" style={{ width: `${learning?.confidence || 0}%` }} /></div></div>{learning?.signals?.length ? <div className="mt-6 space-y-4">{learning.signals.map((signal) => <div key={signal.format}><div className="flex justify-between text-xs"><span className="font-bold">{signal.label}</span><span className="mono-face text-[hsl(var(--muted-foreground))]">{signal.score}% · {signal.sessions} sessions</span></div><div className="mt-2 h-1.5 rounded-full bg-[hsl(var(--muted))]"><div className="h-full rounded-full bg-[hsl(var(--accent))]" style={{ width: `${signal.score}%` }} /></div></div>)}</div> : <p className="mt-5 text-sm text-[hsl(var(--muted-foreground))]">Complete a few different activities and your signals will start to appear.</p>}</section>}{learning?.activeGaps?.length ? <section className="rounded-[2rem] border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-6 sm:p-8"><p className="mono-face text-[10px] uppercase tracking-[.16em] text-[hsl(var(--muted-foreground))]">Worth revisiting</p><h2 className="mt-1 text-xl font-bold">Active learning gaps</h2><div className="mt-5 flex flex-wrap gap-2">{learning.activeGaps.map((gap) => <span key={gap} className="rounded-full bg-[#f7e8be] px-3 py-2 text-xs font-bold text-[#74551f]">{gap}</span>)}</div></section> : null}</div></div></>;
}

function Router() {
  return <ErrorBoundary resetKey={useLocation()[0]}><Switch><Route path="/" component={Home} /><Route path="/login"><AuthPage mode="login" /></Route><Route path="/register"><AuthPage mode="register" /></Route><Route path="/dashboard"><Protected>{() => <Dashboard />}</Protected></Route><Route path="/assignments"><Protected>{() => <Assignments />}</Protected></Route><Route path="/assignments/:id"><Protected>{() => <AssignmentDetail />}</Protected></Route><Route path="/remediation/:id"><Protected>{() => <Remediation />}</Protected></Route><Route path="/profile"><Protected>{() => <Profile />}</Protected></Route><Route component={NotFound} /></Switch></ErrorBoundary>;
}

function HealthProbe() {
  useHealthCheck({ query: { queryKey: ['/api/healthz'], staleTime: 60000, retry: false } });
  return null;
}

function App() {
  return <QueryClientProvider client={queryClient}><HealthProbe /><TooltipProvider><WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}><Router /></WouterRouter><Toaster /></TooltipProvider></QueryClientProvider>;
}

export default App;