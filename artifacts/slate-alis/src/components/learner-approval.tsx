import { useState } from 'react';

export function LearnerApproval() {
  const [role, setRole] = useState<'parent' | 'tutor' | 'teacher'>('parent');
  const [slateId, setSlateId] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  async function createCode() {
    setError(''); setCode(''); setCopied(false); setBusy(true);
    try {
      const response = await fetch('/api/auth/learner-approval', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role, slateId }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'Could not create a code.');
      setCode(body.code);
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not create a code.'); }
    finally { setBusy(false); }
  }
  return <section className="rounded-[2rem] border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-6 sm:p-8">
    <h2 className="text-lg font-bold">Approve an account link</h2>
    <p className="mt-2 text-sm text-[hsl(var(--muted-foreground))]">1. Ask the adult for their SLATE ID. 2. Create a code below. 3. Share the code only with that person. A parent can view, reset and delete your account.</p>
    <div className="mt-4 flex flex-wrap gap-3">
      <select aria-label="Adult role" value={role} onChange={(e) => { setRole(e.target.value as typeof role); setCode(''); }} className="rounded-xl border border-[hsl(var(--input))] bg-transparent p-2"><option value="parent">Parent</option><option value="tutor">Tutor</option><option value="teacher">Teacher</option></select>
      <input aria-label="Adult SLATE ID" value={slateId} onChange={(e) => { setSlateId(e.target.value); setCode(''); }} placeholder="Adult SLATE ID" className="rounded-xl border border-[hsl(var(--input))] bg-transparent p-2" />
      <button type="button" disabled={busy || !slateId.trim()} onClick={createCode} className="rounded-xl bg-[hsl(var(--primary))] px-4 py-2 text-sm font-bold text-[hsl(var(--primary-foreground))] disabled:opacity-50">{busy ? 'Creating…' : 'Create code'}</button>
    </div>
    {code && <div><button type="button" onClick={async () => { try { await navigator.clipboard.writeText(code); setCopied(true); } catch { setError("Copy unavailable. Select and copy the code below."); } }} className="mt-3 min-h-11 rounded-xl border px-4 text-sm font-bold">{copied ? "Copied" : "Copy code"}</button><p className="mt-4 break-all text-sm"><strong>One-use code (expires in 10 minutes):</strong> {code}</p></div>}
    {error && <p className="mt-3 text-sm text-[#93473a]">{error}</p>}
  </section>;
}
