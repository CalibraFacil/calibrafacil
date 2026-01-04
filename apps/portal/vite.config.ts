import fs from "node:fs";
import path from "node:path";
import { defineConfig } from "vite";

import tanstackRouter from "@tanstack/router-plugin/vite";
import viteReact from "@vitejs/plugin-react";
import viteTsConfigPaths from "vite-tsconfig-paths";
import tailwindcss from "@tailwindcss/vite";

// Only load HTTPS certs in dev (they don't exist in CI)
const keyPath = path.resolve(__dirname, "./certs/localhost+1-key.pem");
const certPath = path.resolve(__dirname, "./certs/localhost+1.pem");
const httpsConfig = fs.existsSync(keyPath) && fs.existsSync(certPath)
  ? { key: fs.readFileSync(keyPath), cert: fs.readFileSync(certPath) }
  : undefined;

export default defineConfig({
  server: {
    host: true,
    port: 5174,
    https: httpsConfig,
  },
  optimizeDeps: {
    exclude: ["better-auth"], // Avoid ESM/CJS interop issues with Better Auth
  },
  plugins: [
    viteTsConfigPaths({
      projects: ["./tsconfig.json"],
    }),
    tailwindcss(),
    tanstackRouter(),
    viteReact(),
  ],
});
