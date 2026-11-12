import { afterEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { LearnerApproval } from './learner-approval';

afterEach(() => vi.restoreAllMocks());

it('requests a code for the named adult and clears it when the role changes', async () => {
  const code = 'a'.repeat(43);
  const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ code }), { status: 200, headers: { 'content-type': 'application/json' } }));
  render(<LearnerApproval />);
  fireEvent.change(screen.getByLabelText('Adult SLATE ID'), { target: { value: 'P000001' } });
  fireEvent.click(screen.getByRole('button', { name: 'Create code' }));
  await waitFor(() => expect(screen.getByText(new RegExp(code))).toBeTruthy());
  expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({ role: 'parent', slateId: 'P000001' });
  fireEvent.change(screen.getByLabelText('Adult role'), { target: { value: 'teacher' } });
  expect(screen.queryByText(new RegExp(code))).toBeNull();
});
