import { builtinModules } from "node:module";
import { defineConfig } from "vite";

const nodeBuiltins = builtinModules.flatMap((name) => [name, `node:${name}`]);

export default defineConfig({
  esbuild: {
    jsx: "automatic",
    jsxImportSource: "react",
  },
  build: {
    emptyOutDir: true,
    lib: {
      entry: "src/bin.ts",
      formats: ["cjs"],
      fileName: () => "server.cjs",
    },
    outDir: "dist",
    rollupOptions: {
      external: [...nodeBuiltins, "better-sqlite3"],
    },
    sourcemap: true,
    target: "node20",
  },
});
