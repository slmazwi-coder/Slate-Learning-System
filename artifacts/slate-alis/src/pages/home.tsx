import { lazy, Suspense, useEffect, useState, type ReactNode } from 'react';
import { ArrowDown, ArrowRight, BookOpen, BrainCircuit, Check, ChevronRight, Compass, FileCheck2, MessageCircle, Network, ShieldCheck, Sparkles, UsersRound } from 'lucide-react';
import { Link, useLocation } from 'wouter';
import { getGetCurrentLearnerQueryKey, useGetCurrentLearner, useSupportConfig } from '@workspace/api-client-react';
import { PublicShell } from '@/components/public-shell';
import { BrandEmblem } from '@/components/brand';

const LearnerSample = lazy(() => import('./home-demos').then((module) => ({ default: module.LearnerSample })));
const TeacherSample = lazy(() => import('./home-demos').then((module) => ({ default: module.TeacherSample })));
const ParentSample = lazy(() => import('./home-demos').then((module) => ({ default: module.ParentSample })));
const ParentUsageSample = lazy(() => import('./home-demos').then((module) => ({ default: module.ParentUsageSample })));
const HodSample = lazy(() => import('./home-demos').then((module) => ({ default: module.HodSample })));

function DemoPlaceholder() {
  return <div role="status" aria-label="Sample demonstration loads when in view" className="grid h-56 animate-pulse place-items-center rounded-[1.4rem] border border-[hsl(var(--border))] bg-[hsl(var(--muted))] px-5 text-center text-sm font-semibold text-[#43565a]">Sample demo loads when in view</div>;
}

function LazyDemo({ children }: { children: ReactNode }) {
  const [visible, setVisible] = useState(false);
  const [node, setNode] = useState<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!node) return;
    if (!('IntersectionObserver' in window)) {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        setVisible(true);
        observer.disconnect();
      }
    }, { rootMargin: '180px' });
    observer.observe(node);
    return () => observer.disconnect();
  }, [node]);
  return <div ref={setNode}>{visible ? <Suspense fallback={<DemoPlaceholder />}>{children}</Suspense> : <DemoPlaceholder />}</div>;
}

const sections = [
  { id: 'problem', label: 'The challenge' },
  { id: 'approach', label: 'The SLATE approach' },
  { id: 'learner', label: 'Learners' },
  { id: 'teacher', label: 'Teachers' },
  { id: 'parent', label: 'Parents' },
  { id: 'intelligence', label: 'The intelligence engine' },
  { id: 'vision', label: 'The bigger vision' },
];

function SectionMarker({ index, label, tone = 'light' }: { index: string; label: string; tone?: 'light' | 'dark' }) {
  const markerColor = tone === 'dark' ? 'text-[#f0e6c8]' : 'text-[#80632e]';
  const labelColor = tone === 'dark' ? 'text-[#f0e6c8]' : 'text-[#715b2f]';
  const lineColor = tone === 'dark' ? 'bg-[#b4a575]' : 'bg-[#b5a779]';
  return <p className={`mb-5 flex items-center gap-3 text-[11px] font-bold uppercase tracking-[.18em] ${labelColor}`}><span className={`font-mono ${markerColor}`}>{index}</span><span className={`h-px w-8 ${lineColor}`} />{label}</p>;
}

function HomeContent() {
  const [, setLocation] = useLocation();
  const current = useGetCurrentLearner({ query: { queryKey: getGetCurrentLearnerQueryKey(), retry: false } });
  const support = useSupportConfig();
  useEffect(() => {
    if (current.data?.learner) setLocation('/dashboard');
  }, [current.data, setLocation]);

  if (current.isLoading) return <PublicShell><main className="mx-auto max-w-6xl px-5 py-24" aria-label="Opening SLATE"><div className="h-9 w-72 animate-pulse rounded bg-[hsl(var(--muted))]" /><div className="mt-5 h-4 w-56 animate-pulse rounded bg-[hsl(var(--muted))]" /></main></PublicShell>;
  if (current.data?.learner) return null;
  const pilotNumber = support.data?.enabled && support.data.number ? support.data.number.replace(/\D/g, '') : '';
  const pilotHref = pilotNumber
    ? `https://wa.me/${pilotNumber}?text=${encodeURIComponent('Hello SLATE ALIS. I would like to request a school pilot.')}`
    : undefined;

  return (
    <PublicShell>
      <main>
        <section aria-labelledby="hero-heading" className="relative overflow-hidden border-b border-[#d8cfbb]">
          <div className="mx-auto grid max-w-[1320px] gap-12 px-5 pb-16 pt-10 sm:px-8 sm:pb-24 sm:pt-16 lg:grid-cols-[1.08fr_.92fr] lg:items-center lg:gap-16 lg:pt-20">
            <div className="relative z-[1]">
              <div className="mb-7 inline-flex items-center gap-2.5 rounded-full border border-[#cfc5ac] bg-[#f8f4e8] px-3 py-2 text-[11px] font-bold uppercase tracking-[.13em] text-[#4d5a5b]"><span className="grid size-6 place-items-center rounded-full bg-[#183745]"><BrandEmblem className="size-[18px]" /></span>Schoolwork untangled.</div>
              <h1 id="hero-heading" data-testid="section-hero" className="home-serif max-w-[760px] text-[clamp(3.1rem,6.3vw,5.2rem)] font-bold leading-[.96] tracking-[-.055em] text-[#173541]">Every learner is different.<br /><span className="text-[#80632e]">Their learning system</span> should be too.</h1>
              <p className="mt-7 max-w-[600px] text-base leading-7 text-[#334b53] sm:text-lg sm:leading-8">SLATE ALIS is an education system that connects learners, teachers and parents through a deeper understanding of how learning happens.</p>
              <div className="mt-8 flex flex-wrap items-center gap-3">
                <Link href="/register" data-testid="link-start-free-hero" className="inline-flex min-h-12 items-center gap-3 rounded-lg bg-[#183745] px-5 py-3 text-sm font-bold text-[#fff9e9] transition-transform hover:-translate-y-0.5">Start free <ArrowRight size={17} /></Link>
                <a href="#approach" data-testid="link-see-how-it-works" className="inline-flex min-h-12 items-center gap-2 rounded-lg border border-[#a79b7c] bg-[#f6f1e4] px-5 py-3 text-sm font-bold text-[#203d47] hover:bg-[#eee6d3]">See how it works <ArrowDown size={16} /></a>
              </div>
              <p className="mt-5 flex items-center gap-2 text-xs font-semibold text-[#435a5e]"><Check size={14} className="text-[#725b28]" />Free to use until January 2027</p>
            </div>
            <div className="relative mx-auto w-full max-w-[580px]">
              <div aria-hidden="true" className="absolute -right-12 -top-14 size-48 rounded-full border border-[#cdbf9d]" />
              <div aria-hidden="true" className="absolute -bottom-10 -left-7 size-32 rounded-full border border-[#cdbf9d]" />
              <div className="relative rounded-[1.8rem] border border-[#d3c9b3] bg-[#f9f6ed] p-4 shadow-[0_28px_70px_-48px_rgba(22,45,52,.55)] sm:p-6">
                <div className="flex items-center justify-between border-b border-[#ded6c5] pb-4"><div><p className="text-[10px] font-bold uppercase tracking-[.17em] text-[#637176]">One learning community</p><p className="mt-1 font-serif text-lg font-bold text-[#193944]">Work moves. Understanding grows.</p></div><span className="rounded-lg bg-[#e9e1cd] p-2 text-[#66542e]"><Network size={19} /></span></div>
                <div className="relative mt-5 min-h-[245px]">
                  <svg aria-hidden="true" viewBox="0 0 470 220" className="absolute inset-0 h-full w-full">
                    <path className="flow-line" d="M100 104 C160 30 280 35 365 82" fill="none" stroke="#8a7440" strokeWidth="2" />
                    <path className="flow-line" d="M370 115 C310 196 170 190 95 130" fill="none" stroke="#8a7440" strokeWidth="2" />
                    <path className="flow-line" d="M103 110 C180 138 300 145 367 102" fill="none" stroke="#526d67" strokeWidth="1.5" />
                  </svg>
                  <div className="absolute left-[2%] top-[30%] flex w-[34%] flex-col items-center rounded-2xl border border-[#ccd2c4] bg-[#e9eee5] px-3 py-4 text-center"><span className="grid size-10 place-items-center rounded-xl bg-[#d7e1d4] text-[#315342]"><Compass size={19} /></span><b className="mt-2 text-xs text-[#223c43]">Learner</b><small className="mt-1 text-[10px] text-[#4d6260]">Work and feedback</small></div>
                  <div className="absolute right-[1%] top-[7%] flex w-[34%] flex-col items-center rounded-2xl border border-[#d6c9a9] bg-[#f3ead2] px-3 py-4 text-center"><span className="grid size-10 place-items-center rounded-xl bg-[#e9dcb8] text-[#66532b]"><BookOpen size={19} /></span><b className="mt-2 text-xs text-[#413c2d]">Teacher</b><small className="mt-1 text-[10px] text-[#5b594c]">Class understanding</small></div>
                  <div className="absolute bottom-[1%] right-[22%] flex w-[34%] flex-col items-center rounded-2xl border border-[#c8d2d2] bg-[#e8eeee] px-3 py-4 text-center"><span className="grid size-10 place-items-center rounded-xl bg-[#d6e2e2] text-[#31545a]"><UsersRound size={19} /></span><b className="mt-2 text-xs text-[#203e46]">Parent</b><small className="mt-1 text-[10px] text-[#4d6266]">Progress and activity</small></div>
                </div>
                <p className="mt-4 border-t border-[#ded6c5] pt-3 text-center text-[10px] font-semibold text-[#536467]">A connected view of learning work, with each role in its place.</p>
              </div>
            </div>
          </div>
          <div className="absolute bottom-0 left-0 h-1 w-[38%] bg-[#95783b]" />
        </section>

        <nav aria-label="On this page" className="sticky top-0 z-10 border-b border-[#d8cfbb] bg-[#f6f1e4]/95 backdrop-blur-sm">
          <div className="mx-auto flex max-w-[1320px] gap-5 overflow-x-auto px-5 py-3 text-xs font-bold text-[#43565a] sm:px-8">
            {sections.map((section) => <a key={section.id} href={`#${section.id}`} className="shrink-0 py-1 hover:text-[#173541]">{section.label}</a>)}
          </div>
        </nav>

        <section id="problem" aria-labelledby="problem-heading" className="mx-auto grid max-w-[1320px] gap-10 px-5 py-16 sm:px-8 sm:py-24 lg:grid-cols-[.8fr_1.2fr] lg:gap-20">
          <div><SectionMarker index="01" label="The problem" /><h2 id="problem-heading" data-testid="section-problem" className="home-serif text-4xl font-bold leading-[1.05] tracking-[-.04em] text-[#173541] sm:text-5xl">One pace cannot meet every learner.</h2></div>
          <div className="grid gap-4 sm:grid-cols-2">
            <article className="border-l-2 border-[#9c7a37] pl-5"><p className="text-[11px] font-bold uppercase tracking-[.14em] text-[#745f32]">The classroom reality</p><h3 className="mt-3 font-serif text-2xl font-bold text-[#1c3b45]">Many learners. One lesson.</h3><p className="mt-3 text-sm leading-6 text-[#41565c]">In a large class, it is hard to see every learner’s understanding while the lesson is moving.</p></article>
            <article className="border-l-2 border-[#637d78] pl-5"><p className="text-[11px] font-bold uppercase tracking-[.14em] text-[#47635c]">The cost of waiting</p><h3 className="mt-3 font-serif text-2xl font-bold text-[#1c3b45]">A gap can stay hidden.</h3><p className="mt-3 text-sm leading-6 text-[#41565c]">When understanding is only checked later, a learner may have moved on before a concept gap is noticed.</p></article>
          </div>
        </section>

        <section id="approach" aria-labelledby="approach-heading" className="border-y border-[#d8cfbb] bg-[#eee8d9]">
          <div className="mx-auto max-w-[1320px] px-5 py-16 sm:px-8 sm:py-24">
            <div className="grid gap-8 lg:grid-cols-[.8fr_1.2fr] lg:items-end"><div><SectionMarker index="02" label="The SLATE approach" /><h2 id="approach-heading" data-testid="section-approach" className="home-serif max-w-xl text-4xl font-bold leading-[1.05] tracking-[-.04em] text-[#173541] sm:text-5xl">A connected loop, not another pile of tools.</h2></div><p className="max-w-xl text-sm leading-7 text-[#41565c] sm:text-base">Learning work, assessment, analysis and support belong in the same conversation. SLATE brings those steps together so the next action can follow what the work shows.</p></div>
            <div className="mt-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {[{ icon: BookOpen, title: 'Learning work', detail: 'Teachers set assignments; learners see what is open and what comes next.' }, { icon: FileCheck2, title: 'Assessment', detail: 'Submitted work is marked, with teacher review where the marking mode calls for it.' }, { icon: BrainCircuit, title: 'Analysis', detail: 'Results and activity can surface concepts that may need another look.' }, { icon: MessageCircle, title: 'Support', detail: 'Feedback and focused practice connect insight back to learning.' }].map(({ icon: Icon, title, detail }, index) => <article key={title} className="relative rounded-2xl border border-[#d3c9b3] bg-[#f8f4e8] p-5"><span className="font-mono text-[10px] font-bold text-[#816a36]">0{index + 1}</span><Icon aria-hidden="true" className="mt-5 text-[#315460]" size={22} /><h3 className="mt-3 font-serif text-xl font-bold text-[#193944]">{title}</h3><p className="mt-2 text-xs leading-5 text-[#4b5e62]">{detail}</p>{index < 3 && <ChevronRight aria-hidden="true" className="absolute -right-3 top-1/2 z-[1] hidden rounded-full border border-[#c9bea5] bg-[#eee8d9] p-1 text-[#536467] lg:block" size={24} />}</article>)}
            </div>
          </div>
        </section>

        <section id="learner" aria-labelledby="learner-heading" className="mx-auto grid max-w-[1320px] gap-9 px-5 py-16 sm:px-8 sm:py-24 lg:grid-cols-[.82fr_1.18fr] lg:items-center lg:gap-16">
          <div><SectionMarker index="03" label="Learner experience" /><h2 id="learner-heading" data-testid="section-learner" className="home-serif text-4xl font-bold leading-[1.05] tracking-[-.04em] text-[#173541] sm:text-5xl">Know what is open. See what you can work on next.</h2><p className="mt-5 max-w-lg text-sm leading-7 text-[#41565c]">Learners can see assignments, submit their work, review feedback when it is released, and access practice focused on a concept.</p><ul className="mt-6 space-y-3 text-sm font-semibold text-[#314a52]"><li className="flex gap-3"><Check size={17} className="mt-0.5 shrink-0 text-[#715b2f]" />Work and due dates in one learning space</li><li className="flex gap-3"><Check size={17} className="mt-0.5 shrink-0 text-[#715b2f]" />Feedback that points to a concept</li><li className="flex gap-3"><Check size={17} className="mt-0.5 shrink-0 text-[#715b2f]" />Follow-up practice when available</li></ul></div>
          <LazyDemo><LearnerSample /></LazyDemo>
        </section>

        <section id="teacher" aria-labelledby="teacher-heading" className="border-y border-[#d8cfbb] bg-[#183745] text-[#f5f0e4]">
          <div className="mx-auto grid max-w-[1320px] gap-10 px-5 py-16 sm:px-8 sm:py-24 lg:grid-cols-[1.1fr_.9fr] lg:items-center lg:gap-16">
            <div><SectionMarker index="04" label="Teacher intelligence" tone="dark" /><h2 id="teacher-heading" data-testid="section-teacher" className="home-serif max-w-xl text-4xl font-bold leading-[1.05] tracking-[-.04em] sm:text-5xl">See the class picture. Keep the teaching judgement.</h2><p className="mt-5 max-w-xl text-sm leading-7 text-[#e0e5de]">Teachers can review class zones and concept gaps, mark using a memo, and inspect marked scripts. HOD views stay at class-level aggregate counts; a teacher controls access to individual scripts.</p><div className="mt-6 flex flex-wrap gap-2">{['Class zones', 'Concept gaps', 'Memo-based marking', 'Red-pen scripts', 'HOD counts'].map((item) => <span key={item} className="rounded-full border border-[#7c8e8d] px-3 py-1.5 text-xs font-semibold text-[#f1ecdd]">{item}</span>)}</div><p className="mt-5 flex items-start gap-2 text-xs leading-5 text-[#e0e5de]"><ShieldCheck size={15} className="mt-0.5 shrink-0 text-[#e6d49d]" />The example below is invented sample data; HOD figures are aggregated counts only.</p></div>
            <div className="space-y-4"><LazyDemo><TeacherSample /></LazyDemo><LazyDemo><HodSample /></LazyDemo></div>
          </div>
        </section>

        <section id="parent" aria-labelledby="parent-heading" className="mx-auto grid max-w-[1320px] gap-9 px-5 py-16 sm:px-8 sm:py-24 lg:grid-cols-[.82fr_1.18fr] lg:items-center lg:gap-16">
            <div><SectionMarker index="05" label="Parent involvement" /><h2 id="parent-heading" data-testid="section-parent" className="home-serif text-4xl font-bold leading-[1.05] tracking-[-.04em] text-[#173541] sm:text-5xl">A clearer view of the learning day.</h2><p className="mt-5 max-w-lg text-sm leading-7 text-[#41565c]">Parents can see linked children, progress, assignment history, recent activity, time spent learning and feedback that has been released. The view makes schoolwork easier to follow without asking families to decode school jargon.</p><div className="mt-6 inline-flex items-center gap-2 border-b border-[#a18a54] pb-2 text-sm font-bold text-[#27454d]"><UsersRound size={17} />Linked family learning view</div></div>
            <LazyDemo><div className="space-y-3"><ParentSample /><ParentUsageSample /></div></LazyDemo>
        </section>

        <section id="intelligence" aria-labelledby="intelligence-heading" className="border-y border-[#d8cfbb] bg-[#eee8d9]">
          <div className="mx-auto grid max-w-[1320px] gap-10 px-5 py-16 sm:px-8 sm:py-24 lg:grid-cols-[.9fr_1.1fr] lg:items-center">
            <div><SectionMarker index="06" label="The intelligence engine" /><h2 id="intelligence-heading" data-testid="section-intelligence" className="home-serif max-w-xl text-4xl font-bold leading-[1.05] tracking-[-.04em] text-[#173541] sm:text-5xl">Learning leaves clues. Use them with care.</h2><p className="mt-5 max-w-xl text-sm leading-7 text-[#41565c]">SLATE records performance signals across activity formats and concepts. Recent completed work can help show what has been working and where another explanation or practice may help.</p></div>
            <div className="rounded-[1.5rem] border border-[#d0c5ad] bg-[#f8f4e8] p-5 sm:p-7"><div className="flex items-start gap-4"><div className="grid size-11 shrink-0 place-items-center rounded-xl bg-[#e4dcc8] text-[#5c512f]"><Sparkles size={20} /></div><div><p className="text-[11px] font-bold uppercase tracking-[.13em] text-[#725e35]">A changing picture</p><h3 className="mt-2 font-serif text-2xl font-bold text-[#1c3b45]">Signals are observations, not labels.</h3><p className="mt-3 text-sm leading-6 text-[#41565c]">Patterns can shift as the learner does new work. They are not fixed learning types or a diagnosis. A teacher brings the context; the information helps guide the next question.</p></div></div><div className="mt-6 grid grid-cols-3 gap-2 border-t border-[#ddd3bf] pt-5 text-center"><div><p className="font-mono text-lg font-bold text-[#294d51]">Work</p><p className="mt-1 text-[10px] leading-4 text-[#56666a]">Completed activity</p></div><div><p className="font-mono text-lg font-bold text-[#735b30]">Notice</p><p className="mt-1 text-[10px] leading-4 text-[#56666a]">Patterns and gaps</p></div><div><p className="font-mono text-lg font-bold text-[#294d51]">Respond</p><p className="mt-1 text-[10px] leading-4 text-[#56666a]">Useful next practice</p></div></div></div>
          </div>
        </section>

        <section id="vision" aria-labelledby="vision-heading" className="mx-auto max-w-[1320px] px-5 py-16 sm:px-8 sm:py-24">
          <div className="grid gap-8 lg:grid-cols-[.8fr_1.2fr]"><div><SectionMarker index="07" label="The bigger vision" /><h2 id="vision-heading" data-testid="section-vision" className="home-serif max-w-xl text-4xl font-bold leading-[1.05] tracking-[-.04em] text-[#173541] sm:text-5xl">More connected. More personal. Built with schools.</h2><p className="mt-5 max-w-lg text-sm leading-7 text-[#41565c]">SLATE is growing toward a learning environment that brings the people, tools and support around education closer together.</p></div>
            <div className="grid gap-3 sm:grid-cols-2">
              {[['Dedicated SLATE tablets', 'A focused device for learning work.'], ['Grade 12 career guidance', 'Guidance for the next chapter after school.'], ['Stylus input', 'A more natural way to show working.'], ['Native app', 'A dedicated mobile experience.'], ['WhatsApp AI agent', 'A conversational way to get learning support.'], ['Study Desk', 'A place for guided study time.']].map(([title, description]) => <article key={title} className="rounded-xl border border-[#d8cfbb] bg-[#f8f4e8] p-4"><span className="inline-flex rounded-full bg-[#e8dfca] px-2.5 py-1 text-[10px] font-bold uppercase tracking-[.13em] text-[#67562e]">Becoming</span><h3 className="mt-3 font-serif text-lg font-bold text-[#1d3b45]">{title}</h3><p className="mt-1 text-xs leading-5 text-[#4b5e62]">{description}</p></article>)}
            </div>
          </div>
        </section>

        <section aria-labelledby="cta-heading" className="border-y border-[#d8cfbb] bg-[#e9e1d0]">
          <div className="mx-auto grid max-w-[1320px] gap-8 px-5 py-14 sm:px-8 sm:py-20 lg:grid-cols-[1fr_auto] lg:items-center">
            <div><SectionMarker index="08" label="Begin with the work" /><h2 id="cta-heading" data-testid="section-cta" className="home-serif max-w-2xl text-4xl font-bold leading-[1.05] tracking-[-.04em] text-[#173541] sm:text-5xl">Make room for a better learning conversation.</h2><p className="mt-4 max-w-xl text-sm leading-6 text-[#41565c]">Start a free space for teachers, parents and tutors. Learners can begin with their own account, too.</p></div>
            <div className="flex flex-col items-start gap-3 lg:items-end"><div className="flex flex-wrap gap-2"><Link href="/teacher/register" data-testid="link-start-free-teacher" className="rounded-lg bg-[#183745] px-4 py-3 text-sm font-bold text-[#fff9e9] hover:bg-[#244d5c]">Teacher</Link><Link href="/parent/register" data-testid="link-start-free-parent" className="rounded-lg bg-[#183745] px-4 py-3 text-sm font-bold text-[#fff9e9] hover:bg-[#244d5c]">Parent</Link><Link href="/tutor/register" data-testid="link-start-free-tutor" className="rounded-lg bg-[#183745] px-4 py-3 text-sm font-bold text-[#fff9e9] hover:bg-[#244d5c]">Tutor</Link></div>
              {pilotHref ? <a href={pilotHref} target="_blank" rel="noopener noreferrer" data-testid="link-request-school-pilot" className="inline-flex items-center gap-2 border-b border-[#816a36] py-2 text-sm font-bold text-[#263f47] hover:text-[#725b2f]">Request a school pilot <ArrowRight size={16} /></a> : <p data-testid="text-school-pilot-unavailable" className="max-w-xs text-xs leading-5 text-[#536467]">{support.isLoading ? 'Loading school pilot contact…' : 'School pilot enquiries are not available right now.'}</p>}
            </div>
          </div>
        </section>
      </main>
    </PublicShell>
  );
}

export default function Home() {
  return <HomeContent />;
}
