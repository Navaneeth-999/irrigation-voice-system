import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 120 * 1000,
  expect: {
    timeout: 15 * 1000,
  },
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://localhost:5173',
    channel: 'chrome',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'off',
    headless: true,
  },
  webServer: [
    {
      command: 'npm run dev',
      cwd: '../backend',
      url: 'http://localhost:4000/api/v1/health',
      reuseExistingServer: !process.env.CI,
      timeout: 60 * 1000,
    },
    {
      command: 'npm run dev',
      cwd: '.',
      url: 'http://localhost:5173',
      reuseExistingServer: !process.env.CI,
      timeout: 60 * 1000,
    },
  ],
});
