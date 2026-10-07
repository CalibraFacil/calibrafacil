import { defineConfig, devices } from '@playwright/test'

// Smoke tests against a running stack (`pnpm setup:dev`, then `pnpm dev`): the
// real API, database, storage, PDF renderer and inbox, signed in through the
// e-mailed link. CI runs them on dependency and infrastructure changes (the
// Safety net workflow); locally, start the stack and run
// `pnpm --dir apps/web test:stack`.
const webURL = process.env.STACK_WEB_URL ?? 'http://localhost:5173'

export default defineConfig({
  testDir: './e2e-stack',
  testMatch: '**/*.stack.ts',
  outputDir: './test-results/stack',
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI
    ? [
        ['list'],
        ['html', { open: 'never', outputFolder: 'playwright-report/stack' }],
      ]
    : 'list',
  use: {
    baseURL: webURL,
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
    trace: 'retain-on-failure',
    ...devices['Desktop Chrome'],
  },
  projects: [
    { name: 'sign-in', testMatch: /sign-in\.stack\.ts/ },
    {
      name: 'lab',
      testMatch: /lab\.stack\.ts/,
      dependencies: ['sign-in'],
      use: { storageState: 'test-results/stack/.auth/lab.json' },
    },
    { name: 'portal', testMatch: /portal\.stack\.ts/ },
  ],
})
