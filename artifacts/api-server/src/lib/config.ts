import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1, "DATABASE_URL must be configured."),
  SESSION_SECRET: z.string().min(32, "SESSION_SECRET must be at least 32 characters long."),
  GEMINI_API_KEY: z.string().optional(),
  HOSTAFRICA_API_TOKEN: z.string().optional(),
  HOSTAFRICA_ADMIN_EMAILS: z.string().optional(),
});

export const config = envSchema.parse(process.env);

export const isProduction = config.NODE_ENV === "production";
