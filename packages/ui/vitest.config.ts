import { defineConfig } from "vitest/config";

// Component specs opt into jsdom with a `@vitest-environment jsdom` docblock;
// the rest (class-token maps, the scroll-tap guard) run in plain node.
export default defineConfig({
  test: {
    setupFiles: ["./vitest.setup.ts"],
  },
});
