import { defineConfig, devices } from '@playwright/test'

const port = Number(process.env.PLAYWRIGHT_PORT ?? 4173)
const host = process.env.PLAYWRIGHT_HOST ?? '127.0.0.1'
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? `http://${host}:${port}`
const shouldStartWebServer = !process.env.PLAYWRIGHT_BASE_URL
// The specs run against the production bundle, not the Vite dev server: the dev
// server serves the app as hundreds of unbundled modules and compiles them on
// demand, so a dozen workers opening the heavy execution page at once starve it
// past the 15 s heading waits (method-execution and execution-unsaved-guard
// failed on a 16-core machine, passed alone). Built, the same suite is 3x faster
// and stable under any worker count. A separate outDir keeps `dist` untouched.
const previewDir = 'node_modules/.cache/e2e-dist'

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.e2e.ts',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL,
    trace: 'retain-on-failure',
  },
  webServer: shouldStartWebServer
    ? {
        command: `pnpm exec vite build --outDir ${previewDir} --emptyOutDir && pnpm exec vite preview --outDir ${previewDir} --host ${host} --port ${port} --strictPort`,
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
        env: {
          VITE_API_URL: process.env.VITE_API_URL ?? 'http://127.0.0.1:3000',
          VITE_PORTAL_APP_URL:
            process.env.VITE_PORTAL_APP_URL ?? 'http://127.0.0.1:5174',
        },
      }
    : undefined,
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
})
