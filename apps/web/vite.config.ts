import { defineConfig } from 'vitest/config'
import tanstackRouter from '@tanstack/router-plugin/vite'
import viteReact from '@vitejs/plugin-react'
import viteTsConfigPaths from 'vite-tsconfig-paths'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import path from 'node:path'
import fs from 'node:fs'

// Only load HTTPS certs in dev (they don't exist in CI)
const keyPath = path.resolve(__dirname, './certs/localhost+1-key.pem')
const certPath = path.resolve(__dirname, './certs/localhost+1.pem')
const useHttpsInDev = process.env.VITE_DEV_HTTPS === 'true'
const httpsConfig =
  useHttpsInDev && fs.existsSync(keyPath) && fs.existsSync(certPath)
    ? { key: fs.readFileSync(keyPath), cert: fs.readFileSync(certPath) }
    : undefined

export default defineConfig({
  test: {
    globalSetup: ['./vitest.global-setup.js'],
    setupFiles: ['./vitest.setup.js'],
  },
  server: {
    host: true,
    // Overridable so scripts/dev-runner.mjs can give each git
    // worktree its own port slot.
    port: Number(process.env.WEB_DEV_PORT ?? 5173),
    // Extra hostnames the dev server answers to (tunnels, LAN devices),
    // comma-separated. Localhost always works.
    allowedHosts: (process.env.VITE_DEV_ALLOWED_HOSTS ?? '')
      .split(',')
      .map((host) => host.trim())
      .filter(Boolean),
    https: httpsConfig,
    proxy: {
      '/api': {
        target: process.env.DEV_API_ORIGIN ?? 'http://localhost:3000',
        secure: false,
      },
    },
  },
  optimizeDeps: {
    exclude: ['better-auth'],
  },
  plugins: [
    viteTsConfigPaths({
      projects: ['./tsconfig.json'],
    }),
    tailwindcss(),
    tanstackRouter({
      autoCodeSplitting: true,
    }),
    viteReact(),
    VitePWA({
      registerType: 'autoUpdate',
      // Registration happens in src/main.tsx behind the desktop-runtime guard,
      // so the Electron shell never installs the service worker.
      injectRegister: false,
      manifest: {
        id: '/',
        lang: 'pt-BR',
        name: 'CalibraFácil | Software para Laboratórios de Calibração',
        short_name: 'CalibraFácil',
        description:
          'Gestão de calibração, cálculo de incerteza conforme GUM e emissão automática de certificados para laboratórios alinhados à ISO/IEC 17025.',
        // The installed app opens on the dashboard; the dashboard guard
        // redirects to /sign-in when logged out.
        start_url: '/dashboard',
        display: 'standalone',
        theme_color: '#4f46e5',
        background_color: '#ffffff',
        icons: [
          {
            src: 'logo-mark-light.svg',
            type: 'image/svg+xml',
            sizes: 'any',
            purpose: 'any',
          },
          {
            src: 'logo192.png',
            type: 'image/png',
            sizes: '192x192',
          },
          {
            src: 'logo512.png',
            type: 'image/png',
            sizes: '512x512',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,svg,png,woff,woff2}'],
        // Written per container at startup (scripts/static-server.ts), so it
        // must come from the network, never from the precache.
        globIgnores: ['runtime-env.js'],
        // A reverse proxy may serve the API under /api on this origin
        // (including the Better Auth and magic-link GETs a user opens from an
        // e-mail); the SPA navigation fallback must never answer those.
        navigateFallbackDenylist: [/^\/api\//],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
      },
    }),
  ],
  build: {
    rollupOptions: {
      output: {
        // Rolldown code-splitting groups (the Rollup `manualChunks` shim
        // captures each matching module's whole dependency tree into the
        // first group that reaches it: clsx, imported by recharts, was
        // swallowed by vendor-charts, so every page modulepreloaded the
        // recharts/d3 chunk). Priority decides which group claims a module
        // that several of them could capture.
        codeSplitting: {
          groups: [
            {
              // `cn()`/`cva` helpers: imported by nearly every component and
              // by recharts. Highest priority so it is never part of charts.
              name: 'vendor-ui-utils',
              test: /\/node_modules\/(?:\.pnpm\/[^/]+\/node_modules\/)?(?:clsx|tailwind-merge|class-variance-authority)\//,
              priority: 60,
            },
            {
              name: 'vendor-react',
              test: /\/node_modules\/(?:\.pnpm\/[^/]+\/node_modules\/)?(?:react|react-dom|scheduler)\//,
              priority: 50,
            },
            { name: 'vendor-tanstack', test: /\/@tanstack\//, priority: 40 },
            { name: 'vendor-base-ui', test: /\/@base-ui\//, priority: 40 },
            { name: 'vendor-motion', test: /\/motion\//, priority: 40 },
            {
              name: 'vendor-math-engine',
              test: /\/@calibra-facil\/math-engine\//,
              priority: 40,
            },
            // Only chart routes import recharts, so this chunk must stay out of
            // the initial graph (checked by scripts/check-bundle-size.mjs).
            {
              name: 'vendor-charts',
              test: /\/recharts\/|\/d3-/,
              includeDependenciesRecursively: false,
              priority: 30,
            },
          ],
        },
      },
    },
  },
})
