import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// Worker real-DB integration tier (Docker Postgres). Cloned from
// apps/api/vitest.integration.config.ts. Load @vitejs/plugin-react (as the api
// config does) so the React-Email `.tsx` templates in @calibra-facil/email — which
// the scheduled-compliance handler transitively imports through
// @calibra-facil/notifications — are transformed; without it Vite's import-analysis
// chokes on the JSX before any test runs. The plugin is a no-op for the all-`.ts`
// integrations handler, so this is purely additive. Runs serially in a single fork
// against the one shared test Postgres (truncate-between-tests isolation), so no
// cross-file interference.
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
    testTimeout: 60_000,
    hookTimeout: 120_000,
  },
});
