import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// Fast unit tier for packages/jobs-core. The real-DB integration tier for the
// handlers lives in apps/worker (`test:integration`): the fixtures and the
// queue-drain specs share one Postgres harness there.
//
// Load @vitejs/plugin-react: the unit tier shares the handlers' import graph
// (pdf-render-request.spec.ts -> ./index -> @calibra-facil/notifications ->
// @calibra-facil/email React-Email `.tsx` templates). Vite 8 honours each
// package's tsconfig `jsx` setting, so without the plugin import-analysis chokes
// on the JSX before any test runs and the NIE-Cgcre-009 page-geometry guard in
// pdf-render-request.spec.ts silently stops executing (#930).
export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.spec.ts"],
  },
});
