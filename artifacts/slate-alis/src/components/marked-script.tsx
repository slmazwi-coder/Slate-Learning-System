import { ArrowLeft, Check, CircleHelp, X } from 'lucide-react';
import { verdictLabel, verdictTone, type MarkedScript } from '@/lib/marked-script';

function cn(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(' ');
}

function formatDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Not available';
  return new Intl.DateTimeFormat('en-ZA', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }).format(date);
}

function VerdictIcon({ verdict }: { verdict: string | null }) {
  if (verdict === 'CORRECT') return <Check size={15} />;
  if (verdict === 'INCORRECT') return <X size={15} />;
  return <CircleHelp size={16} />;
}

// One reusable read-only marked-script view, shared by the learner review, the
// teacher submission list and the parent child view. `editable` only changes the
// framing copy; marking controls live in the teacher's own queue.
export function MarkedScriptView({
  script,
  onBack,
  backLabel = 'Back',
  heading,
}: {
  script: MarkedScript;
  onBack?: () => void;
  backLabel?: string;
  heading?: string;
}) {
  const verdict = script.overallVerdict === 'CORRECT'
    ? 'Strong work.'
    : script.overallVerdict === 'PARTIALLY_CORRECT'
      ? 'Getting there.'
      : 'A useful next step here.';

  return (
    <div data-testid="view-marked-script" className="space-y-5">
      {onBack && (
        <button type="button" onClick={onBack} data-testid="button-script-back" className="inline-flex items-center gap-2 text-sm font-bold text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]">
          <ArrowLeft size={16} />{backLabel}
        </button>
      )}

      <div className="grid gap-5 lg:grid-cols-[.72fr_1.28fr]">
        <section className="rounded-[2rem] bg-[hsl(var(--primary))] p-7 text-[hsl(var(--primary-foreground))] shadow-lg sm:p-9">
          <p className="mono-face text-[10px] uppercase tracking-[.16em] text-[hsl(var(--accent))]">
            Marked · {script.assignment.subject}
          </p>
          <h1 data-testid="text-script-title" className="display-face mt-6 text-2xl font-bold leading-tight tracking-[-.04em] sm:text-3xl">
            {heading ?? script.assignment.title}
          </h1>
          {script.learner && (
            <p className="mt-2 text-xs text-[hsl(var(--primary-foreground)/.7)]">
              {script.learner.fullName} · @{script.learner.username}{script.class ? ` · ${script.class.label}` : ''}
            </p>
          )}
          <div className="mt-8 flex items-end gap-2">
            <span data-testid="text-script-score" className="display-face text-7xl font-bold leading-none tracking-[-.09em] text-[hsl(var(--accent))]">{Math.round(script.score)}</span>
            <span className="mb-2 text-2xl text-[hsl(var(--primary-foreground)/.5)]">%</span>
          </div>
          <p className="mt-3 text-sm leading-6 text-[hsl(var(--primary-foreground)/.7)]">{verdict}</p>
          <p className="mt-2 text-xs leading-6 text-[hsl(var(--primary-foreground)/.55)]">{script.feedback}</p>
          {script.submittedAt && <p className="mt-6 text-[11px] text-[hsl(var(--primary-foreground)/.5)]">Submitted {formatDateTime(script.submittedAt)}</p>}
          <span className={cn('mt-4 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-[.08em]', verdictTone(script.overallVerdict))}>
            <VerdictIcon verdict={script.overallVerdict} />{verdictLabel[script.overallVerdict] ?? script.overallVerdict}
          </span>
        </section>

        <section className="rounded-[2rem] border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-7 sm:p-9">
          <div>
            <p className="mono-face text-[10px] uppercase tracking-[.16em] text-[hsl(var(--muted-foreground))]">Question by question</p>
            <h2 className="mt-1 text-xl font-bold">What the answers show</h2>
          </div>
          <div className="mt-7 space-y-3">
            {script.questions.map((question, index) => (
              <div key={question.questionId} data-testid={`row-script-question-${question.questionId}`} className="rounded-2xl border border-[hsl(var(--border))] p-4">
                <div className="flex items-start gap-3">
                  <span className={cn('mt-0.5 grid size-8 shrink-0 place-items-center rounded-xl', verdictTone(question.verdict))}>
                    <VerdictIcon verdict={question.verdict} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-bold">Question {index + 1}</p>
                      <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-[.06em]', verdictTone(question.verdict))}>
                        {verdictLabel[question.verdict ?? ''] ?? 'Awaiting review'}
                      </span>
                      <span className="mono-face ml-auto text-xs text-[hsl(var(--muted-foreground))]">
                        {question.score === null ? '—' : `${question.score}%`}
                      </span>
                    </div>
                    <p className="mt-2 text-sm leading-6">{question.prompt}</p>
                    {question.concept && <p className="mt-1 text-[11px] text-[hsl(var(--muted-foreground))]">Concept: {question.concept}</p>}
                    <div className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
                      <div className="rounded-xl bg-[hsl(var(--muted))] p-3">
                        <p className="font-bold text-[hsl(var(--muted-foreground))]">Learner's answer</p>
                        <p className="mt-1 whitespace-pre-wrap">{question.learnerAnswer?.trim() ? question.learnerAnswer : 'No answer given'}</p>
                      </div>
                      <div className="rounded-xl bg-[hsl(var(--secondary)/.6)] p-3">
                        <p className="font-bold text-[hsl(var(--secondary-foreground)/.8)]">Correct answer</p>
                        <p className="mt-1 whitespace-pre-wrap">{question.correctAnswer}</p>
                      </div>
                    </div>
                    {question.explanation && <p className="mt-3 text-xs leading-5 text-[hsl(var(--muted-foreground))]">{question.explanation}</p>}
                    {question.gap && <p className="mt-2 text-xs font-bold text-[#8b6424]">Worth revisiting: {question.gap}</p>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
