import { useQuery } from '@tanstack/react-query';

// WhatsApp support for adult accounts. The message is built from a closed set of
// fields — role, SLATE ID, school, page and category — and nothing else. There
// is deliberately no parameter for marks, answers, learner names, emails or
// passwords, so none of them can reach the chat even by mistake.

export const SUPPORT_CATEGORIES = [
  'Login help',
  'Assignments and marking',
  'Class codes',
  'Account and privacy',
  'HOD change',
] as const;

export type SupportCategory = (typeof SUPPORT_CATEGORIES)[number];

// The only roles that may use the support line. A learner is absent on purpose.
export const SUPPORT_ROLES = ['TEACHER', 'PARENT', 'TUTOR', 'HOD'] as const;

export type SupportRole = (typeof SUPPORT_ROLES)[number];

const ROLE_LABEL: Record<SupportRole, string> = {
  TEACHER: 'Teacher',
  PARENT: 'Parent',
  TUTOR: 'Tutor',
  HOD: 'HOD',
};

export function isSupportRole(role: unknown): role is SupportRole {
  return typeof role === 'string' && (SUPPORT_ROLES as readonly string[]).includes(role);
}

// Removes anything that looks like an email address, a URL or a long digit run
// (a phone number or an ID pasted into a free-text field) and collapses
// whitespace. This is belt-and-braces: the caller never supplies these fields,
// but a school name is free text and must not become a leak.
export function sanitizeSupportField(value: string | null | undefined, maxLength = 60): string {
  if (!value) return '';
  return value
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '')
    .replace(/https?:\/\/\S+/gi, '')
    .replace(/\d{7,}/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

export type SupportMessageInput = {
  role: SupportRole;
  slateId?: string | null;
  schoolName?: string | null;
  path?: string | null;
  category: SupportCategory;
};

// "Hi Slate support. Role: <role>. SLATE ID: <id>. School: <school, if known>.
// Page: <path>. Category: <category>. Please help with: "
export function buildSupportMessage(input: SupportMessageInput): string {
  const role = ROLE_LABEL[input.role];
  const slateId = sanitizeSupportField(input.slateId, 20);
  const school = sanitizeSupportField(input.schoolName, 60);
  // Only the path travels, never a query string, which could carry a token.
  const path = sanitizeSupportField(input.path?.split('?')[0], 80);
  const parts = [`Hi Slate support. Role: ${role}.`];
  if (slateId) parts.push(`SLATE ID: ${slateId}.`);
  // The school clause is omitted entirely when the school is not known.
  if (school) parts.push(`School: ${school}.`);
  if (path) parts.push(`Page: ${path}.`);
  parts.push(`Category: ${input.category}.`);
  parts.push('Please help with: ');
  return parts.join(' ');
}

// wa.me click-to-chat. The number is digits only (international, no "+"), and
// the message is URL-encoded so the whole text arrives intact.
export function supportUrl(number: string, message: string): string {
  return `https://wa.me/${number.replace(/\D/g, '')}?text=${encodeURIComponent(message)}`;
}

export type SupportConfig = {
  enabled: boolean;
  number: string | null;
  hours: string;
  disclosure: string;
  categories: string[];
};

// Public config, fetched so a missing WHATSAPP_SUPPORT_NUMBER hides the button
// without a redeploy.
export function useSupportConfig() {
  return useQuery<SupportConfig>({
    queryKey: ['support', 'config'],
    queryFn: async () => {
      const response = await fetch('/api/support/config');
      if (!response.ok) throw new Error('Support config unavailable');
      return response.json() as Promise<SupportConfig>;
    },
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
}

// Records the click for the audit log. Only the category and the page are sent;
// the message text is never transmitted, so it can never be logged.
export async function logSupportClick(input: { category: SupportCategory; path?: string | null }): Promise<void> {
  try {
    // The role is not sent: the server reads it from the session.
    await fetch('/api/support/click', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ category: input.category, path: input.path?.split('?')[0] ?? undefined }),
    });
  } catch {
    // A failed audit write must never stop the adult reaching support.
  }
}
