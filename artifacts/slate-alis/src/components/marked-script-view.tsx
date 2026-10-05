import type { MarkedScript } from '@/lib/marked-script';
import { Check, CircleHelp, Clock3, X } from 'lucide-react';

function dateLabel(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Not available' : new Intl.DateTimeFormat('en-ZA', { day: 'numeric', month: 'long', year: 'numeric' }).format(date);
}

export function MarkedScriptView({ script, audience = 'teacher', onClose }: { script: MarkedScript; audience?: 'learner' | 'parent' | 'teacher'; onClose?: () => void }) {
  if (audience !== 'teacher' && !script.submission.released) {
    return <div data-testid="status-script-held" className="rounded-3xl border border-[hsl(var(--border))] bg-[hsl(var(--secondary))] p-7"><div className="grid size-11 place-items-center rounded-xl bg-[hsl(var(--card))]"><Clock3 size={20} /></div><h2 className="display-face mt-5 text-2xl font-bold">Feedback is being held</h2><p className="mt-2 max-w-lg text-sm leading-6 text-[hsl(var(--muted-foreground))]">This marked script will be available after it has been released.</p></div>;
  }
  return (
    <section data-testid="panel-marked-script" className="rounded-[1.75rem] border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5 shadow-sm sm:p-8">
      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-[hsl(var(--border))] pb-5">
        <div><p className="mono-face text-[10px] uppercase tracking-[.18em] text-[hsl(var(--accent-foreground))]">{script.assignment.subject} · {script.assignment.topic}</p><h2 className="display-face mt-2 text-2xl font-bold tracking-[-.04em]">{script.assignment.title}</h2><p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">{script.learner.fullName} · @{script.learner.username} · Submitted {dateLabel(script.submission.submittedAt)}</p></div>
        <div className="flex items-center gap-3">{audience === 'teacher' && <span className="rounded-full bg-[hsl(var(--muted))] px-3 py-1.5 text-xs font-bold">{script.submission.markingStatus}</span>}<span className="mono-face text-2xl font-medium">{script.submission.score}%</span>{onClose && <button type="button" onClick={onClose} aria-label="Close marked script" data-testid="button-close-marked-script" className="rounded-lg p-2 hover:bg-[hsl(var(--muted))]"><X size={18} /></button>}</div>
      </header>
      <div className="mt-5 rounded-2xl bg-[hsl(var(--secondary)/.55)] p-4"><p className="mono-face text-[10px] uppercase tracking-[.14em] text-[hsl(var(--muted-foreground))]">Overall feedback · {script.submission.overallVerdict.replaceAll('_', ' ').toLowerCase()}</p><p className="mt-2 text-sm leading-6">{script.submission.feedback || 'No overall comment was provided.'}</p></div>
      <div className="mt-5 space-y-4">
        {script.questions.map((question) => {
          const correct = question.verdict === 'CORRECT';
          return <article key={question.questionId} data-testid={`row-script-question-${question.questionId}`} className="rounded-2xl border border-[hsl(var(--border))] p-4 sm:p-5">
            <div className="flex items-start gap-3"><span className={`grid size-8 shrink-0 place-items-center rounded-xl ${correct ? 'bg-[hsl(var(--secondary))] text-[hsl(var(--secondary-foreground))]' : 'bg-[#f7e8be] text-[#74551f]'}`}>{correct ? <Check size={16} /> : <CircleHelp size={16} />}</span><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm font-bold">Question {question.index + 1}</p><span className="mono-face text-xs">{question.verdict?.replaceAll('_', ' ').toLowerCase() || 'Awaiting mark'}{question.score !== null ? ` · ${question.score}%` : ''}</span></div><p className="mt-2 text-sm leading-6">{question.prompt}</p></div></div>
            {question.options?.length > 0 && <div className="mt-3 flex flex-wrap gap-2">{question.options.map((option, i) => <span key={`${option}-${i}`} className="rounded-lg bg-[hsl(var(--muted))] px-2.5 py-1.5 text-xs">{option}</span>)}</div>}
            <div className="mt-4 grid gap-3 sm:grid-cols-2"><div className="rounded-xl bg-[hsl(var(--muted)/.7)] p-3"><p className="text-[10px] font-bold uppercase tracking-wider text-[hsl(var(--muted-foreground))]">Learner answer</p><p className="mt-1.5 whitespace-pre-wrap text-sm">{question.learnerAnswer || 'No answer recorded'}</p></div><div className="rounded-xl bg-[hsl(var(--secondary)/.55)] p-3"><p className="text-[10px] font-bold uppercase tracking-wider text-[hsl(var(--muted-foreground))]">Correct answer</p><p className="mt-1.5 whitespace-pre-wrap text-sm">{question.correctAnswer || 'Not provided'}</p></div></div>
            <p className="mt-3 text-xs leading-5 text-[hsl(var(--muted-foreground))]">{question.explanation || 'No explanation provided.'}</p><div className="mt-3 flex flex-wrap gap-2">{question.concept && <span className="rounded-full bg-[hsl(var(--accent)/.3)] px-2.5 py-1 text-[11px] font-bold">Concept: {question.concept}</span>}{question.gap && <span className="rounded-full bg-[#f7e8be] px-2.5 py-1 text-[11px] font-bold text-[#74551f]">Revisit: {question.gap}</span>}</div>
          </article>;
        })}
      </div>
    </section>
  );
}