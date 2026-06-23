import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// Real-DB integration tier (Docker/testcontainers). Kept separate from the fast
// `vitest.config.ts` so the default `test:run` stays Docker-free. Runs serially
// in a single fork against the one shared test Postgres (truncate-between-tests
// isolation), so no cross-file interference.
export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.int.spec.ts"],
    globalSetup: ["./test/integration/global-setup.ts"],
    setupFiles: ["./test/integration/setup.ts"],
    // Serial: one shared test DB, truncate-between-tests isolation.
    fileParallelism: false,
    // Generous: each test truncates ~130 tables + seeds, and the slowest router
    // specs (service-orders) run 12-25s; 30s flaked under a full-suite run.
    testTimeout: 60_000,
    hookTimeout: 120_000,
  },
});
