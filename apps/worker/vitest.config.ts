import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// Fast unit tier for apps/worker (the runtime around packages/jobs-core; the
// handlers' own unit specs run in that package), split from the real-DB
// integration tier (`vitest.integration.config.ts` / `test:integration`,
// Docker-gated) as in apps/api.
//
// Load @vitejs/plugin-react, as vitest.integration.config.ts and apps/api do: the
// unit tier shares the same import graph (pdf-render-request.spec.ts -> ./index ->
// @calibra-facil/notifications -> @calibra-facil/email React-Email `.tsx`
// templates). Vite 8 honours each package's tsconfig `jsx` setting, so without
// the plugin import-analysis chokes on the JSX before any test runs and the
// NIE-Cgcre-009 page-geometry guard in pdf-render-request.spec.ts silently stops
// executing.
export default defineConfig({
  plugins: [react()],
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
