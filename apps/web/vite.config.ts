import { defineConfig } from 'vite'
import tanstackRouter from '@tanstack/router-plugin/vite'
import viteReact from '@vitejs/plugin-react'
import viteTsConfigPaths from 'vite-tsconfig-paths'
import tailwindcss from '@tailwindcss/vite'
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
    port: 5173,
    allowedHosts: ['dev-web.calibrafacil.com'],
    https: httpsConfig,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
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
