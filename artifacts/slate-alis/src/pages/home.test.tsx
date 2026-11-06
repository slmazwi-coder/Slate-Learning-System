import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { Router } from 'wouter';
import Home from '@/pages/home';
import { PublicShell } from '@/components/public-shell';
import { useGetCurrentLearner, useSupportConfig } from '@workspace/api-client-react';

vi.mock('@workspace/api-client-react', () => ({
  getGetCurrentLearnerQueryKey: () => ['/api/auth/me'],
  useGetCurrentLearner: vi.fn(),
  useSupportConfig: vi.fn(),
}));

const setCurrentLearner = vi.mocked(useGetCurrentLearner);
const setSupportConfig = vi.mocked(useSupportConfig);

function renderHome() {
  return render(<Router><Home /></Router>);
}

function renderShell() {
  return render(<Router><PublicShell><main><h1>Test shell</h1></main></PublicShell></Router>);
}

describe('public homepage', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/');
    setCurrentLearner.mockReturnValue({ data: { learner: null }, isLoading: false } as never);
    setSupportConfig.mockReturnValue({
      data: { enabled: true, number: '27611234567', hours: '', disclosure: '', categories: [] },
      isLoading: false,
    } as never);
  });

  it('renders the required sections in the requested order', () => {
    renderHome();
    const required = [
      'section-hero',
      'section-problem',
      'section-approach',
      'section-learner',
      'section-teacher',
      'section-parent',
      'section-intelligence',
      'section-vision',
      'section-cta',
    ];
    const rendered = required.map((id) => screen.getByTestId(id));
    for (let index = 1; index < rendered.length; index += 1) {
      expect(rendered[index - 1].compareDocumentPosition(rendered[index]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
    expect(screen.getByText('Free to use until January 2027')).toBeTruthy();
    expect(screen.getAllByText('Becoming')).toHaveLength(6);
  });

  it('uses the required in-page and account destinations', () => {
    renderHome();
    expect(screen.getByTestId('link-start-free-hero').getAttribute('href')).toBe('/register');
    expect(screen.getByTestId('link-see-how-it-works').getAttribute('href')).toBe('#approach');
    expect(screen.getByRole('navigation', { name: 'On this page' }).querySelectorAll('a')).toHaveLength(7);
    expect(screen.getByTestId('link-start-free-teacher').getAttribute('href')).toBe('/teacher/register');
    expect(screen.getByTestId('link-start-free-parent').getAttribute('href')).toBe('/parent/register');
    expect(screen.getByTestId('link-start-free-tutor').getAttribute('href')).toBe('/tutor/register');
  });

  it('gives every homepage link a valid route, section, or pilot destination', () => {
    renderHome();
    const validRoutes = new Set([
      '/',
      '/register',
      '/login',
      '/teacher/register',
      '/parent/register',
      '/tutor/register',
    ]);

    for (const link of screen.getAllByRole('link')) {
      const href = link.getAttribute('href');
      expect(href).toBeTruthy();
      if (href?.startsWith('#')) {
        expect(document.getElementById(href.slice(1))).toBeTruthy();
      } else if (href?.startsWith('/')) {
        expect(validRoutes.has(href)).toBe(true);
      } else {
        expect(href).toMatch(/^https:\/\/wa\.me\/\d+\?text=/);
      }
    }
  });

  it('builds the school pilot link only from enabled, configured support and a non-personal message', () => {
    renderHome();
    const pilot = screen.getByTestId('link-request-school-pilot');
    expect(pilot.getAttribute('href')).toBe(`https://wa.me/27611234567?text=${encodeURIComponent('Hello SLATE ALIS. I would like to request a school pilot.')}`);
    expect(pilot.getAttribute('target')).toBe('_blank');
    expect(pilot.getAttribute('rel')).toBe('noopener noreferrer');
    const message = decodeURIComponent(pilot.getAttribute('href')?.split('?text=')[1] ?? '');
    expect(message).not.toMatch(/name|school:|email|phone|learner|marks|score|@/i);
  });

  it('omits the pilot link when disabled or when the configured number is missing', () => {
    setSupportConfig.mockReturnValue({ data: { enabled: false, number: '27611234567' } } as never);
    const { rerender } = render(<Router><Home /></Router>);
    expect(screen.queryByTestId('link-request-school-pilot')).toBeNull();
    setSupportConfig.mockReturnValue({ data: { enabled: true, number: null } } as never);
    rerender(<Router><Home /></Router>);
    expect(screen.queryByTestId('link-request-school-pilot')).toBeNull();
    expect(screen.getByTestId('text-school-pilot-unavailable')).toBeTruthy();
  });

  it('uses authored, labelled sample demonstrations without learner data or screenshots', async () => {
    renderHome();
    expect(await screen.findByTestId('demo-learner-sample')).toBeTruthy();
    expect(screen.getByTestId('demo-teacher-sample')).toBeTruthy();
    expect(screen.getByTestId('demo-parent-sample')).toBeTruthy();
    expect(screen.getByTestId('demo-parent-usage-sample')).toBeTruthy();
    const hod = screen.getByTestId('demo-hod-sample');
    expect(within(hod).getByText('Counts only')).toBeTruthy();
    expect(within(hod).getByText('Aggregated counts only. No learner names, profiles or individual scripts.')).toBeTruthy();
    const demos = document.querySelectorAll('[data-testid^="demo-"]');
    for (const demo of demos) expect(demo.textContent).toContain('sample');
    expect(document.querySelector('video, img[src*="learner"]')).toBeNull();
    expect(document.body.textContent).not.toMatch(/Thandi Mokoena|thandi@example\.com|SL[0-9]{5,}/i);
  });

  it('does not render an authenticated learner profile on the public homepage', () => {
    setCurrentLearner.mockReturnValue({
      data: { learner: { fullName: 'PRIVATE LEARNER SENTINEL', username: 'private-sentinel' } },
      isLoading: false,
    } as never);
    renderHome();
    expect(document.body.textContent).not.toContain('PRIVATE LEARNER SENTINEL');
    expect(screen.queryByTestId('demo-learner-sample')).toBeNull();
  });
});

describe('public account menus', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/');
  });

  it.each([
    ['login', '/login', '/teacher/login', '/parent/login', '/tutor/login', '/hod/login'],
    ['register', '/register', '/teacher/register', '/parent/register', '/tutor/register', '/hod/register'],
  ] as const)('offers all role destinations in the %s menu', (kind, learner, teacher, parent, tutor, hod) => {
    renderShell();
    const toggle = screen.getByTestId(`dropdown-${kind === 'login' ? 'login' : 'register'}-role-toggle`);
    fireEvent.click(toggle);
    const menu = screen.getByTestId(`dropdown-${kind === 'login' ? 'login' : 'register'}-role-menu`);
    const expected = [learner, teacher, parent, tutor, hod];
    ['learner', 'teacher', 'parent', 'tutor', 'hod'].forEach((role, index) => {
      const option = within(menu).getByTestId(`dropdown-${kind === 'login' ? 'login' : 'register'}-role-option-${role}`);
      expect(option.getAttribute('href')).toBe(expected[index]);
    });
    fireEvent.click(within(menu).getByTestId(`dropdown-${kind === 'login' ? 'login' : 'register'}-role-option-teacher`));
    expect(screen.queryByTestId(`dropdown-${kind === 'login' ? 'login' : 'register'}-role-menu`)).toBeNull();
  });
});
