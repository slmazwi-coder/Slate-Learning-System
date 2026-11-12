import { createHash, randomBytes } from "node:crypto";
import { pool } from "@workspace/db";

export const recoveryHash = (code: string) => createHash("sha256").update(code).digest("hex");

export async function sendRecoveryCode(email: string): Promise<boolean> {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.RECOVERY_EMAIL_FROM;
  if (!key || !from) return false;
  const code = randomBytes(32).toString("base64url");
  const hash = recoveryHash(code);
  await pool.query("DELETE FROM slate_recovery_tokens WHERE expires_at < now()");
  await pool.query("INSERT INTO slate_recovery_tokens (token_hash, email, expires_at) VALUES ($1, $2, now() + interval '15 minutes')", [hash, email]);
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST", signal: AbortSignal.timeout(10_000),
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [email], subject: "Your Slate recovery code", text: `Enter this code on the Slate password recovery page. It expires in 15 minutes and can be used once.\n\n${code}\n\nIf you did not request it, ignore this message.` }),
    });
    if (!response.ok) throw new Error("Email delivery failed");
    return true;
  } catch {
    await pool.query("DELETE FROM slate_recovery_tokens WHERE token_hash = $1", [hash]);
    return false;
  }
}

export async function recoveryCodeValid(email: string, code: string): Promise<boolean> {
  const result = await pool.query("SELECT 1 FROM slate_recovery_tokens WHERE email = $1 AND token_hash = $2 AND expires_at > now()", [email, recoveryHash(code)]);
  return Boolean(result.rowCount);
}
