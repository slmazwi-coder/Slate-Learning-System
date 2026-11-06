import { useState } from 'react';
import { Loader2, Search } from 'lucide-react';
import { ProfileAvatar } from '@/components/profile-image';
import { useSlateSearch, type LearnerSearchResult } from '@/lib/family-api';
import { cn } from '@/lib/utils';

// The SLATE ID is the one label that never repeats, so it is shown wherever a
// person has to be picked out from others who share their name.
export function SlateIdBadge({ slateId, className, testId }: { slateId: string | null | undefined; className?: string; testId?: string }) {
  if (!slateId) return null;
  return (
    <span
      data-testid={testId}
      className={cn('mono-face inline-flex items-center gap-1 rounded-full bg-[hsl(var(--secondary))] px-2.5 py-1 text-[11px] font-bold tracking-wide text-[hsl(var(--secondary-foreground))]', className)}
    >
      {slateId}
    </span>
  );
}

// Shared SLATE ID / full-name search used by teachers, parents and tutors. A
// SLATE ID returns at most one learner; a name returns every match, each shown
// with its SLATE ID so namesakes can be told apart before one is chosen.
export function LearnerSearchPanel({
  onSelect,
  selectLabel,
  busy = false,
  error,
  inputTestId = 'input-slate-search',
  className,
}: {
  onSelect: (learner: LearnerSearchResult) => void;
  selectLabel: string;
  busy?: boolean;
  error?: string;
  inputTestId?: string;
  className?: string;
}) {
  const [query, setQuery] = useState('');
  const search = useSlateSearch(query);
  const results = search.data?.learners ?? [];
  const trimmed = query.trim();
  const showHint = trimmed.length > 0 && trimmed.length < 2;

  return (
    <div className={cn('rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--background)/.4)] p-4', className)}>
      <label className="block">
        <span className="mb-1.5 block text-xs font-bold text-[hsl(var(--muted-foreground))]">Find a learner by SLATE ID or full name</span>
        <div className="flex items-center gap-2 rounded-xl border border-[hsl(var(--input))] bg-[hsl(var(--card))] px-3">
          <Search size={15} className="shrink-0 text-[hsl(var(--muted-foreground))]" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            data-testid={inputTestId}
            placeholder="e.g. L000482 or Someleze Mazwi"
            className="w-full bg-transparent py-2.5 text-sm outline-none"
          />
          {search.isFetching && <Loader2 size={15} className="shrink-0 animate-spin text-[hsl(var(--muted-foreground))]" />}
        </div>
      </label>

      {showHint && <p className="mt-2 text-[11px] text-[hsl(var(--muted-foreground))]">Type at least two characters.</p>}
      {search.isError && <p className="mt-2 text-[11px] font-semibold text-[#93473a]">The search could not be completed. Try again.</p>}

      {trimmed.length >= 2 && !search.isFetching && !search.isError && (
        results.length === 0 ? (
          <p data-testid="status-slate-search-empty" className="mt-3 text-xs text-[hsl(var(--muted-foreground))]">No learner matches “{trimmed}”. Check the SLATE ID or the spelling of the name.</p>
        ) : (
          <div className="mt-3 space-y-2">
            <p className="text-[11px] text-[hsl(var(--muted-foreground))]">{results.length} {results.length === 1 ? 'match' : 'matches'} — check the SLATE ID to pick the right person.</p>
            {results.map((learner) => (
              <div
                key={learner.id}
                data-testid={`card-slate-search-result-${learner.id}`}
                className="flex flex-wrap items-center gap-3 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-3"
              >
                <ProfileAvatar name={learner.fullName} image={learner.profileImage} className="size-10" textClassName="text-xs" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-bold">{learner.fullName}</p>
                    <SlateIdBadge slateId={learner.slateId} testId={`text-slate-id-${learner.id}`} />
                  </div>
                  <p className="mt-0.5 text-xs text-[hsl(var(--muted-foreground))]">Grade {learner.grade} · {learner.schoolName} · @{learner.username}</p>
                </div>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onSelect(learner)}
                  data-testid={`button-select-learner-${learner.id}`}
                  className="shrink-0 whitespace-nowrap rounded-[10px] bg-[hsl(var(--primary))] px-3 py-2 text-xs font-bold text-[hsl(var(--primary-foreground))] disabled:opacity-50"
                >
                  {busy ? 'Working…' : selectLabel}
                </button>
              </div>
            ))}
          </div>
        )
      )}

      {error && <p data-testid="status-slate-search-error" className="mt-3 text-xs font-semibold text-[#93473a]">{error}</p>}
    </div>
  );
}
