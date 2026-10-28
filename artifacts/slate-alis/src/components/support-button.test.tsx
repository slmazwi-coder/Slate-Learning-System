import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SupportButton } from './support-button';
import { buildSupportMessage, sanitizeSupportField, supportUrl } from '@/lib/support';

// The component fetches /api/support/config, so every test stubs fetch. A
// missing number is modelled by the same endpoint returning enabled: false,
// which is exactly what the server does when WHATSAPP_SUPPORT_NUMBER is unset.
function stubConfig(body: unknown, ok = true) {
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok,
    json: async () => body,
  })) as unknown as typeof fetch);
}

function renderButton(props: Parameters<typeof SupportButton>[0]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <SupportButton {...props} />
    </QueryClientProvider>,
  );
}

const ENABLED = {
  enabled: true,
  number: '27616122586',
  hours: 'Mon–Fri, 08:00–17:00 (SAST)',
  disclosure: 'WhatsApp is run by Meta. Never send learner marks or passwords in chat.',
  categories: ['Login help', 'Assignments and marking', 'Class codes', 'Account and privacy', 'HOD change'],
};

describe('SupportButton', () => {
  beforeEach(() => {
    window.history.pushState({}, '', '/teacher');
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('is never rendered for a learner', async () => {
    stubConfig(ENABLED);
    renderButton({ role: 'LEARNER' });
    // Give the config query a chance to resolve: the button must still be absent.
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(screen.queryByTestId('button-support-whatsapp')).toBeNull();
  });

  it('is not rendered when no role is supplied at all', async () => {
    stubConfig(ENABLED);
    renderButton({});
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(screen.queryByTestId('button-support-whatsapp')).toBeNull();
  });

  it('is hidden when the env var is missing (config disabled)', async () => {
    stubConfig({ ...ENABLED, enabled: false, number: null });
    renderButton({ role: 'TEACHER' });
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(screen.queryByTestId('button-support-whatsapp')).toBeNull();
  });

  it('is hidden when the config request fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }) as unknown as typeof fetch);
    renderButton({ role: 'PARENT' });
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(screen.queryByTestId('button-support-whatsapp')).toBeNull();
  });

  it('is shown for an adult role once a category is chosen', async () => {
    stubConfig(ENABLED);
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    renderButton({ role: 'TEACHER', slateId: 'TE000123', schoolName: 'Test High' });
    const button = await screen.findByTestId('button-support-whatsapp');
    expect(button).toBeTruthy();
    button.click();
    const category = await screen.findByTestId('button-support-category-login-help');
    category.click();
    (await screen.findByTestId('button-support-open')).click();

    expect(open).toHaveBeenCalledTimes(1);
    const [url, target, features] = open.mock.calls[0];
    expect(url).toContain('https://wa.me/27616122586?text=');
    expect(target).toBe('_blank');
    expect(features).toBe('noopener,noreferrer');
  });

  it('shows the support hours and the Meta disclosure beside the button', async () => {
    stubConfig(ENABLED);
    renderButton({ role: 'HOD' });
    expect((await screen.findByTestId('text-support-hours-inline')).textContent).toContain('08:00–17:00');
    expect((await screen.findByTestId('text-support-hours-inline')).textContent).toContain('run by Meta');
  });
});

describe('buildSupportMessage', () => {
  it('builds the exact prefilled text', () => {
    expect(buildSupportMessage({
      role: 'TEACHER',
      slateId: 'TE000123',
      schoolName: 'Test High',
      path: '/teacher/classes',
      category: 'Class codes',
    })).toBe('Hi Slate support. Role: Teacher. SLATE ID: TE000123. School: Test High. Page: /teacher/classes. Category: Class codes. Please help with: ');
  });

  it('omits the school clause when the school is not known', () => {
    expect(buildSupportMessage({
      role: 'PARENT',
      slateId: 'P000309',
      schoolName: null,
      path: '/parent',
      category: 'Login help',
    })).toBe('Hi Slate support. Role: Parent. SLATE ID: P000309. Page: /parent. Category: Login help. Please help with: ');
  });

  it('never contains marks, answers, learner names, emails or passwords', () => {
    // A hostile caller passes fields the button must never send. They are not
    // part of the signature, so they can only arrive at runtime.
    const message = buildSupportMessage({
      role: 'TUTOR',
      slateId: 'TU000001',
      schoolName: 'Test High',
      path: '/tutor',
      category: 'Assignments and marking',
      marks: '8/10',
      answer: 'three quarters',
      learnerName: 'Thandi Mokoena',
      email: 'thandi@example.com',
      password: 'hunter2',
    } as never);

    // No field label for a disallowed value may appear. Matching on the label
    // rather than a bare substring keeps the category "Assignments and
    // marking" legitimate while still catching a leaked "Marks: 8/10".
    for (const label of ['marks:', 'answer:', 'learner:', 'email:', 'password:', 'score:', 'grade']) {
      expect(message.toLowerCase()).not.toContain(label);
    }
    // No disallowed value may appear either.
    for (const value of ['8/10', 'three quarters', 'thandi', 'hunter2', 'example.com']) {
      expect(message.toLowerCase()).not.toContain(value);
    }
    expect(message).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.-]+/);
    expect(message).not.toMatch(/\d+\s*%/);
    // The message is exactly the template: nothing else rode along.
    expect(message).toBe('Hi Slate support. Role: Tutor. SLATE ID: TU000001. School: Test High. Page: /tutor. Category: Assignments and marking. Please help with: ');
  });

  it('strips an email, a URL and a long digit run out of a free-text field', () => {
    expect(sanitizeSupportField('Rosebank High guardian@example.com https://x.test 12345678'))
      .toBe('Rosebank High');
  });

  it('drops the query string from the page so a token cannot travel', () => {
    const message = buildSupportMessage({
      role: 'TEACHER', slateId: 'TE000123', schoolName: null,
      path: '/teacher/classes?token=secrettoken123456',
      category: 'Login help',
    });
    expect(message).not.toContain('secrettoken');
    expect(message).toContain('Page: /teacher/classes.');
  });

  it('encodes the message into the wa.me URL and strips a plus from the number', () => {
    const url = supportUrl('+27 61 612 2586', 'Hi Slate support. Role: Teacher.');
    expect(url.startsWith('https://wa.me/27616122586?text=')).toBe(true);
    expect(url).toContain('Hi%20Slate%20support');
  });
});
