import { defineConfig } from '@playwright/test';
const prefix = process.env.CODEHELM_E2E_OVERVIEW === '1' ? 'v02-006-overview' : process.env.CODEHELM_E2E_MATRIX === '1' ? 'v02-006-matrix' : 'v02-006';
export default defineConfig({
  testDir:'./e2e',testMatch:'desktop-performance.benchmark.ts',workers:1,retries:0,timeout:180_000,
  expect:{timeout:10_000},outputDir:`test-results/${prefix}-benchmarks`,
  reporter:[['line'],['json',{outputFile:`test-results/${prefix === 'v02-006' ? 'v02-006-benchmark' : prefix}-results.json`}]],
});
