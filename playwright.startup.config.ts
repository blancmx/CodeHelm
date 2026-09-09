import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './e2e', testMatch: 'desktop-startup.benchmark.ts', workers: 1, retries: 0,
  timeout: 120_000, expect: { timeout: 15_000 },
  outputDir: 'test-results/v02-006-startup-benchmarks',
  reporter: [['line'], ['json', { outputFile: 'test-results/v02-006-startup-results.json' }]],
});
