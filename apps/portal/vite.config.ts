import fs from "node:fs";
import path from "node:path";
import { defineConfig } from "vitest/config";

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
  test: {
    globalSetup: ["./vitest.global-setup.js"],
    setupFiles: ["./vitest.setup.ts"],
  },
  server: {
    host: true,
    // Overridable so scripts/dev-runner.mjs can give each git
    // worktree its own port slot.
    port: Number(process.env.PORTAL_DEV_PORT ?? 5174),
    // Extra hostnames the dev server answers to (tunnels, LAN devices),
    // comma-separated. Localhost always works.
    allowedHosts: (process.env.VITE_DEV_ALLOWED_HOSTS ?? "")
      .split(",")
      .map((host) => host.trim())
      .filter(Boolean),
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
    tanstackRouter({
      autoCodeSplitting: true,
    }),
    viteReact(),
  ],
  build: {
    rollupOptions: {
      output: {
        // Same policy as apps/web (see its vite.config.ts): Rolldown captures a
        // matching module's whole dependency tree into the first group that
        // reaches it, so shared helpers (clsx, imported by recharts too) need a
        // higher-priority group of their own or they end up inside
        // vendor-charts and every page preloads recharts/d3.
        codeSplitting: {
          groups: [
            {
              name: "vendor-ui-utils",
              test: /\/node_modules\/(?:\.pnpm\/[^/]+\/node_modules\/)?(?:clsx|tailwind-merge|class-variance-authority)\//,
              priority: 60,
            },
            {
              name: "vendor-react",
              test: /\/node_modules\/(?:\.pnpm\/[^/]+\/node_modules\/)?(?:react|react-dom|scheduler)\//,
              priority: 50,
            },
            { name: "vendor-motion", test: /\/motion\//, priority: 40 },
            // Loaded lazily, only when VITE_SENTRY_DSN is set (lib/sentry.ts).
            { name: "vendor-sentry", test: /\/@sentry\//, priority: 40 },
            // Only chart routes import recharts (lazily, via drift-chart /
            // trend-bar-chart), so it must stay out of the initial graph.
            {
              name: "vendor-charts",
              test: /\/recharts\/|\/d3-/,
              includeDependenciesRecursively: false,
              priority: 30,
            },
          ],
        },
      },
    },
  },
});
