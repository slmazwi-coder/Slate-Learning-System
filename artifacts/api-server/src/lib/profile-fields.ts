import { z } from "zod";

// Profile images travel as data URLs and live inline on each profile row: the
// deploy target has no object storage and the app already moves PDFs around as
// base64 JSON. Keep the cap small (2 MB decoded ≈ 2.8 M base64 chars) so a row
// stays cheap to read on every dashboard load.
export const PROFILE_IMAGE_MAX_CHARS = 2_800_000;
const PROFILE_IMAGE_PATTERN = /^data:image\/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+/]+=*$/;

export function normalizeProfileImage(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > PROFILE_IMAGE_MAX_CHARS || !PROFILE_IMAGE_PATTERN.test(trimmed)) return null;
  return trimmed;
}

export const ProfileImageInput = z
  .string()
  .trim()
  .max(PROFILE_IMAGE_MAX_CHARS)
  .refine((value) => PROFILE_IMAGE_PATTERN.test(value), "Upload a PNG, JPG, WEBP or GIF image.");

// Boy / girl / other — the three the learner declares. Stored as free text so
// an existing account that never declared one stays valid.
export const GENDERS = ["boy", "girl", "other"] as const;
export type Gender = (typeof GENDERS)[number];
export const GenderInput = z.enum(GENDERS);

// Age is deliberately a bounded whole number rather than a date of birth: the
// request is "declare your age", and a range guards against typos.
export const AGE_MIN = 3;
export const AGE_MAX = 100;

export const LearnerProfileBody = z.object({
  fullName: z.string().trim().min(2).max(120).optional(),
  grade: z.number().int().min(0).max(13).optional(),
  schoolName: z.string().trim().min(2).max(160).optional(),
  subjects: z.array(z.string().trim().min(2)).min(1).optional(),
  age: z.number().int().min(AGE_MIN).max(AGE_MAX).optional(),
  gender: GenderInput.optional(),
  profileImage: ProfileImageInput.nullable().optional(),
});

export const ProfileImageBody = z.object({
  profileImage: ProfileImageInput.nullable(),
});
