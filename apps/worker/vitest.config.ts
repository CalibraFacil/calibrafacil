import { defineConfig } from "vitest/config";

// Fast unit tier for apps/worker — mirrors apps/api's split between a fast
// unit tier (`vitest.config.ts` / `test:run`) and the real-DB integration tier
// (`vitest.integration.config.ts` / `test:integration`, Docker-gated).
//
// Before this file existed, apps/worker had no unit vitest config and no
// `test`/`test:run` script, so `pnpm turbo test` ran 0 tasks for this package
// and any `*.spec.ts` here (e.g. queue-runtime.spec.ts) never executed in CI —
// an unexecuted regression guard. This config exists so unit specs actually run.
export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.spec.ts"],
    // The real-DB integration tier (*.int.spec.ts) runs under
    // vitest.integration.config.ts (Docker required) — keep it out of the fast
    // suite, same convention as apps/api/vitest.config.ts.
    exclude: ["**/node_modules/**", "**/*.int.spec.ts"],
  },
});
