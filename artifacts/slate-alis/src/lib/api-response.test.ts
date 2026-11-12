import { describe, expect, it, vi, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';
import { parseJsonBody } from './api-response';
import { useTeacherSession } from './tis-api';

// The failure this guards against: the API (or a proxy in front of it) answers
// with an HTML error page, and an unguarded JSON.parse throws the cryptic
// "Unexpected token '<' ... is not valid JSON" instead of a readable message.
const HTML_ERROR_PAGE = '<!DOCTYPE html>\n<html><body><pre>Internal Server Error</pre></body></html>';

function htmlResponse(status = 500) {
  return {
    ok: false,
    status,
    text: async () => HTML_ERROR_PAGE,
  };
}

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return createElement(QueryClientProvider, { client }, children);
}

describe('parseJsonBody', () => {
  it('parses a JSON body', () => {
    expect(parseJsonBody('{"error":"nope"}')).toEqual({ error: 'nope' });
  });

  it('returns null for an HTML body instead of throwing', () => {
    expect(parseJsonBody(HTML_ERROR_PAGE)).toBeNull();
  });

  it('returns null for an empty body', () => {
    expect(parseJsonBody('')).toBeNull();
  });
});

describe('teacher API client', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('surfaces a readable message when the API answers with HTML, not a JSON parse error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => htmlResponse(500)) as unknown as typeof fetch);

    const { result } = renderHook(() => useTeacherSession(), { wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
    const error = result.current.error as { status: number; message: string };
    expect(error.status).toBe(500);
    // The old code threw a SyntaxError whose message contained "Unexpected token".
    expect(error.message).not.toMatch(/Unexpected token/i);
    expect(error.message).toMatch(/something went wrong/i);
  });

  it('still reads a JSON error body when one is returned', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 401, text: async () => '{"error":"That email or password is not correct."}' })) as unknown as typeof fetch,
    );

    const { result } = renderHook(() => useTeacherSession(), { wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect((result.current.error as { message: string }).message).toBe('That email or password is not correct.');
  });
});
