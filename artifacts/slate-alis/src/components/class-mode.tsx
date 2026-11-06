import { useRef, useState } from 'react';
import { FileUp, Loader2, ListOrdered, Lock, UserRound, Zap } from 'lucide-react';
import type { ClassMode, TeacherClass } from '@/lib/tis-api';

function cn(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(' ');
}

export type CurriculumPayload = { fileName?: string; text?: string; pdfBase64?: string };

// Per-class operating mode toggle: blue = teacher-dependent, green = independent.
export function ClassModeToggle({ mode, pending, onSelect, testIdPrefix }: {
  mode: ClassMode;
  pending: boolean;
  onSelect: (mode: ClassMode) => void;
  testIdPrefix: string;
}) {
  const options: Array<{ value: ClassMode; label: string; hint: string; icon: typeof Zap; active: string; idle: string }> = [
    {
      value: 'TEACHER_DEPENDENT',
      label: 'Teacher-dependent',
      hint: 'You set the work',
      icon: UserRound,
      active: 'bg-[#dbe7f6] text-[#1e4e8c] border-[#1e4e8c]',
      idle: 'border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))] hover:border-[#1e4e8c]',
    },
    {
      value: 'INDEPENDENT',
      label: 'Independent',
      hint: 'Slate teaches autonomously',
      icon: Zap,
      active: 'bg-[#d9efe0] text-[#1d6b3c] border-[#1d6b3c]',
      idle: 'border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))] hover:border-[#1d6b3c]',
    },
  ];
  return (
    <div className="grid grid-cols-2 gap-2" onClick={(event) => event.stopPropagation()}>
      {options.map((option) => {
        const Icon = option.icon;
        const isActive = mode === option.value;
        return (
          <button
            key={option.value}
            type="button"
            disabled={pending}
            onClick={() => onSelect(option.value)}
            data-testid={`${testIdPrefix}-mode-${option.value.toLowerCase().replace('_', '-')}`}
            className={cn('rounded-xl border px-3 py-2.5 text-left transition-colors disabled:opacity-50', isActive ? option.active : option.idle)}
          >
            <span className="flex items-center gap-1.5 text-xs font-bold"><Icon size={13} />{option.label}</span>
            <span className="mt-0.5 block text-[10px] font-semibold opacity-75">{option.hint}</span>
          </button>
        );
      })}
    </div>
  );
}

// The curriculum is locked: every class teaches the hardwired CAPS preset for
// its subject and grade. This panel shows what Slate will teach, in order, and
// makes clear it cannot be replaced.
export function LockedCurriculum({ subject, sourceName, sequence, testIdPrefix, circular }: {
  subject: string;
  sourceName: string | null;
  sequence: string[];
  testIdPrefix: string;
  circular?: string;
}) {
  // A class follows the departmental Annual Teaching Plan where one has been
  // issued for its subject and grade, and the CAPS preset otherwise. The label
  // has to say which, because the ATP re-sequences the year and a teacher needs
  // to know their plan changed.
  const onAtp = Boolean(sourceName && /annual teaching plan/i.test(sourceName));
  const label = onAtp ? "Annual Teaching Plan (locked)" : "CAPS curriculum (locked)";
  const blurb = onAtp
    ? `${subject} follows the department's Annual Teaching Plan for this grade${sourceName ? ` (${sourceName})` : ''}. It cannot be replaced — Slate teaches the official sequence in order.`
    : `${subject} follows the prescribed CAPS curriculum for this grade${sourceName ? ` (${sourceName})` : ''}. It cannot be replaced — Slate teaches the official sequence in order.`;
  return (
    <div className="mt-3 rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--muted)/.35)] p-4" data-testid={`${testIdPrefix}-locked-curriculum`}>
      <p className="flex items-center gap-1.5 text-xs font-bold"><Lock size={13} /> {label}</p>
      <p className="mt-1 text-[11px] leading-4 text-[hsl(var(--muted-foreground))]">
        {blurb}
      </p>
      {circular && (
        <p className="mt-1 text-[11px] leading-4 text-[hsl(var(--muted-foreground))]" data-testid={`${testIdPrefix}-curriculum-circular`}>
          Governed by {circular}.
        </p>
      )}
      {sequence.length > 0 && (
        <ol className="mt-3 max-h-40 space-y-1 overflow-y-auto pr-1" data-testid={`${testIdPrefix}-lesson-sequence`}>
          {sequence.map((topic, index) => (
            <li key={`${topic}-${index}`} className="flex items-start gap-2 text-[11px]">
              <span className="mono-face shrink-0 text-[hsl(var(--muted-foreground))]">{index + 1}.</span>
              <span>{topic}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

// A tutor's programme is supplementary material: it is stored against the class
// for Gemini to reference, but the CAPS preset sequence still drives pacing.
export function ProgrammeUpload({ pending, error, savedNote, onUpload, testIdPrefix }: {
  pending: boolean;
  error: string;
  savedNote: string;
  onUpload: (payload: CurriculumPayload) => void;
  testIdPrefix: string;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [pasted, setPasted] = useState('');
  const [localError, setLocalError] = useState('');

  const handleFile = (file: File) => {
    setLocalError('');
    if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
      if (file.size > 3 * 1024 * 1024) {
        setLocalError('That PDF is too large. Please keep it under 3 MB.');
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = String(reader.result);
        onUpload({ fileName: file.name, pdfBase64: dataUrl.split(',')[1] ?? '' });
      };
      reader.readAsDataURL(file);
    } else {
      const reader = new FileReader();
      reader.onload = () => onUpload({ fileName: file.name, text: String(reader.result ?? '') });
      reader.readAsText(file);
    }
  };

  return (
    <div className="mt-3 rounded-2xl border border-dashed border-[hsl(var(--border))] p-4" onClick={(event) => event.stopPropagation()}>
      <p className="text-xs font-bold">Supplementary programme material</p>
      <p className="mt-1 text-[11px] leading-4 text-[hsl(var(--muted-foreground))]">
        Upload your own programme or lesson notes. Slate stores them as study material for this class and may reference them when writing questions — the prescribed CAPS sequence still sets the pace.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input
          ref={fileRef}
          type="file"
          accept=".pdf,.txt,.md,application/pdf,text/plain"
          className="hidden"
          data-testid={`${testIdPrefix}-programme-file`}
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) handleFile(file);
            event.target.value = '';
          }}
        />
        <button
          type="button"
          disabled={pending}
          onClick={() => fileRef.current?.click()}
          data-testid={`${testIdPrefix}-upload-programme`}
          className="inline-flex items-center gap-2 rounded-xl bg-[hsl(var(--primary))] px-3.5 py-2.5 text-xs font-bold text-[hsl(var(--primary-foreground))] disabled:opacity-50"
        >
          {pending ? <Loader2 size={14} className="animate-spin" /> : <FileUp size={14} />}
          {pending ? 'Saving…' : 'Upload PDF / text'}
        </button>
      </div>
      <textarea
        value={pasted}
        onChange={(event) => setPasted(event.target.value)}
        rows={3}
        placeholder="…or paste your programme text here"
        data-testid={`${testIdPrefix}-programme-text`}
        className="mt-3 w-full rounded-xl border border-[hsl(var(--input))] bg-[hsl(var(--background)/.55)] px-3 py-2.5 text-xs outline-none focus:border-[hsl(var(--accent))]"
      />
      {pasted.trim() && (
        <button
          type="button"
          disabled={pending}
          onClick={() => onUpload({ text: pasted.trim() })}
          data-testid={`${testIdPrefix}-submit-programme-text`}
          className="mt-2 inline-flex items-center gap-2 rounded-xl border border-[hsl(var(--border))] px-3.5 py-2 text-xs font-bold hover:border-[hsl(var(--accent))] disabled:opacity-50"
        >
          {pending ? <Loader2 size={14} className="animate-spin" /> : <ListOrdered size={14} />}
          Save programme material
        </button>
      )}
      {(localError || error) && <p data-testid={`${testIdPrefix}-programme-error`} className="mt-2 text-[11px] font-semibold text-[#93473a]">{localError || error}</p>}
      {savedNote && <p data-testid={`${testIdPrefix}-programme-saved`} className="mt-2 text-[11px] font-bold text-[#1d6b3c]">{savedNote}</p>}
    </div>
  );
}
