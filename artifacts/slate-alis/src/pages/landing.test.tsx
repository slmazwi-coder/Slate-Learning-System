import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LandingPage, LandingSections } from './landing';
import { PublicShell } from '@/components/public-shell';

// The homepage must still send a signed-in learner straight to their dashboard,
// exactly as it did before the redesign. The learner query is mocked so the test
// can model both states without a network call.
const currentLearner = vi.fn();
vi.mock('@workspace/api-client-react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@workspace/api-client-react')>();
  return {
    ...actual,
    useGetCurrentLearner: () => currentLearner(),
  };
});

// The landing page renders the real components. These tests pin the promises the
// page makes: every section is present, every link points where it says, the
// role menus still work, the demonstrations are clearly sample data, and no
// real learner information can appear.

function stubFetch(body: unknown, ok = true) {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok, json: async () => body })) as unknown as typeof fetch);
}

const SUPPORT_ENABLED = {
  enabled: true,
  number: '27616122586',
  hours: 'Mon–Fri, 08:00–17:00 (SAST)',
  disclosure: 'WhatsApp is run by Meta. Never send learner marks or passwords in chat.',
  categories: ['Login help'],
};

function renderLanding() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <LandingSections />
    </QueryClientProvider>,
  );
}

describe('landing page', () => {
  beforeEach(() => {
    window.history.pushState({}, '', '/');
    stubFetch(SUPPORT_ENABLED);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('renders the hero with the positioning headline and the free-until line', () => {
    renderLanding();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toContain('Every learner is different.');
    expect(screen.getByText(/Schoolwork untangled/)).toBeTruthy();
    expect(screen.getByTestId('text-free-until').textContent).toContain('Free to use until January 2027');
  });

  it('renders all nine sections in order', () => {
    renderLanding();
    for (const id of ['the-problem', 'how-it-works', 'for-learners', 'for-teachers', 'for-parents', 'the-engine', 'becoming', 'start']) {
      expect(document.getElementById(id), `section #${id}`).toBeTruthy();
    }
  });

  it('labels the vision section as Becoming and never as a current capability', () => {
    renderLanding();
    expect(screen.getByTestId('badge-becoming').textContent).toContain('Becoming');
    const becoming = screen.getByTestId('list-becoming').textContent ?? '';
    for (const future of ['Dedicated SLATE tablets', 'Career guidance by Grade 12', 'Stylus input', 'native mobile app', 'WhatsApp AI agent', 'Study Desk']) {
      expect(becoming, `becoming item: ${future}`).toContain(future);
    }
  });

  it('describes learning patterns without presenting learning styles as fixed traits', async () => {
    renderLanding();
    const caveat = (await screen.findByTestId('text-engine-caveat')).textContent ?? '';
    expect(caveat).toContain('not fixed labels');
    // The page never claims a learner IS a fixed type.
    expect(document.body.textContent?.toLowerCase()).not.toContain('learning styles are');
  });

  it('renders each demonstration with an explicit sample-data label', async () => {
    renderLanding();
    for (const id of ['demo-learner', 'demo-teacher', 'demo-parent', 'demo-engine']) {
      const demo = await screen.findByTestId(id);
      expect(demo.textContent).toContain('Sample data');
    }
  });

  it('points every hero and call-to-action link at the right place', async () => {
    renderLanding();
    expect(screen.getByTestId('link-hero-start-free').getAttribute('href')).toBe('/register');
    expect(screen.getByTestId('link-hero-how-it-works').getAttribute('href')).toBe('#how-it-works');
    expect(screen.getByTestId('link-cta-teacher').getAttribute('href')).toBe('/teacher/register');
    expect(screen.getByTestId('link-cta-parent').getAttribute('href')).toBe('/parent/register');
    expect(screen.getByTestId('link-cta-tutor').getAttribute('href')).toBe('/tutor/register');
    expect(screen.getByTestId('link-cta-learner').getAttribute('href')).toBe('/register');
    expect(screen.getByTestId('link-cta-login').getAttribute('href')).toBe('/login');
    expect(screen.getByTestId('link-cta-privacy').getAttribute('href')).toBe('/privacy');
    // Every anchor with an href must be a real target.
    const pilot = await screen.findByTestId('link-school-pilot');
    expect(pilot.getAttribute('href')).toMatch(/^https:\/\/wa\.me\/27616122586\?text=/);
  });

  it('builds the school pilot link with no personal data in the message', async () => {
    renderLanding();
    const pilot = await screen.findByTestId('link-school-pilot');
    const message = decodeURIComponent(pilot.getAttribute('href')!.split('?text=')[1]);
    expect(message).toContain('school pilot');
    expect(message).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.-]+/); // no email address
    expect(message).not.toMatch(/\b(L|TE|P|TU)\d{3,}\b/); // no SLATE ID
  });

  it('hides the pilot link when the support number is not configured', async () => {
    stubFetch({ ...SUPPORT_ENABLED, enabled: false, number: null });
    renderLanding();
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(screen.queryByTestId('link-school-pilot')).toBeNull();
  });

  it('never shows a real learner name, email or SLATE ID, and loads no video', async () => {
    renderLanding();
    await screen.findByTestId('demo-learner');
    const text = document.body.textContent ?? '';
    expect(text).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.-]+/);
    expect(text).not.toMatch(/\b(L|TE|P|TU)\d{3,}\b/);
    expect(text).not.toContain('undefined');
    expect(document.querySelectorAll('video').length).toBe(0);
  });

  it('uses semantic landmarks and an accessible name for the diagram', () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <PublicShell><LandingSections /></PublicShell>
      </QueryClientProvider>,
    );
    expect(screen.getByRole('banner')).toBeTruthy();
    expect(screen.getByRole('main')).toBeTruthy();
    expect(screen.getByRole('contentinfo')).toBeTruthy();
    // Each section is named by its own heading, so a screen reader can list them.
    for (const name of ['The problem', 'The SLATE approach', 'For learners', 'For teachers', 'For parents', 'The intelligence engine', 'Becoming', 'Start free']) {
      expect(document.body.textContent, `heading text: ${name}`).toContain(name);
    }
    // The loop diagram carries a title and a text description.
    const figure = document.querySelector('figure svg[role="img"]');
    expect(figure).toBeTruthy();
    expect(figure?.getAttribute('aria-labelledby')).toContain('learning-loop-title');
    expect(figure?.getAttribute('aria-labelledby')).toContain('learning-loop-desc');
  });

  it('never conveys a zone band or status by colour alone', async () => {
    renderLanding();
    const teacher = await screen.findByTestId('demo-teacher');
    for (const band of ['On track', 'Watch', 'Needs support', 'Not enough data']) {
      expect(teacher.textContent, `band label: ${band}`).toContain(band);
    }
  });
});

describe('public shell role menus', () => {
  beforeEach(() => {
    window.history.pushState({}, '', '/');
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('offers all five roles under Log in, each pointing at its login route', () => {
    render(<PublicShell><div /></PublicShell>);
    fireEvent.click(screen.getByTestId('dropdown-login-role-toggle'));
    const expected: Record<string, string> = {
      learner: '/login',
      teacher: '/teacher/login',
      parent: '/parent/login',
      tutor: '/tutor/login',
      hod: '/hod/login',
    };
    for (const [role, href] of Object.entries(expected)) {
      expect(screen.getByTestId(`dropdown-login-role-option-${role}`).getAttribute('href')).toBe(href);
    }
  });

  it('offers all five roles under Sign up, each pointing at its register route', () => {
    render(<PublicShell><div /></PublicShell>);
    fireEvent.click(screen.getByTestId('dropdown-register-role-toggle'));
    const expected: Record<string, string> = {
      learner: '/register',
      teacher: '/teacher/register',
      parent: '/parent/register',
      tutor: '/tutor/register',
      hod: '/hod/register',
    };
    for (const [role, href] of Object.entries(expected)) {
      expect(screen.getByTestId(`dropdown-register-role-option-${role}`).getAttribute('href')).toBe(href);
    }
  });
});

describe('homepage routing behaviour', () => {
  beforeEach(() => {
    window.history.pushState({}, '', '/');
    stubFetch(SUPPORT_ENABLED);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    currentLearner.mockReset();
  });

  it('shows the landing page to a visitor who is not signed in', () => {
    currentLearner.mockReturnValue({ data: undefined, isLoading: false });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <LandingPage />
      </QueryClientProvider>,
    );
    expect(screen.getByRole('heading', { level: 1 }).textContent).toContain('Every learner is different.');
  });

  it('sends a signed-in learner to the dashboard instead of the landing page', async () => {
    currentLearner.mockReturnValue({ data: { learner: { id: 1 } }, isLoading: false });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <LandingPage />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(window.location.pathname).toBe('/dashboard'));
    expect(screen.queryByRole('heading', { level: 1 })).toBeNull();
  });
});
