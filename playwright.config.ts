import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './tests',
  timeout: 30_000,
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
    ...devices['Desktop Chrome'],
  },
  webServer: [
    { command: 'npm run dev', port: 5173, reuseExistingServer: true },
    { command: 'npm run dev --prefix backend', port: 8080, reuseExistingServer: true },
  ],
})
