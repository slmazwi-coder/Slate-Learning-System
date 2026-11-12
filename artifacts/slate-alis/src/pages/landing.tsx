import { lazy, Suspense, useEffect } from 'react';
import { Link, useLocation } from 'wouter';
import {
  ArrowRight,
  BarChart3,
  BookOpen,
  Clock3,
  Compass,
  GraduationCap,
  HeartPulse,
  Layers,
  LockKeyhole,
  MessageCircle,
  PenLine,
  Presentation,
  Sparkles,
  Target,
  TrendingUp,
  Users,
} from 'lucide-react';
import { PublicShell } from '@/components/public-shell';
import { LearningLoop } from '@/components/learning-loop';
import { getGetCurrentLearnerQueryKey, useGetCurrentLearner } from '@workspace/api-client-react';
import { supportUrl, useSupportConfig } from '@/lib/support';

// The public homepage. It presents SLATE as an education system rather than a
// homework app: a connected loop of learning, assessment, analysis and support
// for learners, teachers, parents and tutors.
//
// Every capability named in "The SLATE approach" through "The intelligence
// engine" is implemented in this repository; docs/landing-claims.md lists the
// file that proves each one. Anything not yet built is kept in the "Becoming"
// section and labelled as such. The demonstrations below use SAMPLE data only —
// no learner's name, work or marks appear anywhere on this page.

// Lazy-loaded so the heavy demonstration panels never delay the first paint.
const LearnerExperienceDemo = lazy(() => import('@/components/landing-demos').then((m) => ({ default: m.LearnerExperienceDemo })));
const TeacherIntelligenceDemo = lazy(() => import('@/components/landing-demos').then((m) => ({ default: m.TeacherIntelligenceDemo })));
const ParentInvolvementDemo = lazy(() => import('@/components/landing-demos').then((m) => ({ default: m.ParentInvolvementDemo })));
const IntelligenceEngineDemo = lazy(() => import('@/components/landing-demos').then((m) => ({ default: m.IntelligenceEngineDemo })));

function DemoFallback({ label }: { label: string }) {
  return (
    <div className="flex min-h-[220px] items-center justify-center rounded-[1.75rem] border border-dashed border-[hsl(var(--border))] bg-[hsl(var(--card))] p-6">
      <p className="mono-face text-xs text-[hsl(var(--muted-foreground))]">{label}</p>
    </div>
  );
}

function SectionHeading({ id, eyebrow, title, detail }: { id: string; eyebrow: string; title: string; detail?: string }) {
  return (
    <div className="max-w-3xl">
      <p className="mono-face text-[11px] font-medium uppercase tracking-[.22em] text-[hsl(var(--accent-foreground)/.75)]">{eyebrow}</p>
      <h2 id={id} className="display-face mt-4 text-3xl font-bold leading-[1.05] tracking-[-.04em] sm:text-4xl lg:text-5xl">{title}</h2>
      {detail && <p className="mt-4 text-base leading-7 text-[hsl(var(--muted-foreground))]">{detail}</p>}
    </div>
  );
}

function Section({ id, labelledBy, className, children, 'data-surface': dataSurface }: { id?: string; labelledBy: string; className?: string; children: React.ReactNode; 'data-surface'?: string }) {
  return (
    <section id={id} aria-labelledby={labelledBy} data-surface={dataSurface} className={className ?? 'mx-auto w-full max-w-7xl px-5 py-16 sm:px-8 lg:py-24'}>
      {children}
    </section>
  );
}

// ---- Section 1: hero ------------------------------------------------------

function Hero() {
  return (
    <Section labelledBy="hero-title" className="mx-auto w-full max-w-7xl px-5 pb-16 pt-10 sm:px-8 sm:pt-14 lg:pb-24 lg:pt-20">
      <div className="grid gap-12 lg:grid-cols-[1.05fr_.95fr] lg:items-center lg:gap-16">
        <div className="rise-in">
          <div className="mb-7 inline-flex items-center gap-2 rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 py-1.5 text-xs font-bold text-[hsl(var(--muted-foreground))]">
            <span className="pulse-soft size-2 rounded-full bg-[hsl(var(--accent))]" aria-hidden="true" />Schoolwork untangled.
          </div>
          <h1 id="hero-title" className="display-face max-w-2xl text-4xl font-bold leading-[1.02] tracking-[-.05em] sm:text-6xl lg:text-7xl">
            Every learner is different. <span className="text-[hsl(var(--accent-foreground))]">Their learning system should be too.</span>
          </h1>
          <p className="mt-7 max-w-xl text-base leading-7 text-[hsl(var(--muted-foreground))] sm:text-lg">
            SLATE connects learners, teachers and parents through a deeper understanding of how learning happens — so
            every learner gets a path that fits them.
          </p>
          <div className="mt-9 flex flex-wrap items-center gap-3">
            <Link
              href="/register"
              data-testid="link-hero-start-free"
              className="group inline-flex items-center gap-2.5 whitespace-nowrap rounded-lg bg-[hsl(var(--primary))] px-5 py-3.5 text-sm font-bold text-[hsl(var(--primary-foreground))] shadow-md transition-transform hover:-translate-y-0.5"
            >
              Start free <ArrowRight size={17} className="transition-transform group-hover:translate-x-1" aria-hidden="true" />
            </Link>
            <a
              href="#how-it-works"
              data-testid="link-hero-how-it-works"
              className="inline-flex items-center gap-2 whitespace-nowrap rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-5 py-3.5 text-sm font-bold text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))]"
            >
              See how it works
            </a>
          </div>
          <p data-testid="text-free-until" className="mt-5 text-sm font-semibold text-[hsl(var(--muted-foreground))]">
            Free to use until January 2027.
          </p>
        </div>

        <div className="rise-in delay-2 relative">
          <div className="absolute -inset-8 rounded-[4rem] bg-[hsl(var(--secondary)/.55)] blur-3xl" aria-hidden="true" />
          <div className="relative overflow-hidden rounded-[2.25rem] border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-6 shadow-xl sm:p-8">
            <div className="flex items-center gap-2 text-[hsl(var(--accent-foreground))]">
              <Layers size={18} aria-hidden="true" />
              <p className="mono-face text-[10px] uppercase tracking-[.16em]">One connected loop</p>
            </div>
            <p className="display-face mt-4 text-2xl font-bold leading-snug tracking-[-.03em]">
              Learning, assessment, analysis and support — working together, not in separate boxes.
            </p>
            <ul className="mt-6 space-y-3 text-sm text-[hsl(var(--muted-foreground))]">
              <li className="flex items-start gap-2.5"><BookOpen size={16} className="mt-0.5 shrink-0 text-[hsl(var(--accent-foreground))]" aria-hidden="true" />A learner's work feeds their next step.</li>
              <li className="flex items-start gap-2.5"><BarChart3 size={16} className="mt-0.5 shrink-0 text-[hsl(var(--accent-foreground))]" aria-hidden="true" />A teacher sees where the class is, and who needs them first.</li>
              <li className="flex items-start gap-2.5"><Users size={16} className="mt-0.5 shrink-0 text-[hsl(var(--accent-foreground))]" aria-hidden="true" />A parent gets a plain summary, in words.</li>
            </ul>
            <LearningLoop className="mt-6" />
          </div>
        </div>
      </div>
    </Section>
  );
}

// ---- Section 2: the problem ----------------------------------------------

const PROBLEMS = [
  {
    icon: Users,
    title: 'Large classes, one lesson',
    detail: 'A single class can hold forty learners at very different places in the same subject. One pace serves the middle and loses both ends.',
  },
  {
    icon: Clock3,
    title: 'Gaps found too late',
    detail: 'By the time a gap shows up in a report, the term has moved on. The learner has been quietly falling behind for weeks.',
  },
  {
    icon: HeartPulse,
    title: 'Feedback that arrives too late to help',
    detail: 'A mark without a reason tells a learner what happened, not what to do next — so the same mistake comes back.',
  },
];

function Problem() {
  return (
    <Section id="the-problem" labelledBy="problem-title" className="border-t border-[hsl(var(--border))] bg-[hsl(var(--secondary)/.35)]">
      <div className="mx-auto w-full max-w-7xl px-5 py-16 sm:px-8 lg:py-24">
        <SectionHeading
          id="problem-title"
          eyebrow="The problem"
          title="One-size-fits-all learning fails the learners it cannot see."
          detail="The difficulty is rarely effort. It is that a single path through the work cannot match every learner in the room — and the signs of a gap arrive long after the lesson has passed."
        />
        <div className="mt-12 grid gap-5 md:grid-cols-3">
          {PROBLEMS.map(({ icon: Icon, title, detail }) => (
            <div key={title} className="rounded-[1.5rem] border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-6">
              <span className="grid size-11 place-items-center rounded-2xl bg-[hsl(var(--secondary))] text-[hsl(var(--secondary-foreground))]"><Icon size={20} aria-hidden="true" /></span>
              <h3 className="mt-5 text-lg font-bold">{title}</h3>
              <p className="mt-2 text-sm leading-6 text-[hsl(var(--muted-foreground))]">{detail}</p>
            </div>
          ))}
        </div>
      </div>
    </Section>
  );
}

// ---- Section 3: the SLATE approach ---------------------------------------

const LOOP = [
  {
    icon: BookOpen,
    title: 'Learning',
    detail: 'Learners work through their subjects in a classroom per subject, with the next step chosen from where the class is and where they are.',
  },
  {
    icon: PenLine,
    title: 'Assessment',
    detail: 'Work is marked against a memorandum the teacher controls, with a marked script that shows each answer and its marks.',
  },
  {
    icon: BarChart3,
    title: 'Analysis',
    detail: 'Results fold into class zones and concept gaps, so a teacher can see the shape of the class, not just a list of marks.',
  },
  {
    icon: HeartPulse,
    title: 'Support',
    detail: 'A detected gap becomes a short, targeted activity — the same loop, pointed back at the learner who needs it.',
  },
];

function Approach() {
  return (
    <Section id="how-it-works" labelledBy="approach-title" className="border-t border-[hsl(var(--border))]">
      <div className="mx-auto w-full max-w-7xl px-5 py-16 sm:px-8 lg:py-24">
        <SectionHeading
          id="approach-title"
          eyebrow="The SLATE approach"
          title="Learning, assessment, analysis and support — one connected loop."
          detail="Each part feeds the next. What a learner does becomes what a teacher can see; what a teacher sees becomes the support a learner gets."
        />
        <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {LOOP.map(({ icon: Icon, title, detail }, index) => (
            <div key={title} className="rounded-[1.5rem] border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-6">
              <div className="flex items-center justify-between">
                <span className="grid size-11 place-items-center rounded-2xl bg-[hsl(var(--accent))] text-[hsl(var(--accent-foreground))]"><Icon size={20} aria-hidden="true" /></span>
                <span className="mono-face text-xs text-[hsl(var(--accent-foreground)/.7)]">0{index + 1}</span>
              </div>
              <h3 className="mt-5 text-lg font-bold">{title}</h3>
              <p className="mt-2 text-sm leading-6 text-[hsl(var(--muted-foreground))]">{detail}</p>
            </div>
          ))}
        </div>
      </div>
    </Section>
  );
}

// ---- Section 4: learner experience ---------------------------------------

function LearnerExperience() {
  return (
    <Section id="for-learners" labelledBy="learner-title" className="border-t border-[hsl(var(--border))] bg-[hsl(var(--secondary)/.35)]">
      <div className="mx-auto w-full max-w-7xl px-5 py-16 sm:px-8 lg:py-24">
        <div className="grid gap-10 lg:grid-cols-[.9fr_1.1fr] lg:items-center lg:gap-16">
          <div>
            <SectionHeading
              id="learner-title"
              eyebrow="For learners"
              title="A learning space that knows the next step."
              detail="Each subject has its own classroom. A learner sees what is live, what is coming, and one useful next step — with feedback that explains the mark."
            />
            <ul className="mt-8 space-y-3 text-sm text-[hsl(var(--muted-foreground))]">
              <li className="flex items-start gap-2.5"><Compass size={16} className="mt-0.5 shrink-0 text-[hsl(var(--accent-foreground))]" aria-hidden="true" />A subject classroom for every class they have joined.</li>
              <li className="flex items-start gap-2.5"><Target size={16} className="mt-0.5 shrink-0 text-[hsl(var(--accent-foreground))]" aria-hidden="true" />A single "next focus" chosen from their own gaps.</li>
              <li className="flex items-start gap-2.5"><GraduationCap size={16} className="mt-0.5 shrink-0 text-[hsl(var(--accent-foreground))]" aria-hidden="true" />A marked script with each answer and its marks.</li>
            </ul>
          </div>
          <Suspense fallback={<DemoFallback label="Loading learner demonstration…" />}>
            <LearnerExperienceDemo />
          </Suspense>
        </div>
      </div>
    </Section>
  );
}

// ---- Section 5: teacher intelligence -------------------------------------

function TeacherIntelligence() {
  return (
    <Section id="for-teachers" labelledBy="teacher-title" className="border-t border-[hsl(var(--border))]">
      <div className="mx-auto w-full max-w-7xl px-5 py-16 sm:px-8 lg:py-24">
        <div className="grid gap-10 lg:grid-cols-[1.1fr_.9fr] lg:items-center lg:gap-16">
          <div className="order-2 lg:order-1">
            <Suspense fallback={<DemoFallback label="Loading teacher demonstration…" />}>
              <TeacherIntelligenceDemo />
            </Suspense>
          </div>
          <div className="order-1 lg:order-2">
            <SectionHeading
              id="teacher-title"
              eyebrow="For teachers"
              title="Class intelligence, not just a mark book."
              detail="A teacher sees where the class is, which concept is tripping people up, and who needs them first — without losing the paper trail."
            />
            <ul className="mt-8 space-y-3 text-sm text-[hsl(var(--muted-foreground))]">
              <li className="flex items-start gap-2.5"><BarChart3 size={16} className="mt-0.5 shrink-0 text-[hsl(var(--accent-foreground))]" aria-hidden="true" />Performance zones and class concept-gap alerts.</li>
              <li className="flex items-start gap-2.5"><PenLine size={16} className="mt-0.5 shrink-0 text-[hsl(var(--accent-foreground))]" aria-hidden="true" />Memo-based marking with a printable red-pen script.</li>
              <li className="flex items-start gap-2.5"><Presentation size={16} className="mt-0.5 shrink-0 text-[hsl(var(--accent-foreground))]" aria-hidden="true" />Head-of-department oversight at class level, as counts only.</li>
              <li className="flex items-start gap-2.5"><LockKeyhole size={16} className="mt-0.5 shrink-0 text-[hsl(var(--accent-foreground))]" aria-hidden="true" />Results stay held until the teacher releases them.</li>
            </ul>
          </div>
        </div>
      </div>
    </Section>
  );
}

// ---- Section 6: parent involvement ---------------------------------------

function ParentInvolvement() {
  return (
    <Section id="for-parents" labelledBy="parent-title" className="border-t border-[hsl(var(--border))] bg-[hsl(var(--secondary)/.35)]">
      <div className="mx-auto w-full max-w-7xl px-5 py-16 sm:px-8 lg:py-24">
        <div className="grid gap-10 lg:grid-cols-[.9fr_1.1fr] lg:items-center lg:gap-16">
          <div>
            <SectionHeading
              id="parent-title"
              eyebrow="For parents"
              title="A clear view of how your child is doing — in words."
              detail="A parent sees their own child's progress and how often they are working. No jargon, no numbers to decode, and only what the teacher has released."
            />
            <ul className="mt-8 space-y-3 text-sm text-[hsl(var(--muted-foreground))]">
              <li className="flex items-start gap-2.5"><Clock3 size={16} className="mt-0.5 shrink-0 text-[hsl(var(--accent-foreground))]" aria-hidden="true" />How often each child has been active, and when last seen.</li>
              <li className="flex items-start gap-2.5"><HeartPulse size={16} className="mt-0.5 shrink-0 text-[hsl(var(--accent-foreground))]" aria-hidden="true" />A plain-language summary, never a colour or a score to interpret.</li>
              <li className="flex items-start gap-2.5"><LockKeyhole size={16} className="mt-0.5 shrink-0 text-[hsl(var(--accent-foreground))]" aria-hidden="true" />Data controls: export a child's data, or delete it, at any time.</li>
            </ul>
          </div>
          <Suspense fallback={<DemoFallback label="Loading parent demonstration…" />}>
            <ParentInvolvementDemo />
          </Suspense>
        </div>
      </div>
    </Section>
  );
}

// ---- Section 7: the intelligence engine ----------------------------------

function IntelligenceEngine() {
  return (
    <Section id="the-engine" labelledBy="engine-title" className="border-t border-[hsl(var(--border))]">
      <div className="mx-auto w-full max-w-7xl px-5 py-16 sm:px-8 lg:py-24">
        <SectionHeading
          id="engine-title"
          eyebrow="The intelligence engine"
          title="SLATE reads the learning, not the learner's label."
          detail="As work is marked, SLATE keeps track of how a learner is doing on the formats that help them and on the concepts they have met. Over time that becomes a picture of individual needs — one that changes as the work changes."
        />
        <div className="mt-12">
          <Suspense fallback={<DemoFallback label="Loading engine demonstration…" />}>
            <IntelligenceEngineDemo />
          </Suspense>
        </div>
      </div>
    </Section>
  );
}

// ---- Section 8: the bigger vision ----------------------------------------

const BECOMING = [
  { icon: Presentation, title: 'Dedicated SLATE tablets' },
  { icon: GraduationCap, title: 'Career guidance by Grade 12' },
  { icon: PenLine, title: 'Stylus input for handwritten work' },
  { icon: BookOpen, title: 'A native mobile app' },
  { icon: MessageCircle, title: 'A WhatsApp AI agent for learners and parents' },
  { icon: Layers, title: 'Study Desk — a dedicated space for independent study' },
];

function Vision() {
  return (
    <Section id="becoming" labelledBy="vision-title" data-surface="dark" className="border-t border-[hsl(var(--border))] bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]">
      <div className="mx-auto w-full max-w-7xl px-5 py-16 sm:px-8 lg:py-24">
        <div className="flex flex-wrap items-center gap-3">
          <span data-testid="badge-becoming" className="inline-flex items-center gap-2 rounded-full bg-[hsl(var(--accent))] px-3 py-1.5 text-[11px] font-black uppercase tracking-[.16em] text-[hsl(var(--accent-foreground))]">
            <Sparkles size={13} aria-hidden="true" />Becoming
          </span>
          <p className="text-xs font-semibold text-[hsl(var(--primary-foreground)/.7)]">On the roadmap — not available today.</p>
        </div>
        <h2 id="vision-title" className="display-face mt-6 max-w-3xl text-3xl font-bold leading-[1.05] tracking-[-.04em] sm:text-4xl lg:text-5xl">
          A connected, personalised education for every learner.
        </h2>
        <p className="mt-5 max-w-2xl text-base leading-7 text-[hsl(var(--primary-foreground)/.75)]">
          SLATE starts with the loop above. The vision is a system that follows a learner all the way through school —
          understanding more, and helping earlier. These pieces are still being built, and we say so plainly.
        </p>
        <ul data-testid="list-becoming" className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {BECOMING.map(({ icon: Icon, title }) => (
            <li key={title} className="flex items-center gap-3 rounded-2xl border border-[hsl(var(--primary-foreground)/.15)] bg-[hsl(var(--primary-foreground)/.06)] p-4">
              <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-[hsl(var(--accent))] text-[hsl(var(--accent-foreground))]"><Icon size={18} aria-hidden="true" /></span>
              <span className="text-sm font-bold">{title}</span>
            </li>
          ))}
        </ul>
      </div>
    </Section>
  );
}

// ---- Section 9: call to action -------------------------------------------

const START_FREE = [
  { role: 'Teachers', href: '/teacher/register', testId: 'link-cta-teacher' },
  { role: 'Parents', href: '/parent/register', testId: 'link-cta-parent' },
  { role: 'Tutors', href: '/tutor/register', testId: 'link-cta-tutor' },
];

// The pilot link is built from WHATSAPP_SUPPORT_NUMBER, served by the API so it
// can be switched off without a rebuild. The message carries no personal data.
const PILOT_MESSAGE = "Hi Slate, I'd like to request a school pilot for our school. Please tell me what is involved.";

function PilotLink() {
  const config = useSupportConfig();
  if (!config.data?.enabled || !config.data.number) return null;
  return (
    <a
      href={supportUrl(config.data.number, PILOT_MESSAGE)}
      target="_blank"
      rel="noopener noreferrer"
      data-testid="link-school-pilot"
      className="inline-flex items-center gap-2.5 whitespace-nowrap rounded-lg border border-[hsl(var(--primary-foreground)/.3)] bg-[hsl(var(--primary-foreground)/.08)] px-5 py-3.5 text-sm font-bold text-[hsl(var(--primary-foreground))] hover:bg-[hsl(var(--primary-foreground)/.16)]"
    >
      <MessageCircle size={17} aria-hidden="true" />Request a school pilot
    </a>
  );
}

function CallToAction() {
  return (
    <Section id="start" labelledBy="cta-title" className="border-t border-[hsl(var(--border))]">
      <div className="mx-auto w-full max-w-7xl px-5 py-16 sm:px-8 lg:py-24">
        <div data-surface="dark" className="overflow-hidden rounded-[2rem] bg-[hsl(var(--primary))] p-8 text-[hsl(var(--primary-foreground))] shadow-xl sm:p-12">
          <h2 id="cta-title" className="display-face max-w-2xl text-3xl font-bold leading-[1.05] tracking-[-.04em] sm:text-4xl">
            Start free, or bring SLATE to your school.
          </h2>
          <p className="mt-4 max-w-2xl text-base leading-7 text-[hsl(var(--primary-foreground)/.75)]">
            Teachers, parents and tutors can start free today. If you are a school or a department, request a pilot and
            we will walk you through it.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            {START_FREE.map((entry) => (
              <Link
                key={entry.role}
                href={entry.href}
                data-testid={entry.testId}
                className="inline-flex items-center gap-2.5 whitespace-nowrap rounded-lg bg-[hsl(var(--accent))] px-5 py-3.5 text-sm font-bold text-[hsl(var(--accent-foreground))] hover:-translate-y-0.5"
              >
                Start free — {entry.role} <ArrowRight size={16} aria-hidden="true" />
              </Link>
            ))}
            <PilotLink />
          </div>
          <div className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-sm">
            <Link href="/register" data-testid="link-cta-learner" className="font-bold text-[hsl(var(--primary-foreground))] underline underline-offset-4 hover:text-[hsl(var(--accent))]">Learners start free too</Link>
            <Link href="/login" data-testid="link-cta-login" className="font-bold text-[hsl(var(--primary-foreground)/.8)] underline underline-offset-4 hover:text-[hsl(var(--primary-foreground))]">Log in</Link>
            <Link href="/privacy" data-testid="link-cta-privacy" className="font-bold text-[hsl(var(--primary-foreground)/.8)] underline underline-offset-4 hover:text-[hsl(var(--primary-foreground))]">Privacy notice</Link>
          </div>
          <p className="mt-6 text-xs font-semibold text-[hsl(var(--primary-foreground)/.6)]">Free to use until January 2027.</p>
        </div>
      </div>
    </Section>
  );
}

// ---- Page -----------------------------------------------------------------

export function LandingSections() {
  return (
    <main>
      <Hero />
      <Problem />
      <Approach />
      <LearnerExperience />
      <TeacherIntelligence />
      <ParentInvolvement />
      <IntelligenceEngine />
      <Vision />
      <CallToAction />
    </main>
  );
}

// A signed-in learner is taken straight to their dashboard, exactly as the old
// homepage did. The redirect lives here so the public page and the app keep the
// same behaviour.
export function LandingPage() {
  const [, setLocation] = useLocation();
  const current = useGetCurrentLearner({ query: { queryKey: getGetCurrentLearnerQueryKey(), retry: false } });
  useEffect(() => { if (current.data?.learner) setLocation('/dashboard'); }, [current.data, setLocation]);
  if (current.isLoading) {
    return (
      <PublicShell>
        <div className="mx-auto flex min-h-[70vh] max-w-7xl items-center px-5">
          <p className="mono-face text-xs text-[hsl(var(--muted-foreground))]">Opening your learning space…</p>
        </div>
      </PublicShell>
    );
  }
  if (current.data?.learner) return null;
  return (
    <PublicShell>
      <LandingSections />
    </PublicShell>
  );
}
