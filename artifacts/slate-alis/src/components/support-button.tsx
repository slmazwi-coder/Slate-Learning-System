import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'wouter';
import { MessageCircle, X } from 'lucide-react';
import {
  SUPPORT_CATEGORIES,
  buildSupportMessage,
  isSupportRole,
  logSupportClick,
  supportUrl,
  useSupportConfig,
  type SupportCategory,
} from '@/lib/support';

// WhatsApp support, for adult accounts only.
//
// The component renders nothing at all unless the API reports a configured
// number AND the caller passes an adult role. A learner page never passes a
// role, and an unknown role is refused, so the button cannot appear for a
// learner even if it were placed on their screen by mistake.
//
// Before opening the chat the adult must pick a category. The prefilled message
// carries the role, SLATE ID, school, page and category — never marks, answers,
// learner names, emails or passwords.
export function SupportButton({
  role,
  slateId,
  schoolName,
  className,
}: {
  role?: string | null;
  slateId?: string | null;
  schoolName?: string | null;
  className?: string;
}) {
  const config = useSupportConfig();
  const [location] = useLocation();
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<SupportCategory | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  // Close on Escape, and on a click outside the panel.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    const onClick = (event: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onClick);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onClick);
    };
  }, [open]);

  // A missing number, an unknown role, or a learner role all hide the button.
  if (config.isLoading || !config.data?.enabled || !config.data.number || !isSupportRole(role)) return null;

  const categories = (config.data.categories?.length ? config.data.categories : SUPPORT_CATEGORIES) as SupportCategory[];

  const start = () => {
    if (!category) return;
    const message = buildSupportMessage({ role, slateId, schoolName, path: location, category });
    // Fire-and-forget: the click is logged, the message is not.
    void logSupportClick({ category, path: location });
    window.open(supportUrl(config.data!.number!, message), '_blank', 'noopener,noreferrer');
    setOpen(false);
    setCategory(null);
  };

  return (
    <div className={className ?? 'relative inline-block'}>
      <button
        type="button"
        onClick={() => setOpen((previous) => !previous)}
        data-testid="button-support-whatsapp"
        aria-expanded={open}
        className="inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-[10px] border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 py-2 text-xs font-bold text-[hsl(var(--foreground))] hover:border-[hsl(var(--accent))]"
      >
        <MessageCircle size={15} />Get help on WhatsApp
      </button>

      {open && (
        <div
          ref={panelRef}
          data-testid="panel-support-whatsapp"
          className="absolute bottom-full left-0 z-50 mb-2 w-[min(20rem,calc(100vw-2.5rem))] rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4 shadow-xl"
        >
          <div className="flex items-start justify-between gap-3">
            <p className="text-sm font-bold">What do you need help with?</p>
            <button type="button" onClick={() => setOpen(false)} data-testid="button-support-close" aria-label="Close" className="shrink-0 text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"><X size={16} /></button>
          </div>
          <div className="mt-3 space-y-1.5">
            {categories.map((option) => (
              <button
                type="button"
                key={option}
                onClick={() => setCategory(option)}
                data-testid={`button-support-category-${option.toLowerCase().replaceAll(/[^a-z]+/g, '-')}`}
                className={`block w-full rounded-xl border px-3 py-2 text-left text-xs font-semibold ${category === option ? 'border-[hsl(var(--accent))] bg-[hsl(var(--secondary))] text-[hsl(var(--secondary-foreground))]' : 'border-[hsl(var(--border))] hover:border-[hsl(var(--accent))]'}`}
              >
                {option}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={start}
            disabled={!category}
            data-testid="button-support-open"
            className="mt-3 w-full rounded-[10px] bg-[hsl(var(--accent))] px-3 py-2.5 text-xs font-bold text-[hsl(var(--accent-foreground))] disabled:opacity-50"
          >
            Open WhatsApp
          </button>
          <p data-testid="text-support-hours" className="mt-3 text-[10px] font-semibold text-[hsl(var(--muted-foreground))]">{config.data.hours}</p>
          <p data-testid="text-support-disclosure" className="mt-1 text-[10px] leading-4 text-[hsl(var(--muted-foreground))]">{config.data.disclosure}</p>
        </div>
      )}

      {/* Hours and the third-party disclosure sit beside the button, always
          visible, not only when the panel is open. */}
      <p data-testid="text-support-hours-inline" className="mt-1.5 max-w-[16rem] text-[10px] leading-4 text-[hsl(var(--muted-foreground))]">
        {config.data.hours} · {config.data.disclosure}
      </p>
    </div>
  );
}
