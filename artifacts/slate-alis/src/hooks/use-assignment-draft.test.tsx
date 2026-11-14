import { act, renderHook, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useAssignmentDraft } from './use-assignment-draft';
const session = { sessionId: 'attempt-a', expiresAt: new Date(Date.now() + 3600000).toISOString(), draftAnswers: [{ questionId: 'q1', answer: 'Server answer' }] };
const mount = () => renderHook(() => {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  return { answers, setAnswers, draft: useAssignmentDraft('assignment', session, answers, setAnswers) };
});
beforeEach(() => { sessionStorage.clear(); vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true })); });
afterEach(() => vi.unstubAllGlobals());
it('restores server work, retains edits across remount, and clears submitted drafts', async () => {
  const first = mount();
  await waitFor(() => expect(first.result.current.answers.q1).toBe('Server answer'));
  act(() => first.result.current.setAnswers({ q1: 'My unsent answer' }));
  first.unmount();
  const second = mount();
  await waitFor(() => expect(second.result.current.answers.q1).toBe('My unsent answer'));
  act(() => second.result.current.draft.clear());
  act(() => window.dispatchEvent(new Event('pagehide')));
  expect(sessionStorage.getItem('slate-draft-attempt-a')).toBeNull();
});
it('keeps a tab copy and reports failed network saves honestly', async () => {
  vi.mocked(fetch).mockRejectedValue(new Error('offline'));
  const view = mount();
  act(() => view.result.current.setAnswers({ q1: 'Offline answer' }));
  await waitFor(() => expect(view.result.current.draft.status).toContain('Not synced'));
  expect(JSON.parse(sessionStorage.getItem('slate-draft-attempt-a')!).answers.q1).toBe('Offline answer');
});
it('discards expired tab copies', async () => {
  sessionStorage.setItem('slate-draft-attempt-a', JSON.stringify({ expiresAt: '2000-01-01', answers: { q1: 'Stale' } }));
  const view = mount();
  await waitFor(() => expect(view.result.current.answers.q1).toBe('Server answer'));
});
