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
      // Native modules can't be bundled — they're required by name at runtime
      // and unpacked from the asar (see electron-builder.yml asarUnpack).
      external: [
        ...nodeBuiltins,
        "better-sqlite3",
        "usb",
        "serialport",
        "@serialport/bindings-cpp",
      ],
    },
    sourcemap: true,
    target: "node20",
  },
});
