import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useLocation } from 'wouter';
import {
  AlertTriangle,
  BarChart3,
  Check,
  Eye,
  EyeOff,
  LayoutGrid,
  Loader2,
  LogOut,
  Plus,
  ShieldCheck,
  TrendingDown,
  TrendingUp,
  Users,
} from 'lucide-react';
import { BrandEmblem, PoweredBy } from '@/components/brand';
import { MarkedScriptView } from '@/components/marked-script';
import {
  useHodClass,
  useHodJoinClass,
  useHodLeaveClass,
  useHodLogin,
  useHodLogout,
  useHodOverview,
  useHodRegister,
  useHodScript,
  useHodSession,
  useHodSubmissions,
  type HodClassView,
  type HodZoneCounts,
} from '@/lib/hod-api';

function cn(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(' ');
}

function errorText(error: unknown) {
  if (error instanceof Error && error.message) return error.message;
  return 'Something went wrong. Please try again.';
}

function trendLabel(trend: string) {
  return trend.toLowerCase().replaceAll('_', ' ');
}

function HodButton({ children, className, variant = 'primary', ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'ghost' | 'secondary' }) {
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

function HodField({ label, value, onChange, testId, type = 'text', ...props }: { label: string; value: string; onChange: (value: string) => void; testId: string; type?: string } & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'>) {
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

export function HodLoginLink() {
  return <Link href="/hod/login" data-testid="link-hod-login-home" className="inline-flex items-center gap-2 rounded-xl px-3 py-2.5 text-sm font-bold text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))]"><ShieldCheck size={16} />HOD</Link>;
}

export function HodAuth({ mode }: { mode: 'login' | 'register' }) {
  const isRegister = mode === 'register';
  const [, setLocation] = useLocation();
  const register = useHodRegister();
  const login = useHodLogin();
  const [form, setForm] = useState({ fullName: '', email: '', password: '', confirm: '' });
  const [error, setError] = useState('');
  const submit = (event: FormEvent) => {
    event.preventDefault();
    setError('');
    if (isRegister && form.password !== form.confirm) {
      setError('Those passwords do not match.');
      return;
    }
    const onSuccess = () => setLocation('/hod');
    const onError = (mutationError: unknown) => setError(errorText(mutationError));
    if (isRegister) {
      register.mutate({ fullName: form.fullName, email: form.email, password: form.password }, { onSuccess, onError });
    } else {
      login.mutate({ email: form.email, password: form.password }, { onSuccess, onError });
    }
  };
  const pending = register.isPending || login.isPending;
  return (
    <div className="grain flex min-h-[100dvh] flex-col items-center justify-center gap-6 bg-[hsl(var(--background))] px-5 py-10">
      <form onSubmit={submit} className="w-full max-w-md rounded-[2rem] border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-8 shadow-xl">
        <div className="mb-8 flex items-center gap-3">
          <BrandEmblem className="size-11" />
          <div>
            <h1 className="display-face text-xl font-bold tracking-tight">{isRegister ? 'Create your HOD account' : 'HOD sign in'}</h1>
            <p className="text-xs text-[hsl(var(--muted-foreground))]">{isRegister ? 'Supervise classes at department level — class data only.' : 'Welcome back to your supervisory overview.'}</p>
          </div>
        </div>
        <div className="space-y-4">
          {isRegister && <HodField label="Your full name" value={form.fullName} onChange={(value) => setForm({ ...form, fullName: value })} testId="input-hod-name" required />}
          <HodField label="Email address" type="email" value={form.email} onChange={(value) => setForm({ ...form, email: value })} testId="input-hod-email" required />
          <HodField label={isRegister ? 'Password (8+ characters)' : 'Password'} type="password" value={form.password} onChange={(value) => setForm({ ...form, password: value })} testId="input-hod-password" minLength={isRegister ? 8 : 1} required />
          {isRegister && <HodField label="Confirm password" type="password" value={form.confirm} onChange={(value) => setForm({ ...form, confirm: value })} testId="input-hod-confirm" minLength={8} required />}
        </div>
        {error && <p data-testid="status-hod-auth-error" className="mt-4 text-xs font-semibold text-[#93473a]">{error}</p>}
        <HodButton type="submit" disabled={pending} data-testid="button-hod-submit" className="mt-6 w-full">{pending ? <Loader2 size={15} className="animate-spin" /> : null}{isRegister ? 'Create HOD account' : 'Sign in'}</HodButton>
        {isRegister && <p className="mt-3 text-center text-xs"><Link href="/privacy" data-testid="link-hod-privacy" className="font-bold text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--accent-foreground))] hover:underline">Read the privacy notice</Link></p>}{!isRegister && <p className="mt-3 text-center text-xs"><Link href="/recover" data-testid="link-hod-forgot-password" className="font-bold text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--accent-foreground))] hover:underline">Forgot your password?</Link></p>}
        <p className="mt-5 text-center text-xs text-[hsl(var(--muted-foreground))]">
          {isRegister ? 'Already have an HOD account?' : 'New here as a head of department?'}{' '}
          <Link href={isRegister ? '/hod/login' : '/hod/register'} data-testid="link-hod-auth-switch" className="font-bold text-[hsl(var(--accent-foreground))]">{isRegister ? 'Sign in' : 'Create one'}</Link>
        </p>
        <p className="mt-3 text-center text-[11px] text-[hsl(var(--muted-foreground))]"><Link href="/" data-testid="link-hod-home" className="underline underline-offset-2">Back to SLATE home</Link></p>
      </form>
      <PoweredBy />
    </div>
  );
}

const NAV = [
  { href: '/hod', label: 'Overview', icon: BarChart3 },
  { href: '/hod/classes', label: 'Classes', icon: LayoutGrid },
];

export function HodLayout({ children }: { children: ReactNode }) {
  const [location, setLocation] = useLocation();
  const session = useHodSession();
  const logout = useHodLogout();
  const hod = session.data?.hod ?? null;
  useEffect(() => { if (!session.isLoading && !hod) setLocation('/hod/login'); }, [session.isLoading, hod, setLocation]);
  if (session.isLoading) {
    return <div className="grain flex min-h-[100dvh] items-center justify-center bg-[hsl(var(--background))]"><Loader2 size={22} className="animate-spin text-[hsl(var(--accent-foreground))]" /></div>;
  }
  if (!hod) return null;
  return (
    <div className="grain min-h-[100dvh] bg-[hsl(var(--background))]">
      <header className="bg-[hsl(var(--sidebar))]">
        <div className="mx-auto flex max-w-[1280px] flex-wrap items-center justify-between gap-3 px-5 py-4 sm:px-8">
          <Link href="/hod" data-testid="link-hod-home-mark" className="flex items-center gap-3">
            <BrandEmblem />
            <span>
              <span className="display-face block text-base font-bold leading-tight text-[hsl(var(--sidebar-foreground))]">SLATE <span className="text-[hsl(var(--accent))]">HOD</span></span>
              <span className="block text-[11px] text-[hsl(var(--sidebar-foreground)/.6)]">Department oversight</span>
            </span>
          </Link>
          <div className="flex items-center gap-3">
            <div className="text-right">
              <p data-testid="text-hod-name" className="text-sm font-bold text-[hsl(var(--sidebar-foreground))]">{hod.fullName}</p>
              <p className="text-[11px] text-[hsl(var(--sidebar-foreground)/.6)]">{hod.email}</p>
            </div>
            <button onClick={() => logout.mutate(undefined, { onSuccess: () => setLocation('/hod/login') })} data-testid="button-hod-logout" className="inline-flex items-center gap-2 rounded-xl px-3 py-2.5 text-sm font-bold text-[hsl(var(--sidebar-foreground)/.7)] hover:bg-[hsl(var(--sidebar-accent))]"><LogOut size={16} />Sign out</button>
          </div>
        </div>
        <div className="mx-auto max-w-[1280px] overflow-x-auto px-5 sm:px-8">
          <nav className="flex gap-1 pb-1">
            {NAV.map(({ href, label, icon: Icon }) => {
              const active = href === '/hod' ? location === '/hod' : location.startsWith(href);
              return (
                <Link
                  key={href}
                  href={href}
                  data-testid={`link-hod-nav-${label.toLowerCase().replaceAll(' ', '-')}`}
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
      <footer className="px-5 pb-8 sm:px-8"><PoweredBy /></footer>
    </div>
  );
}

// Performance zones, shown as counts only. A learner with too few marked
// results sits in "not enough data" and is never shown as red.
function ZoneBar({ zones }: { zones: HodZoneCounts }) {
  const cells = [
    { key: 'green', label: 'On track', value: zones.green, tone: 'bg-[#d9efe0] text-[#1d6b3c]' },
    { key: 'yellow', label: 'Watch', value: zones.yellow, tone: 'bg-[#f7e8be] text-[#74551f]' },
    { key: 'red', label: 'Needs support', value: zones.red, tone: 'bg-[#f8dcd6] text-[#93473a]' },
    { key: 'insufficient', label: 'Not enough data', value: zones.insufficient, tone: 'bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))]' },
  ];
  return (
    <div data-testid="zones-hod" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {cells.map((cell) => (
        <div key={cell.key} data-testid={`zone-hod-${cell.key}`} className={cn('rounded-2xl px-3 py-2.5 text-center', cell.tone)}>
          <p className="mono-face text-xl font-bold">{cell.value}</p>
          <p className="text-[11px] font-bold">{cell.label}</p>
        </div>
      ))}
    </div>
  );
}

function StatCard({ label, value, detail, tone = 'plain' }: { label: string; value: string; detail?: string; tone?: 'plain' | 'navy' | 'gold' }) {
  return (
    <div className={cn('rounded-2xl border p-4', tone === 'navy' ? 'border-[hsl(var(--primary))] bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]' : tone === 'gold' ? 'border-[#e3cb8e] bg-[#fffaee]' : 'border-[hsl(var(--border))] bg-[hsl(var(--card))]')}>
      <p className={cn('text-[11px] font-bold uppercase tracking-[.08em]', tone === 'navy' ? 'text-[hsl(var(--primary-foreground)/.7)]' : 'text-[hsl(var(--muted-foreground))]')}>{label}</p>
      <p className="mono-face mt-1.5 text-2xl font-bold">{value}</p>
      {detail && <p className={cn('mt-0.5 text-[11px]', tone === 'navy' ? 'text-[hsl(var(--primary-foreground)/.7)]' : 'text-[hsl(var(--muted-foreground))]')}>{detail}</p>}
    </div>
  );
}

// One class's class-level card: average, zones, completion and the biggest
// concept gap. Deliberately no learner list.
function HodClassCard({ entry, onOpen }: { entry: HodClassView; onOpen: () => void }) {
  const gap = entry.gapAlert;
  return (
    <div data-testid={`card-hod-class-${entry.class.id}`} className="rounded-[1.75rem] border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="display-face text-lg font-bold leading-tight">{entry.class.label}</p>
          <p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">{entry.class.schoolName} · {entry.class.learnerCount} learners · taught by {entry.class.teacherName}</p>
        </div>
        <button type="button" onClick={onOpen} data-testid={`button-hod-open-${entry.class.id}`} className="shrink-0 whitespace-nowrap rounded-[10px] border border-[hsl(var(--border))] px-3.5 py-2.5 text-xs font-bold hover:border-[hsl(var(--accent))]">Open class</button>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <StatCard tone="navy" label="Class average" value={`${entry.classAverage}%`} detail={trendLabel(entry.trend)} />
        <StatCard label="Completion" value={`${entry.completionRate}%`} detail={`${entry.assignmentCount} assignments`} />
        <StatCard label="Concept gaps" value={String(entry.conceptGaps.length)} detail={entry.conceptGaps[0]?.concept ?? 'None measured yet'} />
      </div>

      <div className="mt-4"><ZoneBar zones={entry.zones} /></div>

      {gap && (
        <div data-testid={`alert-hod-gap-${entry.class.id}`} className="mt-4 rounded-2xl border border-[#dfa79b] bg-[#fff4f1] p-4">
          <p className="flex items-center gap-1.5 text-xs font-bold text-[#93473a]"><AlertTriangle size={14} />{gap.concept}</p>
          <p className="mt-1 text-[11px] text-[#7d4a41]">{gap.strugglingLearners} of {gap.learnersAssessed} assessed learners are below 60% (class average {gap.averageScore}%).</p>
        </div>
      )}
    </div>
  );
}

function HodLoading() {
  return <div className="flex items-center justify-center py-20"><Loader2 size={22} className="animate-spin text-[hsl(var(--accent-foreground))]" /></div>;
}

export function HodOverview() {
  const [, setLocation] = useLocation();
  const overview = useHodOverview();
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const join = useHodJoinClass();

  const joinClass = (event: FormEvent) => {
    event.preventDefault();
    setError('');
    join.mutate({ code: code.trim().toUpperCase() }, {
      onSuccess: (data) => { setCode(''); setLocation(`/hod/classes/${data.class.id}`); },
      onError: (mutationError) => setError(errorText(mutationError)),
    });
  };

  if (overview.isLoading) return <HodLoading />;
  if (overview.isError || !overview.data) {
    return <div className="rounded-2xl border border-[#dfa79b] bg-[#fff4f1] p-5 text-sm font-semibold text-[#93473a]">{errorText(overview.error)}</div>;
  }
  const data = overview.data;

  return (
    <div className="space-y-6">
      <div>
        <p className="mono-face text-[11px] uppercase tracking-[.2em] text-[hsl(var(--accent-foreground)/.75)]">HOD · Department overview</p>
        <h1 data-testid="text-hod-title" className="display-face mt-2 text-2xl font-bold leading-tight tracking-[-.04em] sm:text-3xl">Class-level oversight</h1>
        <p className="mt-2 text-sm text-[hsl(var(--muted-foreground))]">Averages, performance zones and concept-gap alerts for every class you supervise. Individual learners are not shown.</p>
      </div>

      <form onSubmit={joinClass} data-testid="form-hod-join" className="rounded-[1.75rem] border border-dashed border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5">
        <p className="text-sm font-bold">Join a class with an HOD code</p>
        <p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">Ask the teacher for the HOD code for the class you supervise. This is not the learner class code.</p>
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <label className="min-w-[180px] flex-1">
            <span className="mb-1.5 block text-xs font-bold text-[hsl(var(--muted-foreground))]">HOD code</span>
            <input value={code} onChange={(event) => setCode(event.target.value)} data-testid="input-hod-join-code" placeholder="e.g. 4F2A9C" className="mono-face w-full rounded-xl border border-[hsl(var(--input))] bg-[hsl(var(--background)/.55)] px-3.5 py-3 text-sm uppercase outline-none focus:border-[hsl(var(--accent))]" required minLength={4} />
          </label>
          <HodButton type="submit" disabled={join.isPending} data-testid="button-hod-join"><Plus size={15} />{join.isPending ? 'Joining…' : 'Join class'}</HodButton>
        </div>
        {error && <p data-testid="status-hod-join-error" className="mt-3 text-xs font-semibold text-[#93473a]">{error}</p>}
      </form>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard tone="navy" label="Classes" value={String(data.totals.classes)} detail={`${data.totals.teachers} teachers`} />
        <StatCard label="Learners" value={String(data.totals.learners)} detail="across your classes" />
        <StatCard tone="gold" label="Department average" value={`${data.totals.classAverage}%`} detail="class averages combined" />
        <StatCard label="Needs support" value={String(data.totals.zones.red)} detail={`${data.totals.zones.green} on track`} />
      </div>

      {!data.teachers.length ? (
        <div className="rounded-3xl border border-dashed border-[hsl(var(--border))] p-8 text-center">
          <ShieldCheck size={22} className="mx-auto text-[hsl(var(--accent-foreground))]" />
          <p className="mt-3 font-bold">No classes yet</p>
          <p className="mt-2 text-sm text-[hsl(var(--muted-foreground))]">Join a class with the HOD code your teacher shared.</p>
        </div>
      ) : (
        data.teachers.map((group) => (
          <section key={group.teacherName} data-testid={`group-hod-teacher-${group.teacherName}`} className="rounded-[1.75rem] border border-[hsl(var(--border))] bg-[hsl(var(--background)/.4)] p-5 sm:p-6">
            <div className="flex items-center gap-2">
              <Users size={18} className="text-[hsl(var(--accent-foreground))]" />
              <h2 className="text-lg font-bold">{group.teacherName}</h2>
              <span className="text-xs text-[hsl(var(--muted-foreground))]">{group.classes.length} {group.classes.length === 1 ? 'class' : 'classes'}</span>
            </div>
            <div className="mt-4 grid gap-4 lg:grid-cols-2">
              {group.classes.map((entry) => (
                <HodClassCard key={entry.class.id} entry={entry} onOpen={() => setLocation(`/hod/classes/${entry.class.id}`)} />
              ))}
            </div>
          </section>
        ))
      )}
    </div>
  );
}

export function HodClasses() {
  const [, setLocation] = useLocation();
  const session = useHodSession();
  const classes = session.data?.classes ?? [];
  if (session.isLoading) return <HodLoading />;
  return (
    <div className="space-y-6">
      <div>
        <p className="mono-face text-[11px] uppercase tracking-[.2em] text-[hsl(var(--accent-foreground)/.75)]">HOD · Classes</p>
        <h1 className="display-face mt-2 text-2xl font-bold leading-tight tracking-[-.04em]">Classes you supervise</h1>
      </div>
      {!classes.length ? (
        <div className="rounded-3xl border border-dashed border-[hsl(var(--border))] p-8 text-center">
          <p className="font-bold">No classes yet</p>
          <p className="mt-2 text-sm text-[hsl(var(--muted-foreground))]">Join a class from the overview page with its HOD code.</p>
          <HodButton variant="secondary" onClick={() => setLocation('/hod')} data-testid="link-hod-join-from-classes" className="mt-4">Go to overview</HodButton>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {classes.map((entry) => (
            <button
              key={entry.id}
              type="button"
              onClick={() => setLocation(`/hod/classes/${entry.id}`)}
              data-testid={`card-hod-class-${entry.id}`}
              className="rounded-[1.75rem] border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5 text-left hover:border-[hsl(var(--accent))]"
            >
              <p className="display-face text-lg font-bold leading-tight">{entry.label}</p>
              <p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">{entry.schoolName} · {entry.learnerCount} learners</p>
              <p className="mt-2 text-xs text-[hsl(var(--muted-foreground))]">Taught by {entry.teacherName}</p>
              <span className={cn('mt-3 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold', entry.hodCanViewScripts ? 'bg-[#d9efe0] text-[#1d6b3c]' : 'bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))]')}>
                {entry.hodCanViewScripts ? <Eye size={11} /> : <EyeOff size={11} />}{entry.hodCanViewScripts ? 'Scripts allowed' : 'Class data only'}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// A class's read-only view. Same aggregates as the teacher's dashboard, with
// the learner panels removed. Script access is the teacher's switch.
export function HodClassDetail({ classId }: { classId: string }) {
  const [, setLocation] = useLocation();
  const detail = useHodClass(classId);
  const leave = useHodLeaveClass();
  const [openSubmission, setOpenSubmission] = useState<string | null>(null);
  const [assignmentId, setAssignmentId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const script = useHodScript(openSubmission);
  const submissions = useHodSubmissions(classId, assignmentId);

  if (detail.isLoading) return <HodLoading />;
  if (detail.isError || !detail.data) {
    return (
      <div className="space-y-4">
        <Link href="/hod" data-testid="link-hod-back" className="inline-flex items-center gap-2 text-sm font-bold text-[hsl(var(--muted-foreground))]">← Back to overview</Link>
        <div className="rounded-2xl border border-[#dfa79b] bg-[#fff4f1] p-5 text-sm font-semibold text-[#93473a]">{errorText(detail.error)}</div>
      </div>
    );
  }
  const data = detail.data;

  const leaveClass = () => {
    setError('');
    leave.mutate({ classId }, {
      onSuccess: () => setLocation('/hod'),
      onError: (mutationError) => setError(errorText(mutationError)),
    });
  };

  if (script.data) {
    return <MarkedScriptView script={script.data} onBack={() => setOpenSubmission(null)} backLabel="Back to class" heading={script.data.assignment.title} />;
  }

  return (
    <div className="space-y-6">
      <Link href="/hod" data-testid="link-hod-back" className="inline-flex items-center gap-2 text-sm font-bold text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]">← Back to overview</Link>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="mono-face text-[11px] uppercase tracking-[.2em] text-[hsl(var(--accent-foreground)/.75)]">HOD · Class view</p>
          <h1 data-testid="text-hod-class-title" className="display-face mt-2 text-2xl font-bold leading-tight tracking-[-.04em] sm:text-3xl">{data.class.label}</h1>
          <p className="mt-2 text-sm text-[hsl(var(--muted-foreground))]">{data.class.schoolName} · {data.class.learnerCount} learners · taught by {data.class.teacherName}</p>
        </div>
        <HodButton variant="secondary" disabled={leave.isPending} onClick={leaveClass} data-testid="button-hod-leave-class">{leave.isPending ? 'Leaving…' : 'Leave this class'}</HodButton>
      </div>
      {error && <p data-testid="status-hod-leave-error" className="text-xs font-semibold text-[#93473a]">{error}</p>}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard tone="navy" label="Class average" value={`${data.classAverage}%`} detail={trendLabel(data.trend)} />
        <StatCard label="Learners" value={String(data.class.learnerCount)} detail="class roll" />
        <StatCard label="Completion" value={`${data.completionRate}%`} detail={`${data.assignmentCount} assignments`} />
        <StatCard tone="gold" label="Concept gaps" value={String(data.conceptGaps.length)} detail={data.conceptGaps[0]?.concept ?? 'None measured yet'} />
      </div>

      <section className="rounded-[1.75rem] border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5 sm:p-6">
        <h2 className="text-lg font-bold">Performance zones</h2>
        <p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">Counts of learners in each band, from released results only. A learner with fewer than three marked results sits in “not enough data” and is never shown as needing support.</p>
        <div className="mt-4"><ZoneBar zones={data.zones} /></div>
      </section>

      {data.gapAlert && (
        <div data-testid="alert-hod-class-gap" className="rounded-[1.75rem] border-2 border-[hsl(var(--destructive)/.35)] bg-[#fff2ee] p-6">
          <p className="display-face text-xl font-bold leading-snug text-[#8f2f22]">{data.gapAlert.message}</p>
          <p className="mt-2 text-sm text-[#7d4a41]">{data.gapAlert.strugglingLearners} of {data.gapAlert.learnersAssessed} assessed learners are below 60% on this concept (class average {data.gapAlert.averageScore}%).</p>
        </div>
      )}

      <section className="rounded-[1.75rem] border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5 sm:p-6">
        <h2 className="text-lg font-bold">Concept gaps</h2>
        {!data.conceptGaps.length ? (
          <p className="mt-3 text-sm text-[hsl(var(--muted-foreground))]">No released results yet, so no concept gaps are measured.</p>
        ) : (
          <div className="mt-4 space-y-3">
            {data.conceptGaps.map((gap) => (
              <div key={gap.concept} data-testid={`row-hod-gap-${gap.concept}`} className="rounded-2xl border border-[hsl(var(--border))] p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-bold">{gap.concept}</p>
                  <span className={cn('inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-bold', gap.strugglingPercentage >= 50 ? 'bg-[#f8dcd6] text-[#93473a]' : 'bg-[#f7e8be] text-[#74551f]')}>
                    {gap.strugglingPercentage >= 50 ? <TrendingDown size={11} /> : <TrendingUp size={11} />}{gap.strugglingPercentage}% struggling
                  </span>
                </div>
                <p className="mt-1 text-[11px] text-[hsl(var(--muted-foreground))]">{gap.strugglingLearners} of {gap.learnersAssessed} learners · average {gap.averageScore}%</p>
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-[hsl(var(--muted))]">
                  <div className={cn('h-full rounded-full', gap.strugglingPercentage >= 50 ? 'bg-[#c2604f]' : 'bg-[#d3ab4f]')} style={{ width: `${Math.min(100, gap.strugglingPercentage)}%` }} />
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="rounded-[1.75rem] border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5 sm:p-6">
        <h2 className="text-lg font-bold">Assignments</h2>
        {!data.assignments?.length ? (
          <p className="mt-3 text-sm text-[hsl(var(--muted-foreground))]">No assignments set for this class yet.</p>
        ) : (
          <div className="mt-4 space-y-3">
            {data.assignments.map((assignment) => (
              <div key={assignment.id} data-testid={`row-hod-assignment-${assignment.id}`} className="rounded-2xl border border-[hsl(var(--border))] p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-bold">{assignment.title}</p>
                  <span className="rounded-full bg-[hsl(var(--secondary))] px-2.5 py-1 text-[11px] font-bold text-[hsl(var(--secondary-foreground))]">{assignment.status}</span>
                </div>
                <p className="mt-1 text-[11px] text-[hsl(var(--muted-foreground))]">{assignment.topic} · {assignment.submitted}/{assignment.learnerCount} submitted · {assignment.completionRate}% completion{assignment.missed ? ` · ${assignment.missed} missed` : ''}</p>
                <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px]">
                  <span className="text-[hsl(var(--muted-foreground))]">{assignment.resultsVisible ? `Class average ${assignment.averageScore}%` : 'Results held by the teacher'}</span>
                  {data.class.hodCanViewScripts && (
                    <button type="button" onClick={() => setAssignmentId(assignmentId === assignment.id ? null : assignment.id)} data-testid={`button-hod-scripts-${assignment.id}`} className="font-bold text-[hsl(var(--accent-foreground))] underline underline-offset-2">
                      {assignmentId === assignment.id ? 'Hide scripts' : 'View scripts'}
                    </button>
                  )}
                </div>

                {assignmentId === assignment.id && (
                  <div className="mt-3 border-t border-[hsl(var(--border))] pt-3">
                    {submissions.isLoading && <p className="text-[11px] text-[hsl(var(--muted-foreground))]">Loading…</p>}
                    {submissions.isError && <p data-testid={`status-hod-scripts-error-${assignment.id}`} className="text-[11px] font-semibold text-[#93473a]">{errorText(submissions.error)}</p>}
                    {submissions.data?.submissions.length === 0 && <p className="text-[11px] text-[hsl(var(--muted-foreground))]">No submissions yet.</p>}
                    {submissions.data?.submissions.map((row) => (
                      <div key={row.submissionId} data-testid={`row-hod-submission-${row.submissionId}`} className="flex items-center justify-between gap-3 py-1.5">
                        <span className="text-xs font-bold">{row.learnerName}</span>
                        <span className="mono-face text-xs">{row.markingStatus === 'MARKED' ? `${row.score}%` : row.markingStatus}</span>
                        <button type="button" onClick={() => setOpenSubmission(row.submissionId)} data-testid={`button-hod-open-script-${row.submissionId}`} className="inline-flex items-center gap-1 text-[11px] font-bold text-[hsl(var(--accent-foreground))]"><Eye size={12} />Open</button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {data.performance.length > 0 && (
        <section className="rounded-[1.75rem] border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5 sm:p-6">
          <h2 className="text-lg font-bold">Performance trend</h2>
          <p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">Class average per assignment, from released results only.</p>
          <div className="mt-4 space-y-2">
            {data.performance.map((point) => (
              <div key={point.assignmentId} data-testid={`row-hod-trend-${point.assignmentId}`} className="flex items-center gap-3">
                <span className="w-40 shrink-0 truncate text-[11px] font-bold">{point.title}</span>
                <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-[hsl(var(--muted))]">
                  <div className={cn('h-full rounded-full', point.isLowest ? 'bg-[#c2604f]' : 'bg-[hsl(var(--accent-foreground))]')} style={{ width: `${Math.min(100, point.averageScore)}%` }} />
                </div>
                <span className="mono-face w-10 shrink-0 text-right text-[11px]">{point.averageScore}%</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {data.class.hodCanViewScripts && (
        <p className="flex items-center gap-2 text-[11px] text-[hsl(var(--muted-foreground))]"><Check size={12} />The teacher has allowed HOD script access for this class.</p>
      )}
    </div>
  );
}
