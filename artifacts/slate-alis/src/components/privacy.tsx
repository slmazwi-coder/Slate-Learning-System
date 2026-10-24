import { Link } from 'wouter';

// POPIA consent: shown when a parent or tutor creates a child account. The text
// mirrors the server's CONSENT_SUMMARY so the adult knows exactly what is stored
// and that an external AI service processes the child's answers and uploads.
export function ConsentCheckbox({ checked, onChange, testId, guardian = false }: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  testId: string;
  guardian?: boolean;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-2.5">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        data-testid={testId}
        className="mt-0.5 size-4 shrink-0 rounded border-[hsl(var(--input))] accent-[hsl(var(--accent))]"
      />
      <span className="text-[11px] font-semibold leading-5 text-[hsl(var(--muted-foreground))]">
        {guardian
          ? "I confirm I have the parent or guardian's consent to create this child's Slate account. "
          : 'I confirm I am this child\u2019s parent or legal guardian. '}
        I consent to Slate storing their name, grade, school, date of birth, gender, home language, answers and learning
        profile, and I understand their answers and any uploaded files are processed by an external AI service (Google
        Gemini) for question generation, marking and feedback.
      </span>
    </label>
  );
}

// Link to the public privacy notice, shown next to every consent checkbox and
// on the registration screens.
export function PrivacyNoticeLink({ className }: { className?: string }) {
  return <Link href="/privacy" data-testid="link-privacy-notice" className={className ?? 'text-[11px] font-bold text-[hsl(var(--accent-foreground))] underline underline-offset-2'}>Read the privacy notice</Link>;
}
