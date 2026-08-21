import { useRef, useState } from 'react';
import { FileUp, Loader2, ListOrdered, UserRound, Zap } from 'lucide-react';
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

// Curriculum upload for INDEPENDENT classes: PDF or pasted text. The response
// sequence is shown so the owner can see what Slate will teach, in order.
export function CurriculumUpload({ pending, error, sequence, currentFileName, onUpload, testIdPrefix }: {
  pending: boolean;
  error: string;
  sequence: string[];
  currentFileName: string | null;
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
      <p className="text-xs font-bold">Curriculum for independent mode</p>
      <p className="mt-1 text-[11px] leading-4 text-[hsl(var(--muted-foreground))]">
        Upload a PDF or text document and Slate will read it, extract the lesson sequence, and teach it in order.
      </p>
      {currentFileName && !sequence.length && (
        <p className="mt-2 text-[11px] font-semibold text-[hsl(var(--secondary-foreground))]">Current curriculum: {currentFileName}</p>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input
          ref={fileRef}
          type="file"
          accept=".pdf,.txt,.md,application/pdf,text/plain"
          className="hidden"
          data-testid={`${testIdPrefix}-curriculum-file`}
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
          data-testid={`${testIdPrefix}-upload-curriculum`}
          className="inline-flex items-center gap-2 rounded-xl bg-[hsl(var(--primary))] px-3.5 py-2.5 text-xs font-bold text-[hsl(var(--primary-foreground))] disabled:opacity-50"
        >
          {pending ? <Loader2 size={14} className="animate-spin" /> : <FileUp size={14} />}
          {pending ? 'Reading document…' : 'Upload PDF / text'}
        </button>
      </div>
      <textarea
        value={pasted}
        onChange={(event) => setPasted(event.target.value)}
        rows={3}
        placeholder="…or paste the curriculum text here"
        data-testid={`${testIdPrefix}-curriculum-text`}
        className="mt-3 w-full rounded-xl border border-[hsl(var(--input))] bg-[hsl(var(--background)/.55)] px-3 py-2.5 text-xs outline-none focus:border-[hsl(var(--accent))]"
      />
      {pasted.trim() && (
        <button
          type="button"
          disabled={pending}
          onClick={() => onUpload({ text: pasted.trim() })}
          data-testid={`${testIdPrefix}-submit-curriculum-text`}
          className="mt-2 inline-flex items-center gap-2 rounded-xl border border-[hsl(var(--border))] px-3.5 py-2 text-xs font-bold hover:border-[hsl(var(--accent))] disabled:opacity-50"
        >
          {pending ? <Loader2 size={14} className="animate-spin" /> : <ListOrdered size={14} />}
          Extract lesson sequence
        </button>
      )}
      {(localError || error) && <p data-testid={`${testIdPrefix}-curriculum-error`} className="mt-2 text-[11px] font-semibold text-[#93473a]">{localError || error}</p>}
      {sequence.length > 0 && (
        <div className="mt-3" data-testid={`${testIdPrefix}-lesson-sequence`}>
          <p className="text-[11px] font-bold text-[#1d6b3c]">Lesson sequence extracted — Slate will teach these in order:</p>
          <ol className="mt-2 max-h-40 space-y-1 overflow-y-auto pr-1">
            {sequence.map((topic, index) => (
              <li key={`${topic}-${index}`} className="flex items-start gap-2 text-[11px]">
                <span className="mono-face shrink-0 text-[hsl(var(--muted-foreground))]">{index + 1}.</span>
                <span>{topic}</span>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}
