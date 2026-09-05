import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? [['line'], ['html', { outputFolder: 'test-results/e2e-report', open: 'never' }]] : 'line',
  outputDir: 'test-results/e2e-artifacts',
  use: {
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
});
