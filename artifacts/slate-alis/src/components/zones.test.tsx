import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { HodZonePanel, TeacherZonePanel, ZoneCountBar, ZonePill, ZONE_LABEL } from './zones';

// The zone visuals are shared by the teacher view and the HOD view, so these
// tests pin the two things that must never drift: the four band labels (with
// "grey" replacing the old "insufficient") and the fact that a grey learner is
// never rendered as needing support.

function withQuery(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

const COUNTS = { green: 4, yellow: 2, red: 1, grey: 3, total: 10 };

describe('ZoneCountBar', () => {
  it('renders all four bands, counting the grey band and never "insufficient"', () => {
    render(<ZoneCountBar zones={COUNTS} />);
    expect(screen.getByTestId('zone-hod-green').textContent).toContain('On track');
    expect(screen.getByTestId('zone-hod-yellow').textContent).toContain('Watch');
    expect(screen.getByTestId('zone-hod-red').textContent).toContain('Needs support');
    // The old "insufficient" label is gone; the band is "Not enough data" (grey).
    expect(screen.getByTestId('zone-hod-grey').textContent).toContain('Not enough data');
    expect(screen.getByTestId('zone-hod-grey').textContent).toContain('3');
    expect(document.body.textContent?.toLowerCase()).not.toContain('insufficient');
  });

  it('uses the same wording as the shared label map', () => {
    expect(ZONE_LABEL.grey).toBe('Not enough data');
    expect(ZONE_LABEL.red).toBe('Needs support');
  });
});

describe('ZonePill', () => {
  it('labels a grey learner as not enough data, not as needing support', () => {
    render(<ZonePill zone="grey" testId="pill" />);
    const pill = screen.getByTestId('pill');
    expect(pill.textContent).toBe('Not enough data');
    expect(pill.textContent).not.toContain('Needs support');
  });
});

describe('HodZonePanel', () => {
  it('shows counts, the change since last term and the intervention share, with no learner named', () => {
    withQuery(
      <HodZonePanel
        entry={{
          zones: COUNTS,
          zoneChangeSinceLastTerm: -4,
          zoneIntervention: { red: 1, withIntervention: 1, share: 100 },
          zoneTerm: { label: 'Term 3 2026', status: 'confirmed' },
        }}
      />,
    );
    expect(screen.getByTestId('zones-hod-panel').textContent).toContain('-4 pts');
    expect(screen.getByTestId('zones-hod-panel').textContent).toContain('100%');
    expect(screen.getByTestId('zones-hod-panel').textContent).toContain('Term 3 2026');
    // A count-only payload cannot name a learner.
    expect(screen.getByTestId('zones-hod-panel').textContent).toContain('1 of 1 with a note');
  });

  it('falls back to a dash when there is no change to report and no confirmed term', () => {
    withQuery(
      <HodZonePanel
        entry={{ zones: COUNTS, zoneChangeSinceLastTerm: null, zoneIntervention: { red: 0, withIntervention: 0, share: null }, zoneTerm: null }}
      />,
    );
    const text = screen.getByTestId('zones-hod-panel').textContent ?? '';
    expect(text).toContain('—');
    expect(text).toContain('No confirmed term');
  });
});

describe('TeacherZonePanel', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders the class bands, the priority list and the disclaimer from the API', async () => {
    const payload = {
      classId: 'c1',
      settings: { greenMin: 60, yellowMin: 40, minResults: 3, windowSize: 5, formalWeight: 2, trendDropFlag: 15, missedInRowFlag: 2 },
      term: { label: 'Term 3 2026', status: 'confirmed' },
      counts: COUNTS,
      classAverage: 58,
      groups: { red: [], yellow: [], green: [], grey: [] },
      priority: [
        { id: 'l1', fullName: 'Thandi Mokoena', zone: 'red', score: 22, trend: 'down', earlyWarning: true, engagementFlag: true },
        { id: 'l2', fullName: 'Sipho Ndlovu', zone: 'grey', score: null, trend: 'flat', earlyWarning: false, engagementFlag: false },
      ],
      alerts: [{ id: 'a1', learnerId: 'l1', learnerName: 'Thandi Mokoena', kind: 'TWO_BELOW_RED', detail: 'The two most recent released results are both below the red line.', raisedAt: '2026-09-01T00:00:00.000Z' }],
      disclaimer: 'Zones are indicative only and are never a promotion decision.',
    };
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/zone-settings')) {
        return { ok: true, text: async () => JSON.stringify({ settings: payload.settings, defaults: payload.settings }) } as Response;
      }
      return { ok: true, text: async () => JSON.stringify(payload) } as Response;
    }) as unknown as typeof fetch);

    withQuery(<TeacherZonePanel classId="c1" />);

    const panel = await screen.findByTestId('zones-teacher-c1');
    await waitFor(() => expect(panel.textContent).toContain('Thandi Mokoena'));
    // The red learner is first in the priority list and carries both flags.
    expect(screen.getByTestId('zone-pill-l1').textContent).toBe('Needs support');
    expect(screen.getByTestId('zone-early-warning-l1')).toBeTruthy();
    expect(screen.getByTestId('zone-engagement-l1')).toBeTruthy();
    // A grey learner is never shown as needing support.
    expect(screen.getByTestId('zone-pill-l2').textContent).toBe('Not enough data');
    // The stored alert and the disclaimer are both present.
    expect(screen.getByTestId('zone-alerts').textContent).toContain('Thandi Mokoena');
    expect(panel.textContent).toContain('never a promotion decision');
  });

  it('shows a plain error instead of a blank panel when the zone request fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500, text: async () => JSON.stringify({ error: 'boom' }) })) as unknown as typeof fetch);
    withQuery(<TeacherZonePanel classId="c1" />);
    expect(await screen.findByTestId('zones-error')).toBeTruthy();
  });
});
