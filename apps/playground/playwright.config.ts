import { defineConfig, devices } from '@playwright/test';

/**
 * End to end: real API on wrangler dev + embed on Vite + this Next app.
 * The API runs with MAILER=console and writes its log to .e2e/api.log, which
 * the test reads to get the OTP code. Ports: 8787, 5174, 3810.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:3810',
    trace: 'retain-on-failure',
    ...devices['Desktop Chrome'],
  },
  webServer: [
    {
      command: 'bash ../api/scripts/e2e-server.sh',
      url: 'http://localhost:8787/health',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      command: 'pnpm --filter @pockey/embed dev',
      url: 'http://localhost:5174',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      command: 'pnpm dev',
      url: 'http://localhost:3810',
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
    },
  ],
});
