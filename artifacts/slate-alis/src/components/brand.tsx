import { Link } from 'wouter';

function cn(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(' ');
}

export const BRAND_TAGLINE = 'Assisted Learning Intelligence System';

// The chalkboard emblem from the SLATE logo. Sized in rem so it scales with the
// surrounding header.
export function BrandEmblem({ className }: { className?: string }) {
  return <img src="/slate-mark.png" alt="" aria-hidden="true" width={256} height={256} className={cn('size-9 shrink-0 rounded-full object-contain drop-shadow-sm', className)} />;
}

export function BrandLockup({
  href = '/',
  testId = 'link-home',
  suffix,
  tagline,
  tone = 'light',
}: {
  href?: string;
  testId?: string;
  suffix?: string;
  tagline?: string;
  tone?: 'light' | 'dark';
}) {
  const title = tone === 'dark' ? 'text-[hsl(var(--sidebar-foreground))]' : 'text-[hsl(var(--foreground))]';
  const sub = tone === 'dark' ? 'text-[hsl(var(--sidebar-foreground)/.6)]' : 'text-[hsl(var(--muted-foreground))]';
  return (
    <Link href={href} data-testid={testId} className="flex items-center gap-3">
      <BrandEmblem />
      <span className="leading-tight">
        <span className={cn('display-face block text-lg font-bold tracking-tight', title)}>
          SLATE{suffix ? <span className="text-[hsl(var(--accent))]"> {suffix}</span> : null}
        </span>
        <span className={cn('block text-[10px] font-semibold uppercase tracking-[.14em]', sub)}>{tagline ?? BRAND_TAGLINE}</span>
      </span>
    </Link>
  );
}

// Subtle attribution shown once at the bottom of every shell.
export function PoweredBy({ tone = 'light', className }: { tone?: 'light' | 'dark'; className?: string }) {
  const color = tone === 'dark' ? 'text-[hsl(var(--sidebar-foreground)/.45)]' : 'text-[hsl(var(--muted-foreground)/.75)]';
  return (
    <p data-testid="text-powered-by" className={cn('mono-face text-center text-[10px] uppercase tracking-[.22em]', color, className)}>
      Powered by <span className="font-medium">AGE THIRTY4 TECH</span>
    </p>
  );
}
