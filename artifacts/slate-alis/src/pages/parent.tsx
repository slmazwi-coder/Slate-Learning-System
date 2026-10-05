import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useLocation } from 'wouter';
import {
  BarChart3,
  BookOpen,
  CalendarClock,
  ChevronRight,
  Clock3,
  Copy,
  HeartHandshake,
  KeyRound,
  Loader2,
  LogOut,
  Plus,
  RotateCcw,
  Sparkles,
  UserRound,
} from 'lucide-react';
import {
  useChildScript,
  useCreateChild,
  useParentDashboard,
  useParentLogin,
  useParentLogout,
  useParentRegister,
  useParentSession,
  useResetChildPassword,
  useUpdateChild,
  useUploadParentCurriculum,
  type ChildActivity,
  type ChildDashboard,
  type FamilyClass,
  type FamilyCredentials,
} from '@/lib/family-api';
import { BrandEmblem, PoweredBy } from '@/components/brand';
import { CurriculumUpload } from '@/components/class-mode';
import { MarkedScriptView } from '@/components/marked-script';
import { ProfileAvatar, AvatarUploader } from '@/components/profile-image';
import { usePresetCurricula } from '@/lib/tis-api';

const SUBJECTS = ['Mathematics', 'English', 'Natural Sciences', 'Physical Sciences', 'Life Sciences', 'Social Sciences', 'Accounting', 'Technology', 'Life Orientation'];

// Child classes are created against a hardwired preset curriculum, so the
// subject chips come from the preset catalog rather than a free list.
const STADIO_GRADE = 13;
const GRADE_R = 0;

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
  return { options, entries, loading: presets.isLoading, first: options[0]?.value ?? '' };
}
const GRADES = [GRADE_R, ...Array.from({ length: 12 }, (_, index) => index + 1), STADIO_GRADE];
const gradeLabel = (grade: number) => (grade === STADIO_GRADE ? 'Stadio' : grade === GRADE_R ? 'Grade R' : `Grade ${grade}`);
const WINDOW_OPTIONS = [3, 5, 7, 10, 14, 21, 30];

function cn(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(' ');
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Not available';
  return new Intl.DateTimeFormat('en-ZA', { day: 'numeric', month: 'short' }).format(date);
}

function formatTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('en-ZA', { hour: 'numeric', minute: '2-digit' }).format(date);
}

function formatMinutes(minutes: number) {
  if (minutes < 1) return '0 min';
  if (minutes < 60) return `${Math.round(minutes)} min`;
  const hours = Math.floor(minutes / 60);
  const rest = Math.round(minutes % 60);
  return rest ? `${hours}h ${rest}m` : `${hours}h`;
}

function errorText(error: unknown) {
  if (error instanceof Error && error.message) return error.message;
  return 'Something went wrong. Please try again.';
}

function ParentButton({ children, className, variant = 'primary', ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'ghost' | 'secondary' }) {
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

function ParentField({ label, value, onChange, testId, type = 'text', ...props }: { label: string; value: string; onChange: (value: string) => void; testId: string; type?: string } & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'>) {
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

export function ParentLoginLink() {
  return <Link href="/parent/login" data-testid="link-parent-login-home" className="inline-flex items-center gap-2 rounded-xl px-3 py-2.5 text-sm font-bold text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))]"><HeartHandshake size={16} />Parent</Link>;
}

export function ParentAuth({ mode }: { mode: 'login' | 'register' }) {
  const isRegister = mode === 'register';
  const [, setLocation] = useLocation();
  const register = useParentRegister();
  const login = useParentLogin();
  const [form, setForm] = useState({ fullName: '', email: '', password: '', confirm: '' });
  const [error, setError] = useState('');
  const submit = (event: FormEvent) => {
    event.preventDefault();
    setError('');
    if (isRegister && form.password !== form.confirm) {
      setError('Those passwords do not match.');
      return;
    }
    const onSuccess = () => setLocation('/parent');
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
            <h1 className="display-face text-xl font-bold tracking-tight">{isRegister ? 'Create your parent account' : 'Parent sign in'}</h1>
            <p className="text-xs text-[hsl(var(--muted-foreground))]">{isRegister ? 'No school or teacher needed — Slate runs independently for your child.' : 'Welcome back to your child’s learning space.'}</p>
          </div>
        </div>
        <div className="space-y-4">
          {isRegister && <ParentField label="Your full name" value={form.fullName} onChange={(value) => setForm({ ...form, fullName: value })} testId="input-parent-name" required />}
          <ParentField label="Email address" type="email" value={form.email} onChange={(value) => setForm({ ...form, email: value })} testId="input-parent-email" required />
          <ParentField label={isRegister ? 'Password (8+ characters)' : 'Password'} type="password" value={form.password} onChange={(value) => setForm({ ...form, password: value })} testId="input-parent-password" minLength={isRegister ? 8 : 1} required />
          {isRegister && <ParentField label="Confirm password" type="password" value={form.confirm} onChange={(value) => setForm({ ...form, confirm: value })} testId="input-parent-confirm" minLength={8} required />}
        </div>
        {error && <p data-testid="status-parent-auth-error" className="mt-4 text-xs font-semibold text-[#93473a]">{error}</p>}
        <ParentButton type="submit" disabled={pending} data-testid="button-parent-submit" className="mt-6 w-full">{pending ? <Loader2 size={15} className="animate-spin" /> : null}{isRegister ? 'Create parent account' : 'Sign in'}</ParentButton>
        {!isRegister && <p className="mt-3 text-center text-xs"><Link href="/recover" data-testid="link-parent-forgot-password" className="font-bold text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--accent-foreground))] hover:underline">Forgot your password?</Link></p>}
        <p className="mt-5 text-center text-xs text-[hsl(var(--muted-foreground))]">
          {isRegister ? 'Already have a parent account?' : 'New to SLATE as a parent?'}{' '}
          <Link href={isRegister ? '/parent/login' : '/parent/register'} data-testid="link-parent-auth-switch" className="font-bold text-[hsl(var(--accent-foreground))]">{isRegister ? 'Sign in' : 'Create one'}</Link>
        </p>
        <p className="mt-3 text-center text-[11px] text-[hsl(var(--muted-foreground))]"><Link href="/" data-testid="link-parent-home" className="underline underline-offset-2">Back to SLATE home</Link></p>
      </form>
      <PoweredBy />
    </div>
  );
}

export function ParentLayout({ children }: { children: ReactNode }) {
  const [, setLocation] = useLocation();
  const session = useParentSession();
  const logout = useParentLogout();
  const parent = session.data?.parent ?? null;
  useEffect(() => { if (!session.isLoading && !parent) setLocation('/parent/login'); }, [session.isLoading, parent, setLocation]);
  if (session.isLoading) {
    return <div className="grain flex min-h-[100dvh] items-center justify-center bg-[hsl(var(--background))]"><Loader2 size={22} className="animate-spin text-[hsl(var(--accent-foreground))]" /></div>;
  }
  if (!parent) return null;
  return (
    <div className="grain min-h-[100dvh] bg-[hsl(var(--background))]">
      <header className="bg-[hsl(var(--sidebar))]">
        <div className="mx-auto flex max-w-[1080px] flex-wrap items-center justify-between gap-3 px-5 py-4 sm:px-8">
          <Link href="/parent" data-testid="link-parent-home-mark" className="flex items-center gap-3">
            <BrandEmblem />
            <span>
              <span className="display-face block text-base font-bold leading-tight text-[hsl(var(--sidebar-foreground))]">SLATE <span className="text-[hsl(var(--accent))]">Parent</span></span>
              <span className="block text-[11px] text-[hsl(var(--sidebar-foreground)/.6)]">Independent home learning</span>
            </span>
          </Link>
          <div className="flex items-center gap-3">
            <div className="text-right">
              <p data-testid="text-parent-name" className="text-sm font-bold text-[hsl(var(--sidebar-foreground))]">{parent.fullName}</p>
              <p className="text-[11px] text-[hsl(var(--sidebar-foreground)/.6)]">{parent.email}</p>
            </div>
            <AvatarUploader name={parent.fullName} image={parent.profileImage} invalidateKeys={[['parent']]} />
            <button onClick={() => logout.mutate(undefined, { onSuccess: () => setLocation('/parent/login') })} data-testid="button-parent-logout" className="inline-flex items-center gap-2 rounded-xl px-3 py-2.5 text-sm font-bold text-[hsl(var(--sidebar-foreground)/.7)] hover:bg-[hsl(var(--sidebar-accent))]"><LogOut size={16} />Sign out</button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-[1080px] px-5 py-8 sm:px-8">{children}</main>
      <footer className="px-5 pb-8 sm:px-8"><PoweredBy /></footer>
    </div>
  );
}

function CredentialsPanel({ credentials, fullName }: { credentials: FamilyCredentials | null; fullName: string }) {
  const [copied, setCopied] = useState(false);
  if (!credentials) return null;
  return (
    <div data-testid="panel-child-credentials" className="rounded-2xl border border-[#b7d8c3] bg-[#edf7f0] p-5">
      <div className="flex items-center gap-2 text-[#1d6b3c]"><KeyRound size={16} /><p className="text-sm font-bold">Sign-in details for {fullName}</p></div>
      <p className="mt-1 text-xs text-[#2b5e40]">Share these with your child so they can sign in on the learner app. This is the only time the password is shown.</p>
      <div className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
        <div className="rounded-xl bg-white/70 p-3"><p className="text-[#2b5e40]">Username</p><p data-testid="text-child-username" className="mono-face mt-1 text-sm font-medium">{credentials.username}</p></div>
        <div className="rounded-xl bg-white/70 p-3"><p className="text-[#2b5e40]">Password</p><p data-testid="text-child-password" className="mono-face mt-1 text-sm font-medium">{credentials.password}</p></div>
      </div>
      <button
        type="button"
        onClick={() => {
          navigator.clipboard?.writeText(`username: ${credentials.username}  password: ${credentials.password}`).catch(() => undefined);
          setCopied(true);
        }}
        data-testid="button-copy-credentials"
        className="mt-3 inline-flex items-center gap-2 rounded-xl bg-[#1d6b3c] px-3.5 py-2 text-xs font-bold text-white"
      >
        <Copy size={13} />{copied ? 'Copied' : 'Copy both'}
      </button>
    </div>
  );
}

function AddChildForm({ onCreated }: { onCreated: (credentials: FamilyCredentials, name: string) => void }) {
  const create = useCreateChild();
  const presetOptions = usePresetSubjectOptions();
  const [form, setForm] = useState({ fullName: '', grade: '5', subjects: [] as string[], windowDays: '7', username: '', email: '', age: '', gender: '' });
  const [passwordMode, setPasswordMode] = useState<'generate' | 'choose'>('generate');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
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
    if (passwordMode === 'choose' && password.length < 8) {
      setError('A chosen password needs at least 8 characters.');
      return;
    }
    const age = Number(form.age);
    if (!form.age.trim() || !Number.isInteger(age) || age < 3 || age > 100) {
      setError("Enter your child's age.");
      return;
    }
    if (!form.gender) {
      setError('Choose a gender for your child.');
      return;
    }
    create.mutate({
      fullName: form.fullName,
      grade: Number(form.grade),
      subjects: form.subjects,
      assignmentWindowDays: Number(form.windowDays),
      age,
      gender: form.gender,
      ...(form.username.trim() ? { username: form.username.trim() } : {}),
      ...(form.email.trim() ? { email: form.email.trim() } : {}),
      ...(passwordMode === 'choose' ? { password } : {}),
    }, {
      onSuccess: (data) => {
        onCreated(data.credentials, data.learner.fullName);
        setForm({ fullName: '', grade: '5', subjects: [], windowDays: '7', username: '', email: '', age: '', gender: '' });
        setPassword('');
        setPasswordMode('generate');
      },
      onError: (mutationError) => setError(errorText(mutationError)),
    });
  };
  return (
    <form onSubmit={submit} className="rounded-[1.75rem] border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-6 sm:p-8">
      <div className="flex items-center gap-3">
        <span className="grid size-10 place-items-center rounded-2xl bg-[hsl(var(--accent))] text-[hsl(var(--accent-foreground))]"><Plus size={18} /></span>
        <div>
          <h2 className="text-lg font-bold">Add your child</h2>
          <p className="text-xs text-[hsl(var(--muted-foreground))]">Slate creates a real learner login they can use on their own, and runs in Independent mode automatically.</p>
        </div>
      </div>
      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <ParentField label="Child's full name" value={form.fullName} onChange={(value) => setForm({ ...form, fullName: value })} testId="input-child-name" required />
        <label className="block">
          <span className="mb-1.5 block text-xs font-bold text-[hsl(var(--muted-foreground))]">Grade</span>
          <select value={form.grade} onChange={(event) => setForm({ ...form, grade: event.target.value, subjects: form.subjects.filter((subject) => presetOptionsFor(presetOptions.entries, event.target.value).some((option) => option.value === subject)) })} data-testid="select-child-grade" className="w-full rounded-xl border border-[hsl(var(--input))] bg-[hsl(var(--background)/.55)] px-3.5 py-3 text-sm outline-none focus:border-[hsl(var(--accent))]">
            {GRADES.map((grade) => <option key={grade} value={grade}>{gradeLabel(grade)}</option>)}
          </select>
        </label>
      </div>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <ParentField label="Child's age" type="number" value={form.age} onChange={(value) => setForm({ ...form, age: value })} testId="input-child-age" min={3} max={100} placeholder="e.g. 11" required />
        <label className="block">
          <span className="mb-1.5 block text-xs font-bold text-[hsl(var(--muted-foreground))]">Gender</span>
          <select value={form.gender} onChange={(event) => setForm({ ...form, gender: event.target.value })} data-testid="select-child-gender" required className="w-full rounded-xl border border-[hsl(var(--input))] bg-[hsl(var(--background)/.55)] px-3.5 py-3 text-sm outline-none focus:border-[hsl(var(--accent))]">
            <option value="">Choose…</option>
            <option value="boy">Boy</option>
            <option value="girl">Girl</option>
            <option value="other">Other</option>
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
              data-testid={`button-child-subject-${option.value.toLowerCase().replaceAll(/[\s—]/g, '-')}`}
              className={cn('rounded-full border px-3 py-2 text-xs font-bold', form.subjects.includes(option.value) ? 'border-[hsl(var(--accent))] bg-[hsl(var(--accent))]' : 'border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))]')}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <ParentField label="Login username (optional)" value={form.username} onChange={(value) => setForm({ ...form, username: value })} testId="input-child-username" placeholder="Slate picks one if left blank" />
        <ParentField label="Email (optional)" type="email" value={form.email} onChange={(value) => setForm({ ...form, email: value })} testId="input-child-email" placeholder="You can use your own email" />
      </div>
      <div className="mt-4">
        <p className="mb-2 text-xs font-bold text-[hsl(var(--muted-foreground))]">Password</p>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => setPasswordMode('generate')} data-testid="button-child-password-generate" className={cn('rounded-full border px-3 py-2 text-xs font-bold', passwordMode === 'generate' ? 'border-[hsl(var(--accent))] bg-[hsl(var(--accent))]' : 'border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))]')}>Generate one for me</button>
          <button type="button" onClick={() => setPasswordMode('choose')} data-testid="button-child-password-choose" className={cn('rounded-full border px-3 py-2 text-xs font-bold', passwordMode === 'choose' ? 'border-[hsl(var(--accent))] bg-[hsl(var(--accent))]' : 'border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))]')}>I'll set one</button>
        </div>
        {passwordMode === 'choose' ? (
          <div className="mt-3 max-w-[320px]">
            <ParentField label="Child's password (8+ characters)" type="password" value={password} onChange={setPassword} testId="input-child-password" minLength={8} />
          </div>
        ) : (
          <p className="mt-2 text-[11px] text-[hsl(var(--muted-foreground))]">Slate will show the username and a generated password once after you create the profile.</p>
        )}
      </div>
      <div className="mt-4">
        <label className="block max-w-[260px]">
          <span className="mb-1.5 block text-xs font-bold text-[hsl(var(--muted-foreground))]">Assignment window</span>
          <select value={form.windowDays} onChange={(event) => setForm({ ...form, windowDays: event.target.value })} data-testid="select-child-window" className="w-full rounded-xl border border-[hsl(var(--input))] bg-[hsl(var(--background)/.55)] px-3.5 py-3 text-sm outline-none focus:border-[hsl(var(--accent))]">
            {WINDOW_OPTIONS.map((days) => <option key={days} value={days}>{days} days per assignment</option>)}
          </select>
        </label>
        <p className="mt-1.5 text-[11px] text-[hsl(var(--muted-foreground))]">Each Slate assignment stays open for this long before the next one is generated.</p>
      </div>
      {error && <p data-testid="status-add-child-error" className="mt-4 text-xs font-semibold text-[#93473a]">{error}</p>}
      <ParentButton type="submit" disabled={create.isPending} data-testid="button-add-child" className="mt-5"><Plus size={15} />{create.isPending ? 'Creating…' : 'Create learner profile'}</ParentButton>
    </form>
  );
}

function ClassCurriculum({ classEntry }: { classEntry: FamilyClass }) {
  const upload = useUploadParentCurriculum();
  const [showUpload, setShowUpload] = useState(!classEntry.hasCurriculum);
  const [sequence, setSequence] = useState<string[]>([]);
  const visible = sequence.length ? sequence : classEntry.lessonSequence;
  return (
    <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--background)/.4)] p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-bold">{classEntry.subject}</p>
          <p className="text-[11px] text-[hsl(var(--muted-foreground))]">
            {classEntry.lessonSequence.length
              ? `Independent mode · step ${Math.min(classEntry.currentTopicIndex + 1, classEntry.lessonSequence.length)} of ${classEntry.lessonSequence.length} · ${classEntry.assignmentWindowDays}-day windows`
              : `Independent mode · ${classEntry.assignmentWindowDays}-day windows`}
          </p>
        </div>
        {classEntry.hasCurriculum && !showUpload && (
          <button type="button" onClick={() => setShowUpload(true)} data-testid={`button-parent-curriculum-${classEntry.id}`} className="text-[11px] font-bold text-[hsl(var(--accent-foreground))] underline underline-offset-2">
            {classEntry.lessonSequence.length ? 'Replace curriculum' : 'Upload curriculum'}
          </button>
        )}
      </div>
      {showUpload ? (
        <CurriculumUpload
          pending={upload.isPending}
          error={upload.isError ? errorText(upload.error) : ''}
          sequence={visible}
          currentFileName={classEntry.curriculumFileName}
          testIdPrefix={`parent-class-${classEntry.id}`}
          onUpload={(payload) => upload.mutate({ classId: classEntry.id, ...payload }, { onSuccess: (data) => { setSequence(data.lessonSequence); setShowUpload(false); } })}
        />
      ) : visible.length > 0 ? (
        <p className="mt-2 text-[11px] text-[hsl(var(--muted-foreground))]">Next up: <span className="font-bold text-[hsl(var(--foreground))]">{visible[Math.min(classEntry.currentTopicIndex, visible.length - 1)]}</span></p>
      ) : (
        <p className="mt-2 text-[11px] text-[hsl(var(--muted-foreground))]">Slate is using the default {classEntry.subject} sequence. Upload a curriculum to take over the order.</p>
      )}
    </div>
  );
}

function ActivityCard({ learnerId, activity }: { learnerId: string; activity: ChildActivity }) {
  const maxMinutes = Math.max(1, ...activity.week.map((day) => day.minutes));
  return (
    <div data-testid={`card-activity-${learnerId}`} className="rounded-2xl border border-[hsl(var(--border))] p-5">
      <div className="flex items-center justify-between">
        <p className="text-xs font-bold text-[hsl(var(--muted-foreground))]">Activity</p>
        <Clock3 size={15} className="text-[hsl(var(--accent-foreground))]" />
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 text-center text-xs">
        <div className="rounded-xl bg-[hsl(var(--muted))] px-3 py-2"><p className="mono-face text-base">{formatMinutes(activity.todayMinutes)}</p><p className="text-[hsl(var(--muted-foreground))]">today · {activity.todaySessions} {activity.todaySessions === 1 ? 'session' : 'sessions'}</p></div>
        <div className="rounded-xl bg-[hsl(var(--secondary))] px-3 py-2"><p className="mono-face text-base">{formatMinutes(activity.monthMinutes)}</p><p className="text-[hsl(var(--secondary-foreground)/.8)]">this month</p></div>
      </div>
      <p className="mt-4 text-[11px] font-bold text-[hsl(var(--muted-foreground))]">Last 7 days · {formatMinutes(activity.weekMinutes)} total</p>
      <div className="mt-2 flex items-end gap-1.5" data-testid={`chart-week-${learnerId}`}>
        {activity.week.map((day) => (
          <div key={day.date} className="flex flex-1 flex-col items-center gap-1">
            <div className="flex h-16 w-full items-end rounded-md bg-[hsl(var(--muted))]">
              <div className="w-full rounded-md bg-[hsl(var(--accent))]" style={{ height: `${Math.round((day.minutes / maxMinutes) * 100)}%` }} title={`${formatMinutes(day.minutes)}`} />
            </div>
            <span className="text-[9px] text-[hsl(var(--muted-foreground))]">{new Intl.DateTimeFormat('en-ZA', { weekday: 'narrow' }).format(new Date(`${day.date}T00:00:00`))}</span>
          </div>
        ))}
      </div>
      <p className="mt-4 text-[11px] font-bold text-[hsl(var(--muted-foreground))]">Recent sessions</p>
      {!activity.recent.length ? (
        <p className="mt-2 text-xs text-[hsl(var(--muted-foreground))]">No sign-ins recorded yet.</p>
      ) : (
        <div className="mt-2 space-y-1.5">
          {activity.recent.slice(0, 10).map((session) => (
            <div key={session.id} data-testid={`row-session-${session.id}`} className="flex items-center justify-between gap-3 rounded-lg bg-[hsl(var(--muted)/.6)] px-3 py-2 text-[11px]">
              <span>{formatDate(session.loginAt)} · {formatTime(session.loginAt)}{session.logoutAt ? `–${formatTime(session.logoutAt)}` : ' (active)'}</span>
              <span className="mono-face shrink-0">{session.logoutAt ? formatMinutes(session.durationMinutes ?? 0) : 'now'}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ChildCard({ child }: { child: ChildDashboard }) {
  const update = useUpdateChild();
  const reset = useResetChildPassword();
  const [windowDays, setWindowDays] = useState(String(child.classes[0]?.assignmentWindowDays ?? 7));
  const [windowSaved, setWindowSaved] = useState(false);
  const [resetCreds, setResetCreds] = useState<FamilyCredentials | null>(null);
  const [scriptAssignmentId, setScriptAssignmentId] = useState<string | null>(null);
  const script = useChildScript(child.learner.id, scriptAssignmentId);

  if (scriptAssignmentId) {
    return (
      <section data-testid={`card-child-script-${child.learner.id}`} className="rounded-[1.75rem] border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-6 sm:p-8">
        {script.isLoading ? (
          <div className="flex min-h-[30vh] items-center justify-center"><Loader2 size={22} className="animate-spin text-[hsl(var(--accent-foreground))]" /></div>
        ) : script.isError || !script.data ? (
          <div className="space-y-4">
            <ParentButton variant="ghost" onClick={() => setScriptAssignmentId(null)}><ChevronRight size={15} className="rotate-180" />Back to {child.learner.fullName}</ParentButton>
            <p data-testid="status-child-script-error" className="rounded-2xl border border-[#dfa79b] bg-[#fff4f1] p-5 text-sm font-semibold text-[#93473a]">{errorText(script.error)}</p>
          </div>
        ) : (
          <MarkedScriptView script={script.data} onBack={() => setScriptAssignmentId(null)} backLabel={`Back to ${child.learner.fullName}`} />
        )}
      </section>
    );
  }

  return (
    <section data-testid={`card-child-${child.learner.id}`} className="rounded-[1.75rem] border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-6 sm:p-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-4">
          <ProfileAvatar name={child.learner.fullName} image={child.learner.profileImage} className="size-12 rounded-2xl text-sm" />
          <div>
            <h2 className="text-xl font-bold">{child.learner.fullName}</h2>
            <p className="text-xs text-[hsl(var(--muted-foreground))]">Grade {child.learner.grade} · {child.learner.subjects.join(', ') || 'No subjects yet'} · runs in Independent mode</p>
            <p data-testid={`text-child-details-${child.learner.id}`} className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">{child.learner.age != null ? `Age ${child.learner.age}` : 'Age not declared'}{child.learner.gender ? ` · ${child.learner.gender === 'boy' ? 'Boy' : child.learner.gender === 'girl' ? 'Girl' : 'Other'}` : ''}</p>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-2 text-center text-xs">
          <div className="rounded-xl bg-[hsl(var(--muted))] px-3 py-2"><p className="mono-face text-base">{child.averageScore ?? '—'}{child.averageScore !== null && '%'}</p><p className="text-[hsl(var(--muted-foreground))]">average</p></div>
          <div className="rounded-xl bg-[hsl(var(--secondary))] px-3 py-2"><p className="mono-face text-base">{child.openAssignments}</p><p className="text-[hsl(var(--secondary-foreground)/.8)]">open now</p></div>
          <div className="rounded-xl bg-[#f8dcd6] px-3 py-2"><p className="mono-face text-base">{child.missedAssignments}</p><p className="text-[#93473a]">missed</p></div>
        </div>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-3 rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--background)/.4)] p-4">
        <UserRound size={15} className="text-[hsl(var(--accent-foreground))]" />
        <div>
          <p className="text-[11px] font-bold text-[hsl(var(--muted-foreground))]">Learner login username</p>
          <p data-testid={`text-child-username-${child.learner.id}`} className="mono-face text-sm font-medium">{child.learner.username}</p>
        </div>
        <ParentButton
          variant="secondary"
          disabled={reset.isPending}
          data-testid={`button-reset-password-${child.learner.id}`}
          className="ml-auto"
          onClick={() => reset.mutate({ learnerId: child.learner.id }, { onSuccess: (data) => setResetCreds(data.credentials) })}
        >
          <RotateCcw size={14} />{reset.isPending ? 'Resetting…' : "Reset child's password"}
        </ParentButton>
      </div>
      {resetCreds && (
        <div data-testid={`panel-reset-${child.learner.id}`} className="mt-3 rounded-2xl border border-[#b7d8c3] bg-[#edf7f0] p-4 text-xs text-[#2b5e40]">
          <p className="font-bold">New password for {child.learner.fullName} — shown once</p>
          <p className="mono-face mt-1">Username: {resetCreds.username} · Password: {resetCreds.password}</p>
          <p className="mt-1">Share this with your child; their old password no longer works.</p>
        </div>
      )}
      {reset.isError && <p data-testid={`status-reset-error-${child.learner.id}`} className="mt-2 text-xs font-semibold text-[#93473a]">{errorText(reset.error)}</p>}

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-[hsl(var(--border))] p-5">
          <div className="flex items-center justify-between">
            <p className="text-xs font-bold text-[hsl(var(--muted-foreground))]">Learning style</p>
            <BarChart3 size={15} className="text-[hsl(var(--accent-foreground))]" />
          </div>
          <p data-testid={`text-child-style-${child.learner.id}`} className="mt-2 text-lg font-bold">{child.learningStyle}</p>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[hsl(var(--muted))]"><div className="h-full rounded-full bg-[hsl(var(--accent))]" style={{ width: `${child.confidence}%` }} /></div>
          <p className="mt-2 text-[11px] text-[hsl(var(--muted-foreground))]">{child.confidence}% confidence · {child.submissionCount} submissions</p>
          {child.activeGaps.length > 0 && (
            <div className="mt-4">
              <p className="text-xs font-bold text-[hsl(var(--muted-foreground))]">Current gaps</p>
              <div className="mt-2 flex flex-wrap gap-2">{child.activeGaps.map((gap) => <span key={gap} className="rounded-full bg-[#f7e8be] px-2.5 py-1 text-[11px] font-bold text-[#74551f]">{gap}</span>)}</div>
            </div>
          )}
        </div>
        <ActivityCard learnerId={child.learner.id} activity={child.activity} />
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-[hsl(var(--border))] p-5">
          <div className="flex items-center justify-between">
            <p className="text-xs font-bold text-[hsl(var(--muted-foreground))]">Recent activity</p>
            <Sparkles size={15} className="text-[hsl(var(--accent-foreground))]" />
          </div>
          {!child.recentActivity.length ? (
            <p className="mt-3 text-xs text-[hsl(var(--muted-foreground))]">Nothing yet — once your child completes an assignment, their progress appears here.</p>
          ) : (
            <div className="mt-3 space-y-2.5">
              {child.recentActivity.map((activity) => (
                <div key={activity.id} className="flex items-start justify-between gap-3 text-xs">
                  <div>
                    <p className="font-semibold">{activity.label}</p>
                    <p className="text-[hsl(var(--muted-foreground))]">{activity.subject} · {formatDate(activity.timestamp)}</p>
                  </div>
                  <span className="mono-face shrink-0 font-medium">{activity.score}%</span>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="rounded-2xl border border-[hsl(var(--border))] p-5">
          <div className="flex items-center justify-between">
            <p className="text-xs font-bold text-[hsl(var(--muted-foreground))]">Completed work</p>
            <BookOpen size={15} className="text-[hsl(var(--accent-foreground))]" />
          </div>
          {!child.assignmentHistory.length ? (
            <p className="mt-3 text-xs text-[hsl(var(--muted-foreground))]">No completed assignments yet.</p>
          ) : (
            <div className="mt-3 space-y-2">
              {child.assignmentHistory.map((entry) => (
                <div key={entry.submissionId} className="flex items-center justify-between gap-3 rounded-xl bg-[hsl(var(--muted)/.6)] px-3 py-2 text-xs">
                  <div className="min-w-0">
                    <p className="truncate font-semibold">{entry.title}</p>
                    <p className="text-[hsl(var(--muted-foreground))]">{entry.subject} · {formatDate(entry.submittedAt)} · {entry.score}%</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setScriptAssignmentId(entry.assignmentId)}
                    data-testid={`button-view-script-${entry.submissionId}`}
                    className="shrink-0 rounded-lg border border-[hsl(var(--border))] px-2.5 py-1.5 text-[11px] font-bold hover:border-[hsl(var(--accent))]"
                  >
                    Review answers
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="mt-6">
        <div className="mb-3 flex items-center gap-2"><BookOpen size={15} className="text-[hsl(var(--accent-foreground))]" /><p className="text-xs font-bold text-[hsl(var(--muted-foreground))]">Subjects and curriculum</p></div>
        <div className="grid gap-3 sm:grid-cols-2">
          {child.classes.map((classEntry) => <ClassCurriculum key={classEntry.id} classEntry={classEntry} />)}
        </div>
      </div>

      <div className="mt-6 flex flex-wrap items-end gap-3 rounded-2xl border border-[hsl(var(--border))] p-4">
        <CalendarClock size={15} className="mb-3 text-[hsl(var(--accent-foreground))]" />
        <label className="block">
          <span className="mb-1.5 block text-xs font-bold text-[hsl(var(--muted-foreground))]">Assignment window</span>
          <select value={windowDays} onChange={(event) => setWindowDays(event.target.value)} data-testid={`select-window-${child.learner.id}`} className="rounded-xl border border-[hsl(var(--input))] bg-[hsl(var(--background)/.55)] px-3.5 py-2.5 text-sm outline-none focus:border-[hsl(var(--accent))]">
            {WINDOW_OPTIONS.map((days) => <option key={days} value={days}>{days} days</option>)}
          </select>
        </label>
        <ParentButton
          variant="secondary"
          disabled={update.isPending}
          data-testid={`button-save-window-${child.learner.id}`}
          onClick={() => update.mutate({ learnerId: child.learner.id, assignmentWindowDays: Number(windowDays) }, { onSuccess: () => setWindowSaved(true) })}
        >
          {update.isPending ? 'Saving…' : windowSaved ? 'Saved' : 'Save window'}
        </ParentButton>
      </div>
    </section>
  );
}

export function ParentDashboard() {
  const dashboard = useParentDashboard();
  const [credentials, setCredentials] = useState<{ credentials: FamilyCredentials; name: string } | null>(null);
  if (dashboard.isLoading) {
    return <div className="flex min-h-[40vh] items-center justify-center"><Loader2 size={22} className="animate-spin text-[hsl(var(--accent-foreground))]" /></div>;
  }
  if (dashboard.isError || !dashboard.data) {
    return <p data-testid="status-parent-dashboard-error" className="rounded-2xl border border-[#dfa79b] bg-[#fff4f1] p-5 text-sm font-semibold text-[#93473a]">{errorText(dashboard.error)}</p>;
  }
  return (
    <div className="space-y-6">
      <div>
        <p className="mono-face text-[11px] uppercase tracking-[.2em] text-[hsl(var(--accent-foreground)/.75)]">Parent dashboard</p>
        <h1 className="display-face mt-2 text-3xl font-bold tracking-[-.04em]">Your child's learning, at a glance</h1>
        <p className="mt-2 text-sm text-[hsl(var(--muted-foreground))]">Slate is running in Independent mode — it generates assignments from the curriculum, marks them, and adjusts the pace to your child.</p>
      </div>
      {credentials && <CredentialsPanel credentials={credentials.credentials} fullName={credentials.name} />}
      {dashboard.data.children.map((child) => <ChildCard key={child.learner.id} child={child} />)}
      <AddChildForm onCreated={(created, name) => setCredentials({ credentials: created, name })} />
    </div>
  );
}
