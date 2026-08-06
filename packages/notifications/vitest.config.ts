import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // Notification specs import React Email JSX templates. The React plugin
  // ensures .tsx is transformed correctly in the test environment.
  plugins: [react()],
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.spec.ts"],
    setupFiles: ["./test/setup.ts"],
    // The first spec that renders a template pays the React Email import cost
    // inside its own test body. On a warm dev machine that is ~300ms, but on a
    // cold CI runner the module graph alone took 45s, so the first render blew
    // vitest's 5s default and failed a test that has nothing wrong with it.
    testTimeout: 30_000,
  },
});
