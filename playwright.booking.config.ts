import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './tests',
  testMatch: '**/booking-e2e.spec.ts',
  timeout: 30_000,
  use: {
    baseURL: 'http://127.0.0.1:5173',
    trace: 'on-first-retry',
    ...devices['Desktop Chrome'],
  },
  webServer: [
    { command: 'npm run dev -- --host 127.0.0.1', port: 5173, reuseExistingServer: true },
  ],
})