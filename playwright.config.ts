import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [['line'], ['json', { outputFile: process.env.CODEHELM_E2E_EXECUTABLE ? 'test-results/packaged-e2e-results.json' : 'test-results/e2e-results.json' }]],
  outputDir: process.env.CODEHELM_E2E_EXECUTABLE ? 'test-results/packaged-e2e-artifacts' : 'test-results/e2e-artifacts',
  use: {
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
});
