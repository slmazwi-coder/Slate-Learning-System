import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { client, ensureSchemaReady, startTestServer, stopTestServer } from "./harness";

// Every /api response must be JSON. Express's default handler sends an HTML
// error page, and a browser client that parses JSON then reports the confusing
// "Unexpected token '<' is not valid JSON" instead of the real problem. These
// tests pin the JSON contract for the not-found and error paths.
describe("API JSON error responses", () => {
  beforeAll(async () => {
    await startTestServer();
    await ensureSchemaReady();
  });
  afterAll(async () => {
    await stopTestServer();
  });

  it("answers an unknown /api route with a JSON 404, never the HTML fallback", async () => {
    const response = await client().get("/api/definitely-not-a-route");
    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toMatch(/application\/json/);
    expect(response.body).toEqual({ error: "Not found." });
  });

  it("answers a malformed JSON body with a JSON 400, not an HTML error page", async () => {
    const base = await startTestServer();
    const response = await fetch(`${base}/api/tis/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{ this is not json",
    });
    expect(response.status).toBe(400);
    expect(response.headers.get("content-type")).toMatch(/application\/json/);
    const body = (await response.json()) as { error?: string };
    expect(typeof body.error).toBe("string");
  });

  it("keeps a normal success response as JSON", async () => {
    const response = await client().get("/api/healthz");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toMatch(/application\/json/);
  });
});
