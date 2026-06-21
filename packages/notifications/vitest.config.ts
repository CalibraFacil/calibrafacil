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
  },
});
