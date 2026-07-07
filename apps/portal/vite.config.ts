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
const useHttpsInDev = process.env.VITE_DEV_HTTPS === "true";
const httpsConfig =
  fs.existsSync(keyPath) && fs.existsSync(certPath) && useHttpsInDev
    ? {
        key: fs.readFileSync(keyPath),
        cert: fs.readFileSync(certPath),
      }
    : undefined;

export default defineConfig({
  server: {
    host: true,
    // Overridable so scripts/dev-runner.mjs can give each git
    // worktree its own port slot; defaults keep the tunnel workflow intact.
    port: Number(process.env.PORTAL_DEV_PORT ?? 5174),
    allowedHosts: ["dev-portal.calibrafacil.com"],
    https: httpsConfig,
    proxy: {
      "/api": {
        target: process.env.DEV_API_ORIGIN ?? "http://localhost:3000",
        secure: false,
      },
    },
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
