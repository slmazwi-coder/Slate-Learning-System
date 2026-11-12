import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { Link } from 'wouter';
import { BrandLockup, PoweredBy } from '@/components/brand';

export const ROLE_ROUTES = [
  { role: 'Learner', login: '/login', register: '/register' },
  { role: 'Teacher', login: '/teacher/login', register: '/teacher/register' },
  { role: 'Parent', login: '/parent/login', register: '/parent/register' },
  { role: 'Tutor', login: '/tutor/login', register: '/tutor/register' },
  { role: 'HOD', login: '/hod/login', register: '/hod/register' },
] as const;

export function Logo({ tone = 'light' }: { tone?: 'light' | 'dark' }) {
  return <BrandLockup suffix="ALIS" tone={tone} />;
}

export function RoleDropdown({ kind }: { kind: 'login' | 'register' }) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const label = kind === 'login' ? 'Log in' : 'Create account';
  const testId = kind === 'login' ? 'dropdown-login-role' : 'dropdown-register-role';

  // Dismiss on a click outside the menu or on Escape. Using pointerdown rather
  // than blur keeps the menu mounted until a role link's own click fires, so
  // navigation is never interrupted mid-selection (Safari blurs an anchor on
  // mousedown before the click lands).
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div ref={wrapperRef} className="relative">
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="true"
        onClick={() => setOpen((value) => !value)}
        data-testid={`${testId}-toggle`}
        className={`inline-flex h-9 shrink-0 items-center justify-center gap-1 whitespace-nowrap rounded-[10px] px-2 text-xs font-bold transition-colors sm:h-10 sm:gap-1.5 sm:rounded-lg sm:px-4 sm:text-sm ${
          kind === 'login'
            ? 'border border-[hsl(var(--border))] bg-[hsl(var(--card))] text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))]'
            : 'border border-transparent bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] shadow-sm hover:bg-[hsl(var(--primary)/.92)]'
        }`}
      >
        <span className="sm:hidden">{kind === 'login' ? 'Log in' : 'Sign up'}</span>
        <span className="hidden sm:inline">{label}</span>
        <ChevronDown aria-hidden="true" className={`hidden size-3.5 shrink-0 transition-transform min-[360px]:block ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <ul data-testid={`${testId}-menu`} className="absolute right-0 top-full z-40 mt-2 w-44 overflow-hidden rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] py-1 shadow-lg">
          {ROLE_ROUTES.map((entry) => (
            <li key={entry.role}>
              <Link
                href={kind === 'login' ? entry.login : entry.register}
                data-testid={`${testId}-option-${entry.role.toLowerCase()}`}
                className="block px-4 py-2.5 text-sm font-bold text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))] focus-visible:bg-[hsl(var(--muted))]"
                onClick={() => setOpen(false)}
              >
                {entry.role}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function PublicShell({ children }: { children: ReactNode }) {
  return (
    <div className="public-shell public-page grain flex min-h-[100dvh] flex-col bg-[hsl(var(--background))]">
      <header className="mx-auto flex w-full max-w-7xl flex-wrap items-center justify-between gap-x-3 gap-y-3 px-4 py-4 sm:px-8 sm:py-6">
        <Logo />
        <nav aria-label="Account actions" className="ml-auto flex items-center gap-1.5 sm:gap-2">
          <RoleDropdown kind="login" />
          <RoleDropdown kind="register" />
        </nav>
      </header>
      <div className="flex-1">{children}</div>
      <footer className="px-5 py-8 sm:px-8"><PoweredBy /></footer>
    </div>
  );
}
