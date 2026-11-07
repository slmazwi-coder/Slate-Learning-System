import { Activity, AlertTriangle, BarChart3, CheckCircle2, ClipboardCheck, Flame, Info, Target, TrendingUp } from 'lucide-react';

// Product demonstrations for the public homepage.
//
// Every value below is SAMPLE data written for illustration. Nothing here is
// read from the API, and no learner's name, work, marks or identifiers appear.
// The components mirror the shape of the real screens (the learner classroom,
// the teacher zone view, the parent dashboard and the learning profile) so the
// picture is honest about what the product does without exposing anyone.

export function SampleBadge({ className }: { className?: string }) {
  return (
    <span
      data-testid="badge-sample-data"
      className={`inline-flex items-center gap-1.5 rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--muted))] px-2.5 py-1 text-[10px] font-bold uppercase tracking-[.14em] text-[hsl(var(--muted-foreground))] ${className ?? ''}`}
    >
      <Info size={12} />Sample data — illustration only
    </span>
  );
}

function Frame({ title, subtitle, children, testId }: { title: string; subtitle: string; children: React.ReactNode; testId: string }) {
  return (
    <div data-testid={testId} className="overflow-hidden rounded-[1.75rem] border border-[hsl(var(--border))] bg-[hsl(var(--card))] shadow-md">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[hsl(var(--border))] px-5 py-4">
        <div>
          <p className="text-sm font-bold">{title}</p>
          <p className="mt-0.5 text-xs text-[hsl(var(--muted-foreground))]">{subtitle}</p>
        </div>
        <SampleBadge />
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

// ---- Learner experience ---------------------------------------------------

const SAMPLE_SUBJECTS = [
  { subject: 'Mathematics', average: 82, open: 2, missed: 0, gap: null as string | null },
  { subject: 'Natural Sciences', average: 61, open: 1, missed: 1, gap: 'Matter and materials' },
  { subject: 'English', average: 74, open: 1, missed: 0, gap: null },
];

const SAMPLE_LIVE_WORK = [
  { title: 'Fractions: equivalent parts', subject: 'Mathematics', due: 'Closes in 2 days' },
  { title: 'Matter and materials: revision', subject: 'Natural Sciences', due: 'Closes tomorrow' },
];

export function LearnerExperienceDemo() {
  return (
    <Frame testId="demo-learner" title="A learner's classrooms" subtitle="Sample learner · Grade 8" >
      <div className="grid gap-3 sm:grid-cols-3">
        {SAMPLE_SUBJECTS.map((row) => (
          <div key={row.subject} className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--background)/.5)] p-4">
            <p className="font-bold">{row.subject}</p>
            <p className="mono-face mt-2 text-2xl">{row.average}%</p>
            <p className="text-[11px] text-[hsl(var(--muted-foreground))]">subject average</p>
            <div className="mt-3 flex flex-wrap gap-2 text-[10px] font-bold">
              <span className="rounded-full bg-[hsl(var(--secondary))] px-2 py-1 text-[hsl(var(--secondary-foreground))]">{row.open} open</span>
              {row.missed > 0 && <span className="rounded-full bg-[#f7e8be] px-2 py-1 text-[#74551f]">{row.missed} missed</span>}
              {row.gap && <span className="rounded-full bg-[#f8dcd6] px-2 py-1 text-[#93473a]">gap: {row.gap}</span>}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-5 rounded-2xl bg-[hsl(var(--primary))] p-5 text-[hsl(var(--primary-foreground))]">
        <div className="flex items-center gap-2">
          <Target size={16} className="text-[hsl(var(--accent))]" />
          <p className="text-xs font-bold uppercase tracking-wider text-[hsl(var(--accent))]">Your next focus</p>
        </div>
        <p className="display-face mt-3 text-2xl font-bold tracking-[-.03em]">Fractions: equivalent parts</p>
        <p className="mt-2 text-sm text-[hsl(var(--primary-foreground)/.7)]">A short activity, chosen from where the class is and where you are.</p>
      </div>

      <div className="mt-5">
        <p className="mono-face text-[10px] uppercase tracking-[.16em] text-[hsl(var(--muted-foreground))]">Live work</p>
        <div className="mt-3 space-y-2">
          {SAMPLE_LIVE_WORK.map((item) => (
            <div key={item.title} className="flex items-center justify-between gap-3 rounded-xl border border-[hsl(var(--border))] px-3 py-2.5 text-sm">
              <div className="flex min-w-0 items-center gap-2">
                <Activity size={15} className="shrink-0 text-[hsl(var(--accent-foreground))]" />
                <span className="truncate font-bold">{item.title}</span>
              </div>
              <span className="shrink-0 text-[11px] text-[hsl(var(--muted-foreground))]">{item.due}</span>
            </div>
          ))}
        </div>
      </div>
    </Frame>
  );
}

// ---- Teacher intelligence -------------------------------------------------

const SAMPLE_ZONES = [
  { band: 'On track', count: 18, tone: 'bg-[#d9efe0] text-[#1d6b3c]' },
  { band: 'Watch', count: 7, tone: 'bg-[#f7e8be] text-[#74551f]' },
  { band: 'Needs support', count: 4, tone: 'bg-[#f8dcd6] text-[#93473a]' },
  { band: 'Not enough data', count: 3, tone: 'bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))]' },
];

export function TeacherIntelligenceDemo() {
  return (
    <Frame testId="demo-teacher" title="Class intelligence" subtitle="Sample class · Grade 8 Mathematics · 32 learners">
      <div className="grid gap-3 sm:grid-cols-4">
        {SAMPLE_ZONES.map((zone) => (
          <div key={zone.band} className={`rounded-2xl px-3 py-2.5 text-center ${zone.tone}`}>
            <p className="mono-face text-xl font-bold">{zone.count}</p>
            <p className="text-[11px] font-bold">{zone.band}</p>
          </div>
        ))}
      </div>
      <p className="mt-2 text-[11px] text-[hsl(var(--muted-foreground))]">Zones are indicative only and are never a promotion decision.</p>

      <div className="mt-4 flex items-start gap-3 rounded-2xl border border-[#e9c3b8] bg-[#fff4f1] p-3">
        <AlertTriangle size={16} className="mt-0.5 shrink-0 text-[#93473a]" />
        <p className="text-sm text-[#7d4a41]"><span className="font-bold">Class gap detected:</span> equivalent fractions — 64% of assessed learners are struggling with this concept.</p>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div className="rounded-2xl border border-[hsl(var(--border))] p-4">
          <div className="flex items-center gap-2 text-[hsl(var(--accent-foreground))]"><ClipboardCheck size={16} /><p className="text-sm font-bold">Memo-based marking</p></div>
          <p className="mt-2 text-xs leading-5 text-[hsl(var(--muted-foreground))]">Every numbered question carries a model answer and a marking method, so marks are awarded against the memorandum.</p>
        </div>
        <div className="rounded-2xl border border-[hsl(var(--border))] p-4">
          <div className="flex items-center gap-2 text-[hsl(var(--accent-foreground))]"><BarChart3 size={16} /><p className="text-sm font-bold">HOD oversight</p></div>
          <p className="mt-2 text-xs leading-5 text-[hsl(var(--muted-foreground))]">Heads of department see class averages, zones and concept gaps as counts only — never named learners, unless the teacher allows it.</p>
        </div>
      </div>

      <div className="mt-4 rounded-2xl border border-dashed border-[hsl(var(--border))] bg-[hsl(var(--background)/.5)] p-4">
        <p className="mono-face text-[10px] uppercase tracking-[.16em] text-[hsl(var(--muted-foreground))]">Red-pen script</p>
        <div className="mt-3 space-y-2 text-sm">
          <div className="flex items-start justify-between gap-3">
            <div><p className="font-bold">Q3</p><p className="text-[hsl(var(--muted-foreground))]">Learner answer: &ldquo;two quarters make a half&rdquo;</p></div>
            <span className="mono-face shrink-0 font-bold text-[#1d6b3c]">2/2</span>
          </div>
          <div className="flex items-start justify-between gap-3">
            <div><p className="font-bold">Q4</p><p className="text-[hsl(var(--muted-foreground))]">Learner answer: &ldquo;one third&rdquo;</p></div>
            <span className="mono-face shrink-0 font-bold text-[#93473a]">0/2</span>
          </div>
        </div>
        <p className="mt-3 text-[11px] text-[hsl(var(--muted-foreground))]">A marked script shows the learner's answers and marks only — never the memorandum.</p>
      </div>
    </Frame>
  );
}

// ---- Parent involvement ---------------------------------------------------

const SAMPLE_CHILDREN = [
  { name: 'Sample child A', grade: 'Grade 8', phrase: 'Doing well', tone: 'bg-[#d9efe0] text-[#1d6b3c]', active: 'Active 4 of the last 7 days' },
  { name: 'Sample child B', grade: 'Grade 5', phrase: 'Worth a look together', tone: 'bg-[#f7e8be] text-[#74551f]', active: 'Last active today' },
];

export function ParentInvolvementDemo() {
  return (
    <Frame testId="demo-parent" title="Parent view" subtitle="Plain language, no numbers to decode">
      <div className="grid gap-3 sm:grid-cols-2">
        {SAMPLE_CHILDREN.map((child) => (
          <div key={child.name} className="rounded-2xl border border-[hsl(var(--border))] p-4">
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="font-bold">{child.name}</p>
                <p className="text-[11px] text-[hsl(var(--muted-foreground))]">{child.grade}</p>
              </div>
              <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold ${child.tone}`}>{child.phrase}</span>
            </div>
            <div className="mt-3 flex items-center gap-2 text-xs text-[hsl(var(--muted-foreground))]">
              <Flame size={14} />{child.active}
            </div>
          </div>
        ))}
      </div>
      <div className="mt-4 rounded-2xl bg-[hsl(var(--secondary)/.6)] p-4 text-sm text-[hsl(var(--secondary-foreground))]">
        <p className="font-bold">What you can do here</p>
        <p className="mt-1 leading-6">See how often each child is working, read a plain summary of how they are doing, and open a marked script when the teacher has released it.</p>
      </div>
      <p className="mt-3 text-[11px] text-[hsl(var(--muted-foreground))]">A parent sees only their own children, and only work the teacher has released.</p>
    </Frame>
  );
}

// ---- The intelligence engine ---------------------------------------------

const SAMPLE_SIGNALS = [
  { label: 'Quiz-responsive', detail: 'Highest average on quiz-format work', tone: 'bg-[hsl(var(--accent))] text-[hsl(var(--accent-foreground))]' },
  { label: 'Contextual', detail: 'Does well when a task has a real-world example', tone: 'bg-[hsl(var(--secondary))] text-[hsl(var(--secondary-foreground))]' },
  { label: 'Logic-pattern', detail: 'Steady on step-by-step puzzle work', tone: 'bg-[#f7e8be] text-[#74551f]' },
];

const SAMPLE_WORKED = [
  'Equivalent fractions — improved after two short activities',
  'Matter and materials — a second explanation helped',
];

export function IntelligenceEngineDemo() {
  return (
    <Frame testId="demo-engine" title="How SLATE reads learning" subtitle="Patterns noticed from recent work">
      <div className="grid gap-3 sm:grid-cols-3">
        {SAMPLE_SIGNALS.map((signal) => (
          <div key={signal.label} className="rounded-2xl border border-[hsl(var(--border))] p-4">
            <span className={`inline-block rounded-full px-2.5 py-1 text-[10px] font-bold ${signal.tone}`}>{signal.label}</span>
            <p className="mt-3 text-xs leading-5 text-[hsl(var(--muted-foreground))]">{signal.detail}</p>
          </div>
        ))}
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div className="rounded-2xl border border-[hsl(var(--border))] p-4">
          <div className="flex items-center gap-2 text-[hsl(var(--accent-foreground))]"><CheckCircle2 size={16} /><p className="text-sm font-bold">What has worked recently</p></div>
          <ul className="mt-3 space-y-2 text-xs text-[hsl(var(--muted-foreground))]">
            {SAMPLE_WORKED.map((item) => <li key={item} className="flex gap-2"><TrendingUp size={14} className="mt-0.5 shrink-0 text-[#1d6b3c]" />{item}</li>)}
          </ul>
        </div>
        <div className="rounded-2xl border border-[hsl(var(--border))] p-4">
          <div className="flex items-center gap-2 text-[hsl(var(--accent-foreground))]"><Target size={16} /><p className="text-sm font-bold">Active concept gaps</p></div>
          <div className="mt-3 flex flex-wrap gap-2">
            {['Equivalent fractions', 'Ratio and rate'].map((gap) => (
              <span key={gap} className="rounded-full bg-[#f7e8be] px-3 py-1.5 text-xs font-bold text-[#74551f]">{gap}</span>
            ))}
          </div>
        </div>
      </div>

      <p data-testid="text-engine-caveat" className="mt-4 rounded-2xl bg-[hsl(var(--muted))] p-3 text-xs leading-5 text-[hsl(var(--muted-foreground))]">
        These are patterns SLATE notices from a learner's recent work — what they have done well and where they need
        another look. They are not fixed labels: they change as the work changes, and they are never a measure of who a
        learner is.
      </p>
    </Frame>
  );
}
