// Test environment. The suites run the real Express app against a real Postgres
// instance, so they need the same env vars the server does. A dedicated
// TEST_DATABASE_URL is used (never DATABASE_URL) so a developer's real database
// can never be touched by a test run.
const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? "postgres://slate:slate@localhost:5433/slate";

process.env.TEST_DATABASE_URL = TEST_DATABASE_URL;
process.env.DATABASE_URL = TEST_DATABASE_URL;
process.env.SESSION_SECRET ??= "slate-test-session-secret";
// An empty Gemini key makes the AI routes fail gracefully (502) instead of
// reaching the network; tests that need the AI path inject a mocked model.
process.env.GEMINI_API_KEY ??= "";
// The focus cron sweeper refuses to run without its shared secret; the tests
// drive it through the same header the scheduled job uses.
process.env.FOCUS_CRON_SECRET ??= "slate-test-focus-cron-secret";
process.env.NODE_ENV = "test";
// Keep the test output readable: the suites assert on responses, not logs.
process.env.LOG_LEVEL = "silent";
