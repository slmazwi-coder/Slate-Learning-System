import { describe, expect, it, vi, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Router } from 'wouter';
import { TeacherAuth } from './tis';

// Regression guard for the reported bug: the teacher login page talks to the
// API (the subject catalog on load, and the login call on submit). When the API
// answered with an HTML error page, the client's unguarded JSON.parse threw
// "Unexpected token '<' ... is not valid JSON" and that raw message was shown to
// the teacher. The response is now parsed defensively, so the teacher sees an
// ordinary, readable error instead.
const HTML_ERROR_PAGE = '<!DOCTYPE html>\n<html><body><pre>Internal Server Error</pre></body></html>';

function stubHtmlErrors() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: false, status: 500, text: async () => HTML_ERROR_PAGE })) as unknown as typeof fetch,
  );
}

function renderTeacherLogin() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <Router>
        <TeacherAuth mode="login" />
      </Router>
    </QueryClientProvider>,
  );
}

describe('TeacherAuth', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('shows a readable error, not the JSON parse error, when login gets an HTML 500', async () => {
    stubHtmlErrors();
    renderTeacherLogin();

    fireEvent.change(await screen.findByTestId('input-teacher-email'), { target: { value: 'teacher@example.com' } });
    fireEvent.change(screen.getByTestId('input-teacher-password'), { target: { value: 'password123' } });
    fireEvent.click(screen.getByTestId('button-teacher-submit'));

    const error = await screen.findByTestId('status-teacher-auth-error');
    await waitFor(() => expect(error.textContent).toBeTruthy());
    // The old code surfaced the raw SyntaxError message here.
    expect(error.textContent).not.toMatch(/Unexpected token/i);
    expect(error.textContent).not.toMatch(/is not valid JSON/i);
    expect(error.textContent).toMatch(/something went wrong/i);
  });
});

