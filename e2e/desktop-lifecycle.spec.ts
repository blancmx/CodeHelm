import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { createRequire } from 'node:module';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { CodeHelmApi, RunnerStateDto } from '../packages/contracts/src/index.js';

declare global {
  interface Window {
    codehelm: CodeHelmApi;
    __codehelmE2eLogs?: string[];
  }
}

const repositoryRoot = process.cwd();
const desktopRoot = path.join(repositoryRoot, 'apps', 'desktop');
const mainEntry = path.join(desktopRoot, 'dist-electron', 'main', 'index.js');
const managedService = path.join(repositoryRoot, 'e2e', 'fixtures', 'managed-service.cjs');
const requireFromDesktop = createRequire(path.join(desktopRoot, 'package.json'));
const electronExecutable = requireFromDesktop('electron') as string;

let app: ElectronApplication | undefined;
let page: Page | undefined;
let fixtureRoot = '';

async function waitForRunnerState(predicate: (state: RunnerStateDto) => boolean): Promise<RunnerStateDto> {
  await expect.poll(async () => predicate(await page!.evaluate(() => window.codehelm.runner.getState())), {
    message: 'runner state should reach the expected lifecycle state',
  }).toBe(true);
  return page!.evaluate(() => window.codehelm.runner.getState());
}

test.beforeEach(async () => {
  fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'codehelm-electron-e2e-'));
  const projectRoot = path.join(fixtureRoot, 'fixture-project');
  await fs.mkdir(projectRoot, { recursive: true });
  await fs.writeFile(path.join(projectRoot, 'package.json'), JSON.stringify({
    name: 'codehelm-e2e-fixture',
    version: '1.0.0',
    private: true,
    scripts: { start: 'node service.cjs' },
  }, null, 2));
  await fs.writeFile(path.join(projectRoot, 'service.cjs'), "require('node:fs');\n");

  const environment = { ...process.env };
  delete environment.ELECTRON_RUN_AS_NODE;
  delete environment.VITE_DEV_SERVER_URL;
  app = await electron.launch({
    executablePath: electronExecutable,
    args: [mainEntry],
    cwd: desktopRoot,
    env: {
      ...environment,
      CODEHELM_USER_DATA_DIR: path.join(fixtureRoot, 'user-data'),
      CODEHELM_VALIDATION_WINDOW: '0',
    },
  });
  page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
});

// Playwright requires the hook fixture argument to use an object destructuring pattern.
// eslint-disable-next-line no-empty-pattern
test.afterEach(async ({}, testInfo) => {
  const runningApp = app;
  let closeError: unknown;
  if (runningApp) {
    try {
      await runningApp.close();
    } catch (error) {
      closeError = error;
      runningApp.process().kill();
    }
  }
  app = undefined;
  page = undefined;
  const resolved = path.resolve(fixtureRoot);
  if (path.dirname(resolved) !== path.resolve(os.tmpdir()) || !path.basename(resolved).startsWith('codehelm-electron-e2e-')) {
    throw new Error(`Refusing unsafe E2E fixture cleanup: ${resolved}`);
  }
  if (closeError !== undefined || testInfo.status !== testInfo.expectedStatus) {
    const artifactName = testInfo.title.replace(/[^a-z0-9_-]+/gi, '-').replace(/^-|-$/g, '').toLowerCase();
    await fs.cp(path.join(resolved, 'user-data'), path.join(repositoryRoot, 'test-results', 'e2e-user-data', artifactName), {
      recursive: true,
      force: true,
    }).catch(() => undefined);
  }
  await fs.rm(resolved, { recursive: true, force: true });
  if (closeError !== undefined) throw closeError;
});

test('persists settings and completes an approved managed-service lifecycle', async () => {
  await expect(page!).toHaveTitle(/CodeHelm/);
  await expect(page!.getByRole('heading', { name: '项目总览' })).toBeVisible();

  await page!.locator('button[title="最大化"]').click();
  await expect.poll(() => page!.evaluate(() => window.codehelm.window.isMaximized())).toBe(true);
  await page!.locator('button[title="还原"]').click();
  await expect.poll(() => page!.evaluate(() => window.codehelm.window.isMaximized())).toBe(false);

  await page!.locator('a[href="#/settings"]').click();
  await expect(page!.getByRole('heading', { name: '系统设置' })).toBeVisible();
  await page!.getByRole('button', { name: '明亮模式' }).click();
  const scanBudget = page!.getByText('单项目最大扫描文件数上限').locator('..').locator('input');
  await scanBudget.fill('12345');
  await page!.getByRole('button', { name: '保存设置' }).click();
  await expect.poll(() => page!.evaluate(() => window.codehelm.settings.get())).toMatchObject({ maxScanFiles: 12345 });

  const projectRoot = path.join(fixtureRoot, 'fixture-project');
  const imported = await page!.evaluate((rootPath) => window.codehelm.projects.import({
    rootPath,
    name: 'V01-009 Electron Fixture',
    tags: ['e2e'],
  }), projectRoot);
  await page!.locator('a[href="#/"]').click();
  await page!.locator('button[title="刷新项目列表与实时状态"]').click();
  await expect(page!.getByText('V01-009 Electron Fixture', { exact: true })).toBeVisible();

  const profile = await page!.evaluate(({ projectId, executable, script }) => window.codehelm.profiles.save({
    projectId,
    name: 'E2E managed lifecycle',
    isDefault: true,
    failurePolicy: 'block_dependents',
    services: [{
      id: 'e2e-service',
      runProfileId: '',
      name: 'E2E Managed Service',
      type: 'tool',
      moduleRelativePath: '.',
      executable,
      args: [script],
      cwdRelative: '.',
      env: [],
      healthCheck: { type: 'none' },
      dependsOn: [],
      enabled: true,
      source: 'manual',
      startTimeoutMs: 5_000,
      stopTimeoutMs: 5_000,
    }],
  }), { projectId: imported.id, executable: process.execPath, script: managedService });

  await page!.evaluate(() => {
    window.__codehelmE2eLogs = [];
    window.codehelm.runner.onLogs(batch => window.__codehelmE2eLogs!.push(...batch.entries.map(entry => entry.message)));
  });

  const reviewOpened = app!.waitForEvent('window');
  const tokenPending = page!.evaluate((profileId) => window.codehelm.runner.confirmExecution(profileId, 'start', 'light'), profile.id);
  const review = await reviewOpened;
  await expect(review.getByRole('heading', { name: '启动确认' })).toBeVisible();
  await expect(review.getByText('E2E Managed Service', { exact: true })).toBeVisible();
  await review.getByRole('button', { name: '确认并启动' }).click();
  const approvalToken = await tokenPending;

  const started = await page!.evaluate(({ profileId, approvalToken }) => window.codehelm.runner.start(profileId, approvalToken), {
    profileId: profile.id,
    approvalToken,
  });
  expect(started.status).toBe('RUNNING');
  expect(started.services).toHaveLength(1);
  expect(started.services[0]?.status).toBe('RUNNING');
  await expect.poll(() => page!.evaluate(() => {
    return window.__codehelmE2eLogs?.join('') ?? '';
  })).toContain('CODEHELM_E2E_SERVICE_READY');

  await page!.locator('a[href="#/runner"]').click();
  await expect(page!.getByRole('heading', { name: '全局运行中心' })).toBeVisible();
  await expect(page!.getByText('E2E Managed Service', { exact: true })).toBeVisible();
  await expect(page!.getByText('RUNNING', { exact: true })).toBeVisible();
  await page!.getByRole('button', { name: '停止该项目' }).click();
  const stopped = await waitForRunnerState(state => state.activeSessions.length === 0
    && state.history.some(session => session.id === started.id && session.status === 'STOPPED'));
  expect(stopped.history.find(session => session.id === started.id)?.status).toBe('STOPPED');
  await expect(page!.getByText('当前无受本次应用管理的运行项目')).toBeVisible();
});
