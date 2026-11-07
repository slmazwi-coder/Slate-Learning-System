import { useState, type ReactNode } from 'react';
import { Link } from 'wouter';
import { ChevronDown } from 'lucide-react';
import { BrandLockup, PoweredBy } from '@/components/brand';

// The public (signed-out) chrome: the chalkboard logo on the left and the
// paired Log in / Create account role menus on the right. Shared by the
// homepage, the auth pages, recovery and the privacy notice, so the account
// controls behave identically everywhere they appear.

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

// Paired Log in / Create account controls with a role dropdown: matching
// button shape, outline for log in and solid for the primary action.
export function RoleDropdown({ kind }: { kind: 'login' | 'register' }) {
  const [open, setOpen] = useState(false);
  const label = kind === 'login' ? 'Log in' : 'Create account';
  const shortLabel = kind === 'login' ? 'Log in' : 'Sign up';
  const testId = kind === 'login' ? 'dropdown-login-role' : 'dropdown-register-role';
  const shape = 'inline-flex h-9 shrink-0 items-center justify-center gap-1 whitespace-nowrap rounded-[10px] px-2 text-xs font-bold sm:h-10 sm:gap-1.5 sm:rounded-lg sm:px-4 sm:text-sm';
  return (
    <div className="relative" onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setOpen(false); }}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        data-testid={`${testId}-toggle`}
        aria-haspopup="menu"
        aria-expanded={open}
        className={kind === 'login'
          ? `${shape} border border-[hsl(var(--border))] bg-[hsl(var(--card))] text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))]`
          : `${shape} border border-transparent bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] shadow-sm hover:bg-[hsl(var(--primary)/.92)]`}
      >
        <span className="sm:hidden">{shortLabel}</span>
        <span className="hidden sm:inline">{label}</span>
        <ChevronDown className={`hidden size-3.5 shrink-0 min-[360px]:block ${open ? 'rotate-180 transition-transform' : 'transition-transform'}`} />
      </button>
      {open && (
        <ul data-testid={`${testId}-menu`} className="absolute right-0 top-full z-40 mt-2 w-44 overflow-hidden rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] shadow-lg">
          {ROLE_ROUTES.map((entry) => (
            <li key={entry.role}>
              <Link
                href={kind === 'login' ? entry.login : entry.register}
                data-testid={`${testId}-option-${entry.role.toLowerCase()}`}
                className="block px-4 py-2.5 text-sm font-bold text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))]"
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
    <div className="public-shell grain flex min-h-[100dvh] flex-col bg-[hsl(var(--background))]">
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
