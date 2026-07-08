import { defineConfig } from 'vite'
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
  server: {
    host: true,
    // Overridable so scripts/dev-runner.mjs can give each git
    // worktree its own port slot; defaults keep the tunnel workflow intact.
    port: Number(process.env.WEB_DEV_PORT ?? 5173),
    allowedHosts: ['dev-web.calibrafacil.com'],
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
        // Installed app launches into the product, not the marketing landing
        // page; the dashboard guard redirects to /sign-in when logged out.
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
        // Marketing/OG imagery is not part of the app shell.
        globIgnores: [
          'og/**',
          'landing/**',
          'integrations/**',
          'hero-preview*.png',
          'tanstack-*',
        ],
        // The apex "/" is served by the Next marketing app (apps/site), not the
        // SPA. Disabling the precache directoryIndex stops workbox from mapping
        // "/" onto the precached index.html (which would otherwise serve the SPA
        // shell — and redirect logged-in visitors to /dashboard — before the
        // navigateFallbackDenylist below ever runs). With both in place, "/"
        // falls through to the network and Vercel proxies it to apps/site.
        directoryIndex: null,
        // /api is the same-origin backend (incl. Better-Auth and magic-link
        // GETs); /blog, /docs and /recursos are rewritten by Vercel to the
        // external CMS / docs / marketing apps, and "/" is the Next landing —
        // the SPA navigation fallback must never swallow any of them.
        navigateFallbackDenylist: [
          /^\/$/,
          /^\/api\//,
          /^\/blog(\/|$)/,
          /^\/docs(\/|$)/,
          /^\/recursos(\/|$)/,
          /^\/solucoes(\/|$)/,
          /^\/calibracao(\/|$)/,
        ],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
      },
    }),
  ],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('/node_modules/')) return undefined

          if (id.includes('/@tanstack/')) return 'vendor-tanstack'
          if (id.includes('/@base-ui/')) return 'vendor-base-ui'
          if (id.includes('/@sentry/')) return 'vendor-sentry'
          if (id.includes('/recharts/') || id.includes('/d3-')) {
            return 'vendor-charts'
          }
          if (id.includes('/motion/')) return 'vendor-motion'
          if (id.includes('/@calibra-facil/math-engine/')) {
            return 'vendor-math-engine'
          }
          if (
            id.includes('/node_modules/react/') ||
            id.includes('/node_modules/react-dom/') ||
            id.includes('/node_modules/scheduler/')
          ) {
            return 'vendor-react'
          }

          return undefined
        },
      },
    },
  },
})
