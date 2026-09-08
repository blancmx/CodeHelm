import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir:'./e2e',testMatch:'*.benchmark.ts',workers:1,retries:0,timeout:180_000,
  expect:{timeout:10_000},outputDir:'test-results/v02-006-benchmarks',
  reporter:[['line'],['json',{outputFile:'test-results/v02-006-benchmark-results.json'}]],
});
