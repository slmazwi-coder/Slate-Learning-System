import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';

type Answers = Record<string, string>;
type Attempt = { sessionId: string; expiresAt: string; draftAnswers?: Array<{ questionId: string; answer: string }> };
// The tab copy is scoped to an unguessable server attempt and expires with it.
export function useAssignmentDraft(assignmentId: string, session: Attempt | null, answers: Answers, setAnswers: Dispatch<SetStateAction<Answers>>) {
  const [status, setStatus] = useState('');
  const [retry, setRetry] = useState(0);
  const saves = useRef<Promise<unknown>>(Promise.resolve());
  useEffect(() => { const online = () => setRetry(value => value + 1); window.addEventListener('online', online); return () => window.removeEventListener('online', online); }, []);
  const restored = useRef<string | null>(null);
  const latest = useRef(answers);
  latest.current = answers;
  const key = session ? `slate-draft-${session.sessionId}` : null;
  useEffect(() => {
    if (!session || !key) return;
    let initial = Object.fromEntries((session.draftAnswers ?? []).map(item => [item.questionId, item.answer]));
    try {
      const copy = JSON.parse(sessionStorage.getItem(key) ?? 'null');
      if (copy && copy.expiresAt === session.expiresAt && Date.parse(copy.expiresAt) > Date.now()) initial = copy.answers;
      else sessionStorage.removeItem(key);
    } catch { /* Server copy remains usable when tab storage is unavailable. */ }
    setAnswers(initial);
    latest.current = initial;
    restored.current = session.sessionId;
    setStatus(Object.keys(initial).length ? 'Draft restored. Your work is ready to continue.' : 'Your answers will save as you work.');
  }, [session?.sessionId]);
  useEffect(() => {
    if (!session || !key || restored.current !== session.sessionId || answers !== latest.current) return;
    // First render after hydration must not overwrite the recovered copy.
    let cancelled = false;
    const saveLocal = () => {
      if (restored.current !== session.sessionId) return false;
      try { sessionStorage.setItem(key, JSON.stringify({ expiresAt: session.expiresAt, answers: latest.current })); return true; }
      catch { return false; }
    };
    const localSaved = saveLocal();
    setStatus('Saving draft…');
    const timer = window.setTimeout(() => {
      saves.current = saves.current.catch(() => {}).then(async () => {
      try {
        const response = await fetch(`/api/assignments/${assignmentId}/focus/answers`, { method: 'POST', credentials: 'include', signal: AbortSignal.timeout(10000), headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId: session.sessionId, answers: Object.entries(answers).map(([questionId, answer]) => ({ questionId, answer })) }) });
        if (!response.ok) throw new Error('save failed');
        if (!cancelled) setStatus('Draft saved.');
      } catch {
        if (!cancelled) setStatus(localSaved ? 'Not synced. Draft kept in this tab; reconnect to save online.' : 'Draft could not be saved. Keep this page open and try again.');
      }
      });
    }, 500);
    const persist = () => { saveLocal(); };
    window.addEventListener('pagehide', persist);
    return () => { cancelled = true; window.clearTimeout(timer); window.removeEventListener('pagehide', persist); };
  }, [assignmentId, session?.sessionId, answers, retry]);
  return { status, clear: () => { if (key) { try { sessionStorage.removeItem(key); } catch {} } restored.current = null; } };
}
