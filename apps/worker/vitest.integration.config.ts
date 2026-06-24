import { defineConfig } from "vitest/config";

// Worker real-DB integration tier (Docker Postgres). Cloned from
// apps/api/vitest.integration.config.ts. The worker has no React in its import
// graph, so (unlike the api config) we don't load @vitejs/plugin-react. Runs
// serially in a single fork against the one shared test Postgres
// (truncate-between-tests isolation), so no cross-file interference.
export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.int.spec.ts"],
    globalSetup: ["./test/integration/global-setup.ts"],
    setupFiles: ["./test/integration/setup.ts"],
    // Serial: one shared test DB, truncate-between-tests isolation.
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 120_000,
  },
});
