import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Integration tests exercise the real Express app and a real Postgres
    // instance, so they need a longer budget than pure unit tests.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    include: ["src/**/*.test.ts"],
    setupFiles: ["src/test/setup.ts"],
    // The DB-backed suites share one schema; running files in parallel would
    // have them truncate each other's rows.
    fileParallelism: false,
    pool: "forks",
  },
});
