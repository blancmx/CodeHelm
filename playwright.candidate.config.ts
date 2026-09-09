import { defineConfig } from '@playwright/test';
import base from './playwright.config.js';
const prefix = process.env.CODEHELM_E2E_SCOPE === 'smoke' ? 'v02-006-log-smoke' : process.env.CODEHELM_E2E_SCOPE === 'sustained' ? 'v02-006-foreground-log' : 'v02-006-cancel-e2e';
export default defineConfig({
  ...base,
  outputDir: `test-results/${prefix}-artifacts`,
  reporter: [['line'], ['json', { outputFile: `test-results/${prefix}-results.json` }]],
});
