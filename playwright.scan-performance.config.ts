import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './e2e', testMatch: 'desktop-scan.benchmark.ts', workers: 1, retries: 0,
  timeout: 300_000, expect: { timeout: 30_000 },
  outputDir: process.env.CODEHELM_E2E_SCAN_LIMIT === '1' ? 'test-results/v02-006-scan-limit-benchmarks' : 'test-results/v02-006-scan-benchmarks',
  reporter: [['line'], ['json', { outputFile: process.env.CODEHELM_E2E_SCAN_LIMIT === '1' ? 'test-results/v02-006-scan-limit-results.json' : 'test-results/v02-006-scan-results.json' }]],
});
