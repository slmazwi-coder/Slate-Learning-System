import { ArrowUpRight, BookOpenCheck, Check, CircleHelp, FileText, MessageSquareText } from 'lucide-react';

const sampleLabel = <span className="rounded-full border border-[#b9c7bc] bg-[#e8eee7] px-2.5 py-1 text-[10px] font-bold uppercase tracking-[.08em] text-[#284b3c]">Sample data · no learner data</span>;

export function LearnerSample() {
  return (
    <div className="overflow-hidden rounded-[1.4rem] border border-[#d9d2c2] bg-[#fbf8f0] text-[#1e3440] shadow-[0_18px_45px_-30px_rgba(20,38,45,.42)]" data-testid="demo-learner-sample">
      <div className="flex items-center justify-between border-b border-[#e5dfd2] px-4 py-3">{sampleLabel}<span className="text-[10px] font-semibold text-[#53636a]">LEARNER VIEW</span></div>
      <div className="grid gap-4 p-4 sm:grid-cols-[1.2fr_.8fr] sm:p-5">
        <div><p className="text-xs font-semibold uppercase tracking-[.13em] text-[#62716f]">Today · sample learner</p><h3 className="mt-1 font-serif text-2xl font-bold">A clear next step.</h3><div className="mt-4 space-y-2.5">
          <div className="flex items-center gap-3 rounded-xl bg-white px-3 py-2.5"><span className="grid size-8 place-items-center rounded-lg bg-[#e8eee7] text-[#355846]"><BookOpenCheck size={16} /></span><span className="min-w-0 flex-1"><b className="block text-xs">Fractions in recipes</b><small className="text-[11px] text-[#687579]">Mathematics · 6 questions</small></span><ArrowUpRight size={15} /></div>
          <div className="flex items-center gap-3 rounded-xl border border-dashed border-[#d6cdbc] px-3 py-2.5"><span className="grid size-8 place-items-center rounded-lg bg-[#f3e7c9] text-[#644e24]"><MessageSquareText size={15} /></span><span><b className="block text-xs">Feedback is ready</b><small className="text-[11px] text-[#687579]">Review released feedback</small></span></div>
        </div></div>
        <div className="rounded-xl bg-[#e9eee8] p-4"><p className="text-[10px] font-bold uppercase tracking-[.12em] text-[#4a6255]">Work in focus</p><p className="mt-4 font-serif text-3xl font-bold">2 of 6</p><div className="mt-2 h-1.5 rounded-full bg-[#cad6c9]"><div className="h-full w-1/3 rounded-full bg-[#315543]" /></div><p className="mt-3 text-xs leading-5 text-[#40594e]">Take one question at a time. Your progress stays with the work.</p></div>
      </div>
    </div>
  );
}

export function TeacherSample() {
  return (
    <div className="overflow-hidden rounded-[1.4rem] border border-[#d9d2c2] bg-[#fbf8f0] text-[#1e3440] shadow-[0_18px_45px_-30px_rgba(20,38,45,.42)]" data-testid="demo-teacher-sample">
      <div className="flex items-center justify-between border-b border-[#e5dfd2] px-4 py-3">{sampleLabel}<span className="text-[10px] font-semibold text-[#53636a]">TEACHER VIEW</span></div>
      <div className="p-4 sm:p-5"><div className="flex flex-wrap items-end justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-[.13em] text-[#62716f]">Class overview · sample</p><h3 className="mt-1 font-serif text-2xl font-bold">Patterns to follow up</h3></div><span className="rounded-lg bg-[#e8eee7] px-3 py-2 text-xs font-bold text-[#355846]">Mathematics · Fractions</span></div>
        <div className="mt-4 grid gap-4 sm:grid-cols-[.8fr_1.2fr]"><div className="space-y-2">
          {[['Getting there', '7'], ['Needs another look', '3'], ['Not enough work yet', '4']].map(([name, count], index) => <div key={name} className="flex items-center justify-between rounded-lg border border-[#e8e2d6] px-3 py-2"><span className="flex items-center gap-2 text-xs"><i className={`size-2 rounded-full ${index === 0 ? 'bg-[#52745c]' : index === 1 ? 'bg-[#9c7530]' : 'bg-[#8b9998]'}`} />{name}</span><b className="font-mono text-sm">{count}</b></div>)}
        </div><div className="rounded-xl border border-[#e8e2d6] bg-white p-4"><div className="flex items-center gap-2"><FileText size={16} className="text-[#795d30]" /><p className="text-xs font-bold">Marking memo · ready to review</p></div><p className="mt-2 text-xs leading-5 text-[#58696c]">Teacher-authored guidance keeps marking tied to the question and its expected reasoning.</p><div className="mt-3 rounded-lg border-l-2 border-[#9b4d3d] bg-[#fbf2ed] p-2.5"><p className="text-[10px] font-bold uppercase tracking-[.1em] text-[#8d4738]">Marked script · sample excerpt</p><p className="mt-1 text-xs text-[#46595d]">Show how the parts make one whole.</p><p className="mt-2 flex items-center gap-1 text-[10px] font-semibold text-[#355846]"><Check size={12} /> Feedback released by teacher</p></div></div></div>
      </div>
    </div>
  );
}

export function ParentSample() {
  return (
    <div className="overflow-hidden rounded-[1.4rem] border border-[#d9d2c2] bg-[#fbf8f0] text-[#1e3440] shadow-[0_18px_45px_-30px_rgba(20,38,45,.42)]" data-testid="demo-parent-sample">
      <div className="flex items-center justify-between border-b border-[#e5dfd2] px-4 py-3">{sampleLabel}<span className="text-[10px] font-semibold text-[#53636a]">PARENT VIEW</span></div>
      <div className="p-4 sm:p-5"><p className="text-xs font-semibold uppercase tracking-[.13em] text-[#62716f]">Linked child · sample view</p><h3 className="mt-1 font-serif text-2xl font-bold">Learning, in plain view.</h3><div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl bg-[#e9eee8] p-4"><p className="text-[10px] font-bold uppercase tracking-[.12em] text-[#4a6255]">Recent activity</p><p className="mt-3 text-sm font-bold">Completed a practice set</p><p className="mt-1 text-xs text-[#52645a]">Mathematics · Fractions</p></div>
        <div className="rounded-xl border border-[#e8e2d6] p-4"><p className="text-[10px] font-bold uppercase tracking-[.12em] text-[#62716f]">Released feedback</p><p className="mt-3 flex items-start gap-2 text-xs leading-5"><CircleHelp size={15} className="mt-0.5 shrink-0 text-[#805f2b]" />A question is ready to review together.</p></div>
      </div></div>
    </div>
  );
}

export function ParentUsageSample() {
  return (
    <aside data-testid="demo-parent-usage-sample" className="rounded-[1.4rem] border border-[#d9d2c2] bg-[#fbf8f0] p-4 text-[#1e3440] shadow-[0_18px_45px_-30px_rgba(20,38,45,.42)] sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {sampleLabel}
        <span className="text-[10px] font-semibold uppercase tracking-[.1em] text-[#53636a]">Parent view</span>
      </div>
      <h3 className="mt-4 font-serif text-xl font-bold">Time and progress, in plain words.</h3>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <div className="rounded-xl bg-[#e9eee8] p-3">
          <p className="text-[10px] font-bold uppercase tracking-[.1em] text-[#4a6255]">Learning time · sample</p>
          <p className="mt-2 text-sm font-bold">18 minutes this week</p>
        </div>
        <div className="rounded-xl border border-[#e8e2d6] p-3">
          <p className="text-[10px] font-bold uppercase tracking-[.1em] text-[#62716f]">Practice progress · sample</p>
          <p className="mt-2 text-sm font-bold">One practice set completed</p>
        </div>
      </div>
    </aside>
  );
}

export function HodSample() {
  return (
    <div data-testid="demo-hod-sample" className="rounded-[1.4rem] border border-[#4c6270] bg-[#182f3d] p-5 text-[#f4f0e4]">
      <div className="flex items-center justify-between gap-3"><p className="text-xs font-bold uppercase tracking-[.13em] text-[#ded1a9]">HOD overview · invented sample</p><span className="rounded-full border border-[#88999b] px-2.5 py-1 text-[10px] font-bold uppercase tracking-[.1em]">Counts only</span></div>
      <p className="mt-2 font-serif text-2xl font-bold">Department snapshot</p>
      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[['Green', '18'], ['Yellow', '9'], ['Red', '4'], ['Not enough results', '6']].map(([label, value]) => <div key={label} className="rounded-xl border border-[#425966] bg-[#213b49] p-3"><p className="text-[10px] leading-4 text-[#d5ded9]">{label}</p><p className="mt-1 font-mono text-2xl font-semibold">{value}</p></div>)}
      </div>
      <p className="mt-3 text-xs leading-5 text-[#d5ded9]">Aggregated counts only. No learner names, profiles or individual scripts.</p>
    </div>
  );
}
