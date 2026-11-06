import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
// Capture every log line the app emits. The pino module is mocked to write to
// an in-memory stream, so the privacy assertions see the exact records
// pino-http and the routes produce. The mock is a real pino instance.
const logLines = vi.hoisted(() => [] as string[]);
vi.mock("pino", async () => {
  const actual = await vi.importActual<{ default: (...args: never[]) => unknown }>("pino");
  const destination = { write: (line: string) => { logLines.push(line); } };
  // The transport (pino-pretty) is dropped: it would spawn a worker thread and
  // write to the console instead of the capture stream.
  const factory = ({ transport: _transport, ...options }: Record<string, unknown> = {}) =>
    (actual.default as (...args: unknown[]) => unknown)({ ...options, level: "info" }, destination);
  // Spread the real module first so named exports (e.g. stdSerializers) keep
  // working, then override the default factory with the capturing one.
  return { ...actual, default: factory };
});

import { client, ensureSchemaReady, resetDatabase, startTestServer, stopTestServer } from "./harness";
import { createPublishedAssignment, joinClass, registerLearner, registerTeacher, submitAssignment, uniqueEmail } from "./fixtures";
import { setGeminiModelForTesting, setGeminiSleepForTesting } from "../lib/ai";
import { resetRateLimits } from "../lib/rate-limit";

describe("security hardening", () => {
  beforeAll(async () => { await startTestServer(); await ensureSchemaReady(); });
  afterAll(async () => { await stopTestServer(); });
  beforeEach(async () => { await resetDatabase(); resetRateLimits(); });

  it("sends the standard helmet security headers", async () => {
    const response = await client().get("/api/healthz");
    expect(response.status).toBe(200);
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("x-frame-options")).toBeTruthy();
    expect(response.headers.get("strict-transport-security")).toBeTruthy();
    expect(response.headers.get("x-powered-by")).toBeNull();
  });

  it("allows an allow-listed origin and refuses an unknown one", async () => {
    const allowed = await fetch(`${await startTestServer()}/api/healthz`, {
      headers: { origin: "https://www.slate-alis.co.za" },
    });
    expect(allowed.headers.get("access-control-allow-origin")).toBe("https://www.slate-alis.co.za");

    const preview = await fetch(`${await startTestServer()}/api/healthz`, {
      headers: { origin: "https://slate-alis-git-some-branch-team.vercel.app" },
    });
    expect(preview.headers.get("access-control-allow-origin")).toBe("https://slate-alis-git-some-branch-team.vercel.app");

    const evil = await fetch(`${await startTestServer()}/api/healthz`, {
      headers: { origin: "https://evil.example.com" },
    });
    expect(evil.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("caps the JSON request body", async () => {
    const response = await fetch(`${await startTestServer()}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "x", password: "y".repeat(9 * 1024 * 1024) }),
    });
    expect(response.status).toBe(413);
  });

  it("rate limits login per IP with a lockout message that never reveals an account", async () => {
    const c = client();
    let last: { status: number; body: any } | null = null;
    for (let attempt = 0; attempt < 12; attempt += 1) {
      last = await c.post("/api/auth/login", { username: `nobody-${attempt}`, password: "wrong-password" });
      if (last.status === 429) break;
    }
    expect(last?.status).toBe(429);
    expect(last?.body.error).toMatch(/too many attempts/i);
    // The message is the same whether or not the account exists.
    expect(last?.body.error).not.toMatch(/exist|not found|unknown/i);
  });

  it("rate limits registration per username across different IPs", async () => {
    const email = uniqueEmail("ratelimited");
    let limited = false;
    for (let attempt = 0; attempt < 12; attempt += 1) {
      // A fresh client gets a fresh forwarded IP, so only the per-username
      // bucket can trip.
      const response = await client().post("/api/tis/auth/register", {
        fullName: "Rate Limited", email, schoolName: "Test High", password: "password123",
        classes: [{ grade: 8, section: "A", subject: "Mathematics" }],
      });
      if (response.status === 429) { limited = true; break; }
    }
    expect(limited).toBe(true);
  });

  it("rate limits every auth route group independently", async () => {
    const routes: Array<[string, unknown]> = [
      ["/api/parent/auth/login", { email: "nobody@example.com", password: "wrong-password" }],
      ["/api/tutor/auth/login", { email: "nobody@example.com", password: "wrong-password" }],
      ["/api/tis/auth/login", { email: "nobody@example.com", password: "wrong-password" }],
      ["/api/auth/recover/lookup", { email: "nobody@example.com" }],
    ];
    for (const [path, body] of routes) {
      const c = client();
      let status = 0;
      for (let attempt = 0; attempt < 12; attempt += 1) {
        const response = await c.post(path, body);
        status = response.status;
        if (status === 429) break;
      }
      expect(`${path} -> ${status}`).toBe(`${path} -> 429`);
    }
  });

  it("never logs answer text or uploaded document content at runtime", async () => {
    logLines.length = 0;
    setGeminiModelForTesting({ generateContent: async () => { throw new Error("down"); } } as never);
    setGeminiSleepForTesting(async () => {});
    try {
      const { client: teacher, classes } = await registerTeacher();
      const { assignmentId } = await createPublishedAssignment(teacher, classes[0].id, { markingMode: "auto" });
      const { client: learner } = await registerLearner();
      await joinClass(learner, classes[0].joinCode);
      // A distinctive answer string that must never reach a log record.
      const secret = "SECRET-ANSWER-TEXT-9f3a";
      const submitted = await submitAssignment(learner, assignmentId, [
        { questionId: "q1", answer: secret },
        { questionId: "q2", answer: secret },
        { questionId: "q3", answer: secret },
      ]);
      expect(submitted.body.markingStatus).toBe("MARKING_FAILED");
      // The failed marking is logged, but only with ids and the outcome.
      expect(logLines.length).toBeGreaterThan(0);
      const joined = logLines.join("\n");
      expect(joined).not.toContain(secret);
      expect(joined).toContain(assignmentId);
    } finally {
      setGeminiModelForTesting(null);
      setGeminiSleepForTesting(null);
    }
  });

  it("has no route that logs answer or document fields", async () => {
    const { readFileSync, readdirSync } = await import("node:fs");
    const { join } = await import("node:path");
    const dir = join(__dirname, "..", "routes");
    const offenders: string[] = [];
    for (const file of readdirSync(dir).filter((name) => name.endsWith(".ts"))) {
      const source = readFileSync(join(dir, file), "utf8");
      // Any req.log call whose payload mentions an answer or uploaded payload.
      for (const match of source.matchAll(/req\.log\.[a-z]+\(\{[^}]*\}/g)) {
        if (/\b(answers?|documentText|documentBase64|imageBase64|pdfBase64|fileData)\b/.test(match[0])) {
          offenders.push(`${file}: ${match[0]}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
