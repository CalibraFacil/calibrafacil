import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // Email template specs render React Email JSX to HTML. The React plugin
  // ensures .tsx is transformed correctly in the test environment.
  plugins: [react()],
  test: {
    globals: true,
    environment: "node",
    include: ["emails/**/*.spec.ts", "src/**/*.spec.ts"],
  },
});
