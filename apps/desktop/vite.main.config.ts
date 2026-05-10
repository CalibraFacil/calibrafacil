import { builtinModules } from "node:module";
import { defineConfig } from "vite";

const nodeBuiltins = builtinModules.flatMap((name) => [name, `node:${name}`]);

export default defineConfig({
  build: {
    emptyOutDir: false,
    lib: {
      entry: "src/main/main.ts",
      formats: ["cjs"],
      fileName: () => "main.cjs",
    },
    outDir: "dist/main",
    rollupOptions: {
      external: [...nodeBuiltins, "electron-updater", "electron"],
    },
    sourcemap: true,
    target: "node20",
  },
});
