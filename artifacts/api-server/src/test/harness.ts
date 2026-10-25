import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import app from "../app";
import { db, pool } from "@workspace/db";
import { sql } from "drizzle-orm";

// Starts the real Express app on an ephemeral port and gives each test a small
// cookie-aware HTTP client. Everything below the client is production code, so
// the tests exercise the actual routes, auth guards and SQL.
let server: Server | null = null;
let baseUrl = "";

export async function startTestServer(): Promise<string> {
  if (server) return baseUrl;
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  const address = server!.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
  return baseUrl;
}

export async function stopTestServer() {
  if (!server) return;
  await new Promise<void>((resolve) => server!.close(() => resolve()));
  server = null;
  baseUrl = "";
}

export type ApiResponse<T = any> = { status: number; body: T; headers: Headers };

// A cookie-aware client: each instance keeps its own session cookies, so two
// clients can be signed in as different roles at the same time.
export function client() {
  const cookies = new Map<string, string>();
  function cookieHeader() {
    return [...cookies.entries()].map(([name, value]) => `${name}=${value}`).join("; ");
  }
  function absorb(response: Response) {
    for (const raw of response.headers.getSetCookie?.() ?? []) {
      const [pair] = raw.split(";");
      const index = pair.indexOf("=");
      if (index <= 0) continue;
      const name = pair.slice(0, index).trim();
      const value = pair.slice(index + 1).trim();
      if (value === "" ) cookies.delete(name);
      else cookies.set(name, value);
    }
  }
  async function request<T = any>(method: string, path: string, body?: unknown): Promise<ApiResponse<T>> {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
        ...(cookies.size ? { cookie: cookieHeader() } : {}),
        // A distinct forwarded IP per client keeps the rate limiter from
        // tripping across tests.
        "x-forwarded-for": clientIp,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    absorb(response);
    const text = await response.text();
    let parsed: unknown = null;
    try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
    return { status: response.status, body: parsed as T, headers: response.headers };
  }
  const clientIp = `10.0.0.${Math.floor(Math.random() * 250) + 1}`;
  return {
    get: <T = any>(path: string) => request<T>("GET", path),
    post: <T = any>(path: string, body?: unknown) => request<T>("POST", path, body),
    patch: <T = any>(path: string, body?: unknown) => request<T>("PATCH", path, body),
    delete: <T = any>(path: string) => request<T>("DELETE", path),
  };
}

export type TestClient = ReturnType<typeof client>;

// Truncates every application table except the hardwired catalogs, which the
// schema bootstrap re-syncs from code and which the tests read as fixtures.
export async function resetDatabase() {
  const { rows } = await pool.query<{ tablename: string }>(
    `select tablename from pg_tables where schemaname = 'public' and tablename like 'slate_%'`,
  );
  const preserved = new Set([
    "slate_preset_curricula",
    "slate_annual_teaching_plans",
    "slate_curriculum_directives",
  ]);
  const tables = rows.map((row) => row.tablename).filter((name) => !preserved.has(name));
  if (!tables.length) return;
  await db.execute(sql.raw(`truncate table ${tables.map((name) => `"${name}"`).join(", ")} cascade`));
}

export async function ensureSchemaReady() {
  // The first request through /api runs ensureSchema(); doing it explicitly
  // here keeps the very first assertion free of bootstrap timing noise.
  await fetch(`${baseUrl}/api/healthz`);
}
