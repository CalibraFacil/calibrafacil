import { defineConfig } from "vitest/config";

// Every test spawns the real oxlint binary over a fixture tree. Under a loaded
// CI runner (turbo runs all packages' tests in parallel) one spawn can exceed
// vitest's 5 s default, so give the whole package the same 30 s budget the
// no-raw-locale-formatting test already used.
export default defineConfig({
  test: {
    testTimeout: 30_000,
  },
});
