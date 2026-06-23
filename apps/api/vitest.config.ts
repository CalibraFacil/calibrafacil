import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // api specs import email JSX templates (e.g. emails/components/email-layout.tsx).
  // The email package's tsconfig sets jsx:"preserve", which Vite 8's transformer
  // honors per-package, leaving that JSX untransformed (Vite 7's esbuild used to
  // transform it regardless). The React plugin transforms all .tsx regardless of
  // per-package tsconfig — same approach web/portal/backoffice already use. Test-only:
  // the deployed API runs on Bun/Vercel, not Vite.
  plugins: [react()],
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.spec.ts"],
    // The real-DB integration tier (*.int.spec.ts) runs under
    // vitest.integration.config.ts (Docker required) — keep it out of the fast suite.
    exclude: ["**/node_modules/**", "**/*.int.spec.ts"],
    coverage: {
      provider: "v8",
      include: ["src/routes/**/*.ts", "src/services/**/*.ts", "src/lib/**/*.ts"],
      exclude: ["**/*.spec.ts", "**/types.ts"],
    },
    setupFiles: ["./test/setup.ts"],
  },
});
