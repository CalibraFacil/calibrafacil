import { defineConfig } from "vitest/config";

export default defineConfig({
  esbuild: {
    jsx: "automatic",
    jsxImportSource: "react",
  },
  resolve: {
    preserveSymlinks: true,
  },
  test: {
    environment: "node",
  },
});
