import { defineConfig, devices } from '@playwright/test'

// Opt-in: needs a running web app and backend with seeded accounts (see docs/e2e_seed_data.md).
export default defineConfig({
  testDir: './e2e',
  testMatch: 'realtime-two-agent.spec.ts',
  timeout: 90_000,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: process.env.REALTIME_WEB_URL ?? 'http://localhost:5173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    ...devices['Desktop Chrome'],
  },
})
