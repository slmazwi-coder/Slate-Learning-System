import { useState } from 'react';
import { AlertTriangle, ArrowRight, ClipboardCheck, Info, TrendingDown, TrendingUp } from 'lucide-react';
import {
  useClassZones,
  useLearnerInterventions,
  useLogIntervention,
  useSetParentZoneVisibility,
  useUpdateZoneSettings,
  useZoneSettings,
  type ZoneKey,
} from '@/lib/tis-api';
import type { HodZoneCounts } from '@/lib/hod-api';

// ONE set of zone visuals for the teacher view and the HOD view. The teacher
// sees named learners; the HOD sees counts only. Both render the same bands, the
// same colours and the same wording, so a zone means the same thing on both
// screens.

export function cn(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(' ');
}

export const ZONE_TONE: Record<ZoneKey, { cell: string; pill: string }> = {
  green: { cell: 'bg-[#d9efe0] text-[#1d6b3c]', pill: 'bg-[#d9efe0] text-[#1d6b3c]' },
  yellow: { cell: 'bg-[#f7e8be] text-[#74551f]', pill: 'bg-[#f7e8be] text-[#74551f]' },
  red: { cell: 'bg-[#f8dcd6] text-[#93473a]', pill: 'bg-[#f8dcd6] text-[#93473a]' },
  grey: { cell: 'bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))]', pill: 'bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))]' },
};

export const ZONE_LABEL: Record<ZoneKey, string> = {
  green: 'On track',
  yellow: 'Watch',
  red: 'Needs support',
  grey: 'Not enough data',
};

// The same disclaimer wherever a zone is shown. A zone is indicative only.
export const ZONE_DISCLAIMER = 'Zones are indicative only and are never a promotion decision.';

// Counts only. Shared by the teacher class view and every HOD screen, so the
// four bands always look and read the same. "grey" is the band for too little
// released, marked work: a learner is never red on too little evidence.
export function ZoneCountBar({ zones }: { zones: HodZoneCounts }) {
  const cells: Array<{ key: ZoneKey; value: number }> = [
    { key: 'green', value: zones.green },
    { key: 'yellow', value: zones.yellow },
    { key: 'red', value: zones.red },
    { key: 'grey', value: zones.grey },
  ];
  return (
    <div data-testid="zones-hod" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {cells.map((cell) => (
        <div key={cell.key} data-testid={`zone-hod-${cell.key}`} className={cn('rounded-2xl px-3 py-2.5 text-center', ZONE_TONE[cell.key].cell)}>
          <p className="mono-face text-xl font-bold">{cell.value}</p>
          <p className="text-[11px] font-bold">{ZONE_LABEL[cell.key]}</p>
        </div>
      ))}
    </div>
  );
}

export function ZonePill({ zone, testId }: { zone: ZoneKey; testId?: string }) {
  return (
    <span data-testid={testId} className={cn('inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide', ZONE_TONE[zone].pill)}>
      {ZONE_LABEL[zone]}
    </span>
  );
}

function TrendIcon({ trend }: { trend: string }) {
  if (trend === 'down') return <TrendingDown size={14} className="text-[#93473a]" />;
  if (trend === 'up') return <TrendingUp size={14} className="text-[#1d6b3c]" />;
  return <ArrowRight size={14} className="text-[hsl(var(--muted-foreground))]" />;
}

// The teacher's zone panel: the class in bands, the priority list, the stored
// alerts, the cut-offs and the intervention log. Everything here is teacher-only.
export function TeacherZonePanel({ classId }: { classId: string }) {
  const zones = useClassZones(classId);
  const [openLearner, setOpenLearner] = useState<string | null>(null);

  if (zones.isLoading) return <p className="text-sm text-[hsl(var(--muted-foreground))]">Loading zones…</p>;
  if (zones.isError || !zones.data) return <p data-testid="zones-error" className="text-sm text-[#93473a]">Could not load the zone view. Please refresh.</p>;
  const data = zones.data;

  return (
    <div className="space-y-5" data-testid={`zones-teacher-${classId}`}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="mono-face text-[10px] uppercase tracking-[.16em] text-[hsl(var(--muted-foreground))]">Performance zones</p>
          <h2 className="mt-1 text-xl font-bold">Who needs you first</h2>
        </div>
        <p className="text-xs font-semibold text-[hsl(var(--muted-foreground))]">Class average {data.classAverage === null ? '—' : `${data.classAverage}%`}{data.term ? ` · ${data.term.label}` : ''}</p>
      </div>

      <ZoneCountBar zones={data.counts} />

      {data.alerts.length > 0 && (
        <div data-testid="zone-alerts" className="space-y-2">
          {data.alerts.map((alert) => (
            <div key={alert.id} className="flex items-start gap-3 rounded-2xl border border-[#e9c3b8] bg-[#fff4f1] p-3">
              <AlertTriangle size={16} className="mt-0.5 shrink-0 text-[#93473a]" />
              <p className="text-sm text-[#7d4a41]"><span className="font-bold">{alert.learnerName}</span> — {alert.detail}</p>
            </div>
          ))}
        </div>
      )}

      {data.priority.length > 0 && (
        <div className="space-y-2" data-testid="zone-priority">
          <p className="mono-face text-[10px] uppercase tracking-[.16em] text-[hsl(var(--muted-foreground))]">Priority list</p>
          {data.priority.map((learner) => (
            <div key={learner.id} data-testid={`zone-priority-${learner.id}`} className="rounded-2xl border border-[hsl(var(--border))] p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="font-bold">{learner.fullName}</span>
                  <ZonePill zone={learner.zone} testId={`zone-pill-${learner.id}`} />
                  {learner.earlyWarning && <span data-testid={`zone-early-warning-${learner.id}`} className="rounded-full bg-[#f7e8be] px-2 py-0.5 text-[10px] font-bold uppercase text-[#74551f]">Early warning</span>}
                  {learner.engagementFlag && <span data-testid={`zone-engagement-${learner.id}`} className="rounded-full bg-[hsl(var(--muted))] px-2 py-0.5 text-[10px] font-bold uppercase text-[hsl(var(--muted-foreground))]">Missed work</span>}
                </div>
                <div className="flex items-center gap-3">
                  <span className="mono-face text-sm font-bold">{learner.score === null ? '—' : `${learner.score}%`}</span>
                  <TrendIcon trend={learner.trend} />
                  <button type="button" data-testid={`button-zone-detail-${learner.id}`} onClick={() => setOpenLearner(openLearner === learner.id ? null : learner.id)} className="shrink-0 whitespace-nowrap rounded-[10px] border border-[hsl(var(--border))] px-2.5 py-1 text-[11px] font-bold">
                    {openLearner === learner.id ? 'Close' : 'Support'}
                  </button>
                </div>
              </div>
              {openLearner === learner.id && <InterventionPanel classId={classId} learnerId={learner.id} />}
            </div>
          ))}
        </div>
      )}

      {data.priority.length === 0 && <p className="text-sm text-[hsl(var(--muted-foreground))]">No learners to prioritise yet. Zones appear once work has been marked and released.</p>}

      <ZoneSettingsEditor classId={classId} />
      <ParentZoneVisibilityToggle classId={classId} />

      <p className="flex items-start gap-2 text-[11px] text-[hsl(var(--muted-foreground))]"><Info size={13} className="mt-0.5 shrink-0" />{data.disclaimer}</p>
    </div>
  );
}

function InterventionPanel({ classId, learnerId }: { classId: string; learnerId: string }) {
  const existing = useLearnerInterventions(classId, learnerId);
  const log = useLogIntervention();
  const [note, setNote] = useState('');
  const [outcome, setOutcome] = useState('');
  const [error, setError] = useState('');

  return (
    <div className="mt-3 space-y-3 border-t border-[hsl(var(--border))] pt-3" data-testid={`interventions-${learnerId}`}>
      {(existing.data?.interventions ?? []).map((row) => (
        <div key={row.id} className="rounded-xl bg-[hsl(var(--muted))] p-2.5 text-xs">
          <p className="font-semibold">{row.note}</p>
          {row.outcome && <p className="mt-1 text-[hsl(var(--muted-foreground))]">{row.outcome}</p>}
        </div>
      ))}
      <div className="grid gap-2 sm:grid-cols-2">
        <textarea data-testid={`input-intervention-note-${learnerId}`} value={note} onChange={(event) => setNote(event.target.value)} placeholder="What support did you give?" rows={2} className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-2 text-sm" />
        <textarea data-testid={`input-intervention-outcome-${learnerId}`} value={outcome} onChange={(event) => setOutcome(event.target.value)} placeholder="Outcome (optional)" rows={2} className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-2 text-sm" />
      </div>
      {error && <p className="text-xs font-semibold text-[#93473a]">{error}</p>}
      <button
        type="button"
        data-testid={`button-log-intervention-${learnerId}`}
        disabled={log.isPending || note.trim().length === 0}
        onClick={() => {
          setError('');
          log.mutate({ classId, learnerId, note: note.trim(), outcome: outcome.trim() || undefined }, {
            onSuccess: () => { setNote(''); setOutcome(''); },
            onError: (mutationError) => setError(mutationError instanceof Error ? mutationError.message : 'Could not save the note.'),
          });
        }}
        className="inline-flex items-center gap-2 rounded-[10px] bg-[hsl(var(--primary))] px-3 py-2 text-xs font-bold text-[hsl(var(--primary-foreground))] disabled:opacity-50"
      >
        <ClipboardCheck size={14} />Log support
      </button>
    </div>
  );
}

function ZoneSettingsEditor({ classId }: { classId: string }) {
  const settings = useZoneSettings(classId);
  const update = useUpdateZoneSettings();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');
  if (!settings.data) return null;
  const current = settings.data.settings;

  const field = (key: 'greenMin' | 'yellowMin' | 'minResults' | 'windowSize' | 'formalWeight' | 'trendDropFlag' | 'missedInRowFlag', label: string) => (
    <label className="text-xs font-semibold text-[hsl(var(--muted-foreground))]">
      {label}
      <input
        type="number"
        data-testid={`input-zone-${key}`}
        defaultValue={current[key]}
        onBlur={(event) => {
          const value = Number(event.target.value);
          if (!Number.isFinite(value) || value === current[key]) return;
          setError('');
          update.mutate({ classId, [key]: value }, { onError: (mutationError) => setError(mutationError instanceof Error ? mutationError.message : 'Could not save.') });
        }}
        className="mt-1 w-full rounded-[10px] border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-2 text-sm"
      />
    </label>
  );

  return (
    <div className="rounded-2xl border border-[hsl(var(--border))] p-3">
      <button type="button" data-testid="button-toggle-zone-settings" onClick={() => setOpen(!open)} className="text-xs font-bold text-[hsl(var(--accent-foreground))]">
        {open ? 'Hide cut-offs' : 'Adjust cut-offs'}
      </button>
      {open && (
        <div className="mt-3 space-y-3">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {field('greenMin', 'Green from %')}
            {field('yellowMin', 'Yellow from %')}
            {field('minResults', 'Min results')}
            {field('windowSize', 'Window size')}
            {field('formalWeight', 'Exam weight')}
            {field('trendDropFlag', 'Trend drop')}
            {field('missedInRowFlag', 'Missed in a row')}
          </div>
          {error && <p className="text-xs font-semibold text-[#93473a]">{error}</p>}
          <p className="text-[11px] text-[hsl(var(--muted-foreground))]">A change re-bands the whole class. Every change is recorded.</p>
        </div>
      )}
    </div>
  );
}

function ParentZoneVisibilityToggle({ classId }: { classId: string }) {
  const setVisibility = useSetParentZoneVisibility();
  return (
    <label className="flex items-start gap-3 rounded-2xl border border-[hsl(var(--border))] p-3 text-xs">
      <input type="checkbox" data-testid="checkbox-parent-zone-visibility" onChange={(event) => setVisibility.mutate({ classId, enabled: event.target.checked })} className="mt-0.5 size-4" />
      <span>
        <span className="font-bold">Show parents a plain-language zone phrase</span>
        <span className="mt-1 block text-[hsl(var(--muted-foreground))]">Parents see a gentle phrase such as "on track" or "needs extra support" — never a mark, a colour or another learner.</span>
      </span>
    </label>
  );
}

// The HOD panel: counts, the change since the last term, the intervention share
// and the term in use. No learner name or id is rendered here, ever.
export function HodZonePanel({ entry }: { entry: { zones: HodZoneCounts; zoneChangeSinceLastTerm: number | null; zoneIntervention: { red: number; withIntervention: number; share: number | null }; zoneTerm: { label: string; status: string } | null } }) {
  return (
    <div className="space-y-3" data-testid="zones-hod-panel">
      <ZoneCountBar zones={entry.zones} />
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="rounded-2xl border border-[hsl(var(--border))] p-3">
          <p className="text-[11px] font-bold uppercase tracking-[.08em] text-[hsl(var(--muted-foreground))]">Change since last term</p>
          <p className="mono-face mt-1 text-lg font-bold">{entry.zoneChangeSinceLastTerm === null ? '—' : `${entry.zoneChangeSinceLastTerm > 0 ? '+' : ''}${entry.zoneChangeSinceLastTerm} pts`}</p>
        </div>
        <div className="rounded-2xl border border-[hsl(var(--border))] p-3">
          <p className="text-[11px] font-bold uppercase tracking-[.08em] text-[hsl(var(--muted-foreground))]">Support logged for red learners</p>
          <p className="mono-face mt-1 text-lg font-bold">{entry.zoneIntervention.share === null ? '—' : `${entry.zoneIntervention.share}%`}</p>
          <p className="text-[11px] text-[hsl(var(--muted-foreground))]">{entry.zoneIntervention.withIntervention} of {entry.zoneIntervention.red} with a note</p>
        </div>
      </div>
      <p className="text-[11px] text-[hsl(var(--muted-foreground))]">{entry.zoneTerm ? `${entry.zoneTerm.label} · ${entry.zoneTerm.status}` : 'No confirmed term — the most recent results are used.'}</p>
      <p className="flex items-start gap-2 text-[11px] text-[hsl(var(--muted-foreground))]"><Info size={13} className="mt-0.5 shrink-0" />{ZONE_DISCLAIMER}</p>
    </div>
  );
}
