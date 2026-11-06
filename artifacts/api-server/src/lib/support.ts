// WhatsApp support configuration. The number is a WhatsApp click-to-chat
// (wa.me) target: digits only, international, no leading "+". It is served from
// the API rather than baked into the frontend bundle so one deployment can turn
// the button off, and so the value is never a VITE_* variable that would be
// compiled into the JavaScript.

export const SUPPORT_HOURS = "Mon–Fri, 08:00–17:00 (SAST)";

// The disclosure that must sit beside the button. WhatsApp is a third party, so
// a support chat is not a private Slate channel and must never carry marks or
// credentials.
export const SUPPORT_DISCLOSURE = "WhatsApp is run by Meta. Never send learner marks or passwords in chat.";

// The only categories a support request may be filed under. A closed list keeps
// free text (and therefore learner data) out of the prefilled message.
export const SUPPORT_CATEGORIES = [
  "Login help",
  "Assignments and marking",
  "Class codes",
  "Account and privacy",
  "HOD change",
] as const;

export type SupportCategory = (typeof SUPPORT_CATEGORIES)[number];

// Digits only. A stray "+", spaces or a pasted "wa.me/" link would otherwise
// produce a broken wa.me URL, so anything that is not a digit is stripped and
// the result is length-checked like an international subscriber number.
export function normalizeSupportNumber(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  if (digits.length < 8 || digits.length > 15) return null;
  return digits;
}

export function whatsappSupportNumber(env: NodeJS.ProcessEnv = process.env): string | null {
  return normalizeSupportNumber(env.WHATSAPP_SUPPORT_NUMBER);
}

export function isSupportCategory(value: unknown): value is SupportCategory {
  return typeof value === "string" && (SUPPORT_CATEGORIES as readonly string[]).includes(value);
}
