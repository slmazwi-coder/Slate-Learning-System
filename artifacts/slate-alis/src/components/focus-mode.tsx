import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Eye, Timer } from 'lucide-react';
import {
  useAcknowledgeAssignmentFocusWarning,
  useGetAssignmentFocusState,
  useHeartbeatAssignmentFocus,
  useReportAssignmentFocusLeft,
  useReportAssignmentFocusReturned,
  useSaveAssignmentFocusAnswers,
  type AssignmentFocusState,
} from '@workspace/api-client-react';

// Learner-side focus mode ("tab lock"). The client only ever *reports* events
// and *renders* the state the server hands back: the countdown deadline, the
// warning count and whether an attempt was auto-submitted are all server-owned,
// so a modified page cannot extend a countdown or skip a warning.
//
// Privacy: nothing about what the learner looked at is collected — only when
// they left this page, when they came back and how long they were away.

type DraftAnswers = Record<string, string>;

export type FocusGuard = {
  state: AssignmentFocusState | null;
  locked: boolean;
  autoSubmitted: boolean;
  /** True while a warning is waiting to be acknowledged. */
  blocked: boolean;
  warning: number;
  deadlineAt: string | null;
  /** Set when a focus auto-submit could not be saved, so the learner can retry. */
  submitFailed: string | null;
  acknowledge: () => void;
};

/**
 * Wires an open attempt to the focus-mode endpoints. Returns the live state so
 * the caller can block the page while a warning is outstanding.
 *
 * `enabled` is the server's view of whether this paper is focus-locked at all
 * (`assignment.focusMode`); when false the hook is inert and makes no calls.
 */
export function useFocusGuard(options: {
  assignmentId: string;
  sessionId: string | null;
  enabled: boolean;
  answers: DraftAnswers;
}): FocusGuard {
  const { assignmentId, sessionId, enabled, answers } = options;
  const active = enabled && Boolean(sessionId);

  const [state, setState] = useState<AssignmentFocusState | null>(null);
  const [autoSubmitted, setAutoSubmitted] = useState(false);
  const [submitFailed, setSubmitFailed] = useState<string | null>(null);
  const stateLookup = useGetAssignmentFocusState();
  const left = useReportAssignmentFocusLeft();
  const returned = useReportAssignmentFocusReturned();
  const acknowledgeWarning = useAcknowledgeAssignmentFocusWarning();
  const heartbeat = useHeartbeatAssignmentFocus();
  const saveAnswers = useSaveAssignmentFocusAnswers();

  // The mutation objects are recreated on every render; keep them in a ref so
  // the event listeners below are installed exactly once per attempt.
  const latest = useRef({ left, returned, heartbeat, saveAnswers, acknowledgeWarning, answers });
  latest.current = { left, returned, heartbeat, saveAnswers, acknowledgeWarning, answers };

  const body = { sessionId: sessionId ?? '' };

  // A failed auto-submit is reported honestly: the paper was NOT sent, so the
  // learner is shown a retry prompt instead of the "work submitted" screen. A
  // "processing" result means another worker is still writing the paper, so the
  // learner is told to wait rather than to submit again. Any later success
  // clears both.
  const applyOutcome = (result: { autoSubmitted?: boolean; retryable?: boolean; status?: string; notice?: string }) => {
    if (result.autoSubmitted) { setAutoSubmitted(true); setSubmitFailed(null); return; }
    if (result.status === 'processing') { setSubmitFailed(result.notice ?? 'This paper is still being submitted. Please wait a moment.'); return; }
    if (result.retryable || result.status === 'failed_retryable') setSubmitFailed(result.notice ?? 'This paper could not be submitted just now. Press Submit to send it.');
  };

  // Opening the page asks the server for the current state. This is also the
  // point where a countdown that ran out while nobody was watching is applied.
  useEffect(() => {
    if (!active) return;
    stateLookup.mutate({ assignmentId, data: body }, {
      onSuccess: (result) => {
        setState(result.state);
        applyOutcome({ autoSubmitted: result.state.autoSubmitted, retryable: result.retryable, notice: result.notice });
      },
    });
    // Re-runs only when the attempt changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, assignmentId, sessionId]);

  useEffect(() => {
    if (!active) return;

    const reportLeft = () => latest.current.left.mutate({ assignmentId, data: body }, {
      onSuccess: (result) => {
        setState((current) => current ? { ...current, awaySince: new Date().toISOString(), deadlineAt: result.deadlineAt } : current);
      },
    });
    const reportReturned = () => latest.current.returned.mutate({ assignmentId, data: body }, {
      onSuccess: (result) => {
        setState(result.state);
        applyOutcome(result);
      },
    });

    // `visibilitychange` covers tab switches and minimising; `blur`/`focus`
    // catch leaving the page in place (another window, another app).
    const onVisibility = () => (document.visibilityState === 'hidden' ? reportLeft() : reportReturned());
    const onBlur = () => reportLeft();
    const onFocus = () => reportReturned();

    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('blur', onBlur);
    window.addEventListener('focus', onFocus);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('focus', onFocus);
    };
  }, [active, assignmentId, sessionId]);

  // Heartbeat: keeps the attempt alive and is the point where a countdown that
  // expired in the background is applied at its real deadline.
  useEffect(() => {
    if (!active) return;
    const tick = () => latest.current.heartbeat.mutate({ assignmentId, data: body }, {
      onSuccess: (result) => {
        setState(result.state);
        applyOutcome(result);
      },
    });
    const interval = window.setInterval(tick, 15000);
    return () => window.clearInterval(interval);
  }, [active, assignmentId, sessionId]);

  // Debounced autosave so an auto-submit marks the learner's real work rather
  // than an empty paper. The server stores only the answers themselves.
  const answersKey = JSON.stringify(answers);
  useEffect(() => {
    if (!active) return;
    const handle = window.setTimeout(() => {
      const payload = Object.entries(latest.current.answers).map(([questionId, answer]) => ({ questionId, answer }));
      if (!payload.length) return;
      latest.current.saveAnswers.mutate({ assignmentId, data: { sessionId: sessionId ?? '', answers: payload } });
    }, 1200);
    return () => window.clearTimeout(handle);
  }, [active, assignmentId, sessionId, answersKey]);

  const acknowledge = () => {
    if (!active) return;
    latest.current.acknowledgeWarning.mutate({ assignmentId, data: body }, { onSuccess: (result) => setState(result.state) });
  };

  const locked = Boolean(state && state.enabled && !state.alertOnly && !state.exempt && !state.autoSubmitted);
  return {
    state,
    locked,
    autoSubmitted: autoSubmitted || Boolean(state?.autoSubmitted),
    blocked: Boolean(state?.requiresAcknowledgement) && locked,
    warning: state?.warningCount ?? 0,
    deadlineAt: state?.deadlineAt ?? null,
    submitFailed,
    acknowledge,
  };
}

/** The banner that explains focus mode before/while the learner is working. */
export function FocusNotice({ state, warning }: { state: AssignmentFocusState | null; warning: number }) {
  if (!state || !state.enabled || state.exempt) return null;
  return (
    <div data-testid="notice-focus-mode" className="mb-5 flex gap-3 rounded-2xl border border-[#e3cb8e] bg-[#fffaee] p-4 text-[#74551f]">
      <Eye size={18} className="mt-0.5 shrink-0" />
      <div>
        <p className="text-sm font-bold">
          {state.alertOnly ? 'Your teacher is watching this session.' : 'This is a focus assignment.'}
        </p>
        <p className="mt-1 text-xs leading-5">
          {state.alertOnly
            ? 'Class is live, so leaving this page is reported to your teacher but you will not be warned or submitted.'
            : `Slate notices when you leave this page. Leaving ${state.maxWarnings} times, or staying away too long, submits your work automatically.`}
          {warning > 0 && <> You have used {warning} of {state.maxWarnings}.</>}
        </p>
      </div>
    </div>
  );
}

/** The full-page block shown when the learner must acknowledge a warning. */
export function FocusWarningBlock({ state, onContinue }: { state: AssignmentFocusState; onContinue: () => void }) {
  return (
    <div data-testid="panel-focus-warning" className="mx-auto max-w-xl rounded-[2rem] border-2 border-[#dfa79b] bg-[#fff4f1] p-7 text-center sm:p-10">
      <div className="mx-auto grid size-14 place-items-center rounded-2xl bg-[#f8dcd6] text-[#93473a]"><AlertTriangle size={26} /></div>
      <h2 className="display-face mt-5 text-2xl font-bold tracking-[-.03em] text-[#8f2f22]">You left the page</h2>
      <p className="mt-3 text-sm leading-6 text-[#7d4a41]">
        This is warning {state.warningCount} of {state.maxWarnings}. Leaving again will submit your work as it stands right now.
      </p>
      <button
        type="button"
        onClick={onContinue}
        data-testid="button-focus-continue"
        className="mt-7 rounded-[10px] bg-[#8f2f22] px-5 py-3 text-sm font-bold text-white"
      >
        Continue working
      </button>
    </div>
  );
}

/** The countdown shown while the learner is away and must return in time. */
export function FocusCountdown({ deadlineAt, secondsLeft }: { deadlineAt: string; secondsLeft: number }) {
  return (
    <div data-testid="panel-focus-countdown" className="mx-auto max-w-xl rounded-[2rem] border-2 border-[#dfa79b] bg-[#fff4f1] p-7 text-center sm:p-10">
      <div className="mx-auto grid size-14 place-items-center rounded-2xl bg-[#f8dcd6] text-[#93473a]"><Timer size={26} /></div>
      <h2 className="display-face mt-5 text-2xl font-bold tracking-[-.03em] text-[#8f2f22]">Come back to your work</h2>
      <p className="mt-3 text-sm leading-6 text-[#7d4a41]">
        Return to this page within <span className="mono-face font-bold">{Math.max(0, secondsLeft)}s</span> or your work will be submitted automatically.
      </p>
      <p className="mono-face mt-4 text-xs text-[#7d4a41]">Deadline {new Date(deadlineAt).toLocaleTimeString()}</p>
    </div>
  );
}

/** Shown once focus mode has submitted the paper for the learner. */
export function FocusAutoSubmitted() {
  return (
    <div data-testid="panel-focus-auto-submitted" className="mx-auto max-w-xl rounded-[2rem] border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-7 text-center sm:p-10">
      <div className="mx-auto grid size-14 place-items-center rounded-2xl bg-[#f7e8be] text-[#74551f]"><AlertTriangle size={26} /></div>
      <h2 className="display-face mt-5 text-2xl font-bold tracking-[-.03em]">Your work was submitted</h2>
      <p className="mt-3 text-sm leading-6 text-[hsl(var(--muted-foreground))]">
        Focus mode ended this attempt and submitted your saved answers. Your teacher can reopen it if something went wrong.
      </p>
    </div>
  );
}

/** Counts down to a server-owned deadline, re-rendering each second. */
export function useCountdown(deadlineAt: string | null): number | null {
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  useEffect(() => {
    if (!deadlineAt) { setSecondsLeft(null); return; }
    const tick = () => setSecondsLeft(Math.max(0, Math.round((new Date(deadlineAt).getTime() - Date.now()) / 1000)));
    tick();
    const interval = window.setInterval(tick, 1000);
    return () => window.clearInterval(interval);
  }, [deadlineAt]);
  return secondsLeft;
}
