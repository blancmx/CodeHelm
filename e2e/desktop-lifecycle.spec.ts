import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { createRequire } from 'node:module';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { execFileSync } from 'node:child_process';
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

// eslint-disable-next-line no-empty-pattern
test('diagnoses a saved profile in the real desktop without starting services', async ({}, testInfo) => {
  const projectRoot = path.join(fixtureRoot, 'fixture-project');
  const project = await page!.evaluate(rootPath => window.codehelm.projects.import({ rootPath, name: 'V02 诊断项目', tags: [] }), projectRoot);
  await page!.evaluate(id => window.codehelm.analysis.start(id), project.id);
  await expect.poll(() => page!.evaluate(async id => (await window.codehelm.analysis.getTask(id))?.status, project.id)).toBe('completed');
  const profile = await page!.evaluate(async ({ projectId }) => {
    const existing = (await window.codehelm.profiles.list(projectId))[0];
    return window.codehelm.profiles.save({
      id: existing?.id,
      projectId, name: '诊断方案', isDefault: true, failurePolicy: 'block_dependents',
      services: [{
        id: 'diagnostic-service', runProfileId: '', name: '缺少命令的服务', type: 'tool',
        moduleRelativePath: '.', cwdRelative: '.', executable: 'codehelm-intentionally-missing-command',
        args: [], env: [{ key: 'PRIVATE_TOKEN', value: 'E2E_DIAGNOSTIC_SECRET', isSecret: true }],
        dependsOn: [], enabled: true, source: 'manual',
      }],
    });
  }, { projectId: project.id });
  await page!.evaluate(id => { location.hash = `/projects/${id}?tab=environment`; }, project.id);
  await expect(page!.getByRole('heading', { name: '运行环境检查' })).toBeVisible();
  const diagnoseButton = page!.getByRole('button', { name: '检查运行环境', exact: true });
  await diagnoseButton.focus();
  await diagnoseButton.press('Enter');
  await expect(page!.getByText('检查完成：1 项阻断', { exact: false })).toBeVisible();
  await expect(page!.getByText('在配置路径、工作目录及 PATH 中没有找到命令文件。')).toBeVisible();
  await expect(page!.getByText('尚未取得与此方案匹配的有效版本证据；自动检查不执行版本命令。')).toBeVisible();
  expect(await page!.locator('body').innerText()).not.toContain('E2E_DIAGNOSTIC_SECRET');
  expect((await page!.evaluate(() => window.codehelm.runner.getState())).activeSessions).toHaveLength(0);
  const saved = await page!.evaluate(id => window.codehelm.profiles.get(id), profile.id);
  expect(saved?.services[0]?.env[0]).toMatchObject({ value: '', isRedacted: true });
  await page!.screenshot({ path: testInfo.outputPath('diagnostics-dark.png') });

  // Native picker/confirmation responses are controlled; the selected Node process is real.
  await app!.evaluate(({ dialog }, executable) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [executable] });
    dialog.showMessageBox = async () => ({ response: 0, checkboxChecked: false });
  }, process.execPath);
  await page!.getByRole('button', { name: '选择并检查版本' }).click();
  await expect(page!.getByRole('button', { name: '选择并检查版本' })).toBeEnabled();
  await expect(page!.getByText('所选程序：', { exact: false })).toHaveCount(0);
  await app!.evaluate(({ dialog }) => {
    dialog.showMessageBox = async (_owner: Electron.BaseWindow | Electron.MessageBoxOptions, options?: Electron.MessageBoxOptions) => {
      if (!options?.detail?.includes('--version') || !options.detail?.includes('SHA-256')) throw new Error('Missing review details');
      return { response: 1, checkboxChecked: false };
    };
  });
  await page!.getByRole('button', { name: '选择并检查版本' }).click();
  await expect(page!.getByText(`node 版本：${process.versions.node}`, { exact: true })).toBeVisible();
  await expect(page!.getByText('此结果不代表项目环境检查通过。')).toBeVisible();
  expect((await page!.evaluate(() => window.codehelm.runner.getState())).activeSessions).toHaveLength(0);
  await page!.screenshot({ path: testInfo.outputPath('runtime-version.png'), animations: 'disabled' });

  // The normal launch button must use main-process preflight and bring the user
  // back to actionable diagnostics, without opening a review for a broken plan.
  await page!.getByText('项目概览', { exact: true }).click();
  await page!.getByRole('button', { name: '一键启动方案', exact: true }).click();
  await expect(page!).toHaveURL(/tab=environment/);
  await expect(page!.getByRole('button', { name: '一键启动方案', exact: true })).toBeEnabled();
  await expect(page!.getByRole('heading', { name: '运行环境检查' })).toBeVisible();
  await expect(page!.getByText('检查完成：1 项阻断', { exact: false })).toBeVisible();
  await expect(page!.getByRole('button', { name: '重新检查运行环境' })).toBeEnabled();
  expect(app!.windows()).toHaveLength(1);
  expect((await page!.evaluate(() => window.codehelm.runner.getState())).activeSessions).toHaveLength(0);
  await page!.screenshot({ path: testInfo.outputPath('preflight-blocked.png'), animations: 'disabled' });

  await page!.locator('a[href="#/settings"]').click();
  await page!.getByRole('button', { name: '明亮模式' }).click();
  await page!.evaluate(id => { location.hash = `/projects/${id}?tab=environment`; }, project.id);
  await page!.getByRole('button', { name: '检查运行环境', exact: true }).click();
  await expect(page!.getByText('检查完成：1 项阻断', { exact: false })).toBeVisible();
  await page!.screenshot({ path: testInfo.outputPath('diagnostics-light.png') });
  await page!.getByText('启动配置', { exact: true }).click();
  await page!.getByRole('switch').first().click();
  await page!.getByText('环境诊断', { exact: true }).click();
  await expect(page!.getByText('方案有未保存的修改', { exact: false })).toBeVisible();
  await expect(page!.getByRole('button', { name: '检查运行环境', exact: true })).toBeDisabled();
  await expect(page!.getByText('检查完成：', { exact: false })).toHaveCount(0);
});

// eslint-disable-next-line no-empty-pattern
test('matches a selected Node runtime against fresh service version requirements', async ({}, testInfo) => {
  const projectRoot = path.join(fixtureRoot, 'fixture-project');
  const project = await page!.evaluate(rootPath => window.codehelm.projects.import({ rootPath, name: 'V02 version match', tags: [] }), projectRoot);
  await page!.evaluate(id => window.codehelm.analysis.start(id), project.id);
  await expect.poll(() => page!.evaluate(async id => (await window.codehelm.analysis.getTask(id))?.status, project.id)).toBe('completed');
  await page!.evaluate(async ({ projectId, executable }) => window.codehelm.profiles.save({
    id: (await window.codehelm.profiles.list(projectId))[0]?.id,
    projectId, name: 'Direct Node', isDefault: true, failurePolicy: 'block_dependents',
    services: [{ id: 'direct-node', runProfileId: '', name: 'Node service', type: 'tool', moduleRelativePath: '.', executable,
      args: [], cwdRelative: '.', env: [], dependsOn: [], enabled: true, source: 'manual' }],
  }), { projectId: project.id, executable: process.execPath });
  await app!.evaluate(({ dialog }, executable) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [executable] });
    dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false });
  }, process.execPath);
  await fs.writeFile(path.join(projectRoot, 'package.json'), JSON.stringify({ engines: { node: '>=99.0.0' } }));
  await page!.evaluate(id => { location.hash = `/projects/${id}?tab=environment`; }, project.id);
  await page!.getByRole('button', { name: '选择并检查版本' }).click();
  await expect(page!.getByText('Node service · 直接路径一致 · 不满足声明', { exact: true })).toBeVisible();
  await fs.writeFile(path.join(projectRoot, 'package.json'), JSON.stringify({ engines: { node: `>=${process.versions.node} <99` } }));
  await page!.getByRole('button', { name: '选择并检查版本' }).click();
  await expect(page!.getByText('Node service · 直接路径一致 · 满足声明', { exact: true })).toBeVisible();
  await expect(page!.getByText('声明来源：package.json → engines.node', { exact: true })).toBeVisible();
  expect((await page!.evaluate(() => window.codehelm.runner.getState())).activeSessions).toHaveLength(0);
  await page!.screenshot({ path: testInfo.outputPath('runtime-match.png'), animations: 'disabled' });
  const installReviewOpened = app!.waitForEvent('window');
  await page!.getByRole('button', { name: '预览依赖安装并运行', exact: true }).click();
  const installReview = await installReviewOpened;
  await expect(installReview.getByRole('heading', { name: '安装并启动确认' })).toBeVisible();
  await installReview.getByRole('button', { name: '取消', exact: true }).click();
  await expect(page!.getByRole('button', { name: '一键启动方案', exact: true })).toBeEnabled();
  expect((await page!.evaluate(() => window.codehelm.runner.getState())).activeSessions).toHaveLength(0);
  // Current constraints, not the earlier successful version result, govern preflight.
  await fs.writeFile(path.join(projectRoot, 'package.json'), JSON.stringify({ engines: { node: '>=99.0.0' } }));
  await page!.getByRole('button', { name: '一键启动方案', exact: true }).click();
  await expect(page!.getByText('所选程序与直接命令路径一致，版本不满足此服务清单声明；请调整运行时后重新检查。', { exact: true })).toBeVisible();
  expect(app!.windows()).toHaveLength(1);
  expect((await page!.evaluate(() => window.codehelm.runner.getState())).activeSessions).toHaveLength(0);

  await page!.getByText('启动配置', { exact: true }).click();
  await page!.getByRole('button', { name: '编辑', exact: true }).click();
  await page!.getByRole('button', { name: '添加环境变量', exact: true }).click();
  await page!.getByLabel('环境变量 1 名称', { exact: true }).fill('REQUIRED_TOKEN');
  await page!.getByLabel('REQUIRED_TOKEN 必需', { exact: true }).check();
  await page!.screenshot({ path: testInfo.outputPath('required-variable-editor.png'), animations: 'disabled' });
  await page!.getByRole('button', { name: '保存服务配置', exact: true }).click();
  await page!.getByRole('button', { name: '保存方案修改', exact: true }).click();
  await page!.getByText('环境诊断', { exact: true }).click();
  await page!.getByRole('button', { name: '检查运行环境', exact: true }).click();
  await expect(page!.getByText('有 1 个标记为必需的变量未填写。', { exact: true })).toBeVisible();
  await page!.getByRole('button', { name: '一键启动方案', exact: true }).click();
  await expect(page!.getByRole('button', { name: '一键启动方案', exact: true })).toBeEnabled();
  expect((await page!.evaluate(() => window.codehelm.runner.getState())).activeSessions).toHaveLength(0);
  const stored = await page!.evaluate(async id => (await window.codehelm.profiles.list(id))[0], project.id);
  expect(stored.services[0].env[0]).toMatchObject({ required: true, value: '' });
});

// eslint-disable-next-line no-empty-pattern
test('matches a selected Python runtime against static and dynamic project metadata', async ({}, testInfo) => {
  const executable = process.env.CODEHELM_E2E_PYTHON;
  test.skip(!executable, 'Set CODEHELM_E2E_PYTHON to a trusted Python 3 executable outside the project.');
  const projectRoot = path.join(fixtureRoot, 'fixture-project');
  const project = await page!.evaluate(rootPath => window.codehelm.projects.import({ rootPath, name: 'V02 Python match', tags: [] }), projectRoot);
  await page!.evaluate(id => window.codehelm.analysis.start(id), project.id);
  await expect.poll(() => page!.evaluate(async id => (await window.codehelm.analysis.getTask(id))?.status, project.id)).toBe('completed');
  await page!.evaluate(async ({ projectId, executable }) => window.codehelm.profiles.save({
    id: (await window.codehelm.profiles.list(projectId))[0]?.id,
    projectId, name: 'Direct Python', isDefault: true, failurePolicy: 'block_dependents',
    services: [{ id: 'direct-python', runProfileId: '', name: 'Python service', type: 'tool', moduleRelativePath: '.', executable,
      args: [], cwdRelative: '.', env: [], dependsOn: [], enabled: true, source: 'manual' }],
  }), { projectId: project.id, executable: executable! });
  await app!.evaluate(({ dialog }, executable) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [executable] });
    dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false });
  }, executable!);
  const manifest = path.join(projectRoot, 'pyproject.toml');
  await fs.writeFile(manifest, '[project]\nrequires-python = ">=99"');
  await page!.evaluate(id => { location.hash = `/projects/${id}?tab=environment`; }, project.id);
  await page!.getByLabel('运行时', { exact: true }).selectOption('python');
  await page!.getByRole('button', { name: '选择并检查版本' }).click();
  await expect(page!.getByText('Python service · 直接路径一致 · 不满足声明', { exact: true })).toBeVisible();
  await fs.writeFile(manifest, '[project]\nrequires-python = ">=3, <4"');
  await page!.getByRole('button', { name: '选择并检查版本' }).click();
  await expect(page!.getByText('Python service · 直接路径一致 · 满足声明', { exact: true })).toBeVisible();
  await expect(page!.getByText('声明来源：pyproject.toml → project.requires-python', { exact: true })).toBeVisible();
  await page!.screenshot({ path: testInfo.outputPath('python-match.png'), animations: 'disabled' });
  await fs.writeFile(manifest, '[project]\ndynamic = ["requires-python"]');
  await page!.getByRole('button', { name: '选择并检查版本' }).click();
  await expect(page!.getByText('Python service · 直接路径一致 · 版本兼容性未确定', { exact: true })).toBeVisible();
  expect((await page!.evaluate(() => window.codehelm.runner.getState())).activeSessions).toHaveLength(0);
});

// eslint-disable-next-line no-empty-pattern
test('matches a selected Java runtime against static and dynamic project metadata', async ({}, testInfo) => {
  const executable = process.env.CODEHELM_E2E_JAVA;
  test.skip(!executable, 'Set CODEHELM_E2E_JAVA to a trusted Java 9+ executable outside the project.');
  const projectRoot = path.join(fixtureRoot, 'fixture-project');
  const project = await page!.evaluate(rootPath => window.codehelm.projects.import({ rootPath, name: 'V02 Java match', tags: [] }), projectRoot);
  await page!.evaluate(id => window.codehelm.analysis.start(id), project.id);
  await expect.poll(() => page!.evaluate(async id => (await window.codehelm.analysis.getTask(id))?.status, project.id)).toBe('completed');
  await page!.evaluate(async ({ projectId, executable }) => window.codehelm.profiles.save({
    id: (await window.codehelm.profiles.list(projectId))[0]?.id,
    projectId, name: 'Direct Java', isDefault: true, failurePolicy: 'block_dependents',
    services: [{ id: 'direct-java', runProfileId: '', name: 'Java service', type: 'tool', moduleRelativePath: '.', executable,
      args: [], cwdRelative: '.', env: [], dependsOn: [], enabled: true, source: 'manual' }],
  }), { projectId: project.id, executable: executable! });
  await app!.evaluate(({ dialog }, executable) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [executable] });
    dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false });
  }, executable!);
  const manifest = path.join(projectRoot, 'pom.xml');
  const pom = (range: string) => `<project><build><plugins><plugin><artifactId>maven-enforcer-plugin</artifactId><executions><execution><goals><goal>enforce</goal></goals><configuration><rules><requireJavaVersion><version>${range}</version></requireJavaVersion></rules></configuration></execution></executions></plugin></plugins></build></project>`;
  await fs.writeFile(manifest, pom('[99,)'));
  await page!.evaluate(id => { location.hash = `/projects/${id}?tab=environment`; }, project.id);
  await page!.getByLabel('运行时', { exact: true }).selectOption('java');
  await page!.getByRole('button', { name: '选择并检查版本' }).click();
  await expect(page!.getByText('Java service · 直接路径一致 · 不满足声明', { exact: true })).toBeVisible();
  await fs.writeFile(manifest, pom('[9,99)'));
  await page!.getByRole('button', { name: '选择并检查版本' }).click();
  await expect(page!.getByText('Java service · 直接路径一致 · 满足声明', { exact: true })).toBeVisible();
  await expect(page!.getByText('声明来源：pom.xml → Maven Enforcer requireJavaVersion（构建 JVM）', { exact: true })).toBeVisible();
  await page!.screenshot({ path: testInfo.outputPath('java-match.png'), animations: 'disabled' });
  await fs.writeFile(manifest, pom('[9,99)').replace('<build>', '<parent/><build>'));
  await page!.getByRole('button', { name: '选择并检查版本' }).click();
  await expect(page!.getByText('Java service · 直接路径一致 · 版本兼容性未确定', { exact: true })).toBeVisible();
  expect((await page!.evaluate(() => window.codehelm.runner.getState())).activeSessions).toHaveLength(0);
});

// eslint-disable-next-line no-empty-pattern
test('checks an active service snapshot before restart and records a missing file failure', async ({}, testInfo) => {
  const projectRoot = path.join(fixtureRoot, 'fixture-project');
  const script = path.join(projectRoot, 'controlled.cjs');
  await fs.copyFile(managedService, script);
  const project = await page!.evaluate(rootPath => window.codehelm.projects.import({ rootPath, name: 'V02 restart', tags: [] }), projectRoot);
  await page!.evaluate(id => window.codehelm.analysis.start(id), project.id);
  await expect.poll(() => page!.evaluate(async id => (await window.codehelm.analysis.getTask(id))?.status, project.id)).toBe('completed');
  const profile = await page!.evaluate(async ({ projectId, executable }) => window.codehelm.profiles.save({
    id: (await window.codehelm.profiles.list(projectId))[0]?.id,
    projectId, name: 'Restart check', isDefault: true, failurePolicy: 'continue',
    services: [{ id: 'restart-check', runProfileId: '', name: 'Restart service', type: 'tool', moduleRelativePath: '.', executable,
      args: ['controlled.cjs'], cwdRelative: '.', env: [], dependsOn: [], enabled: true, source: 'manual' }],
  }), { projectId: project.id, executable: process.execPath });
  const opened = app!.waitForEvent('window');
  const pending = page!.evaluate(id => window.codehelm.runner.confirmExecution(id, 'start'), profile.id);
  const review = await opened;
  await review.getByRole('button', { name: '确认并启动' }).click();
  const token = await pending;
  const started = await page!.evaluate(({ id, token }) => window.codehelm.runner.start(id, token), { id: profile.id, token });
  const replacement = await page!.evaluate(id => window.codehelm.runner.restartService(id), started.services[0].id);
  expect(replacement.status).toBe('RUNNING');
  await fs.unlink(script);
  await expect(page!.evaluate(id => window.codehelm.runner.restartService(id), replacement.id)).rejects.toThrow('CODEHELM_ENVIRONMENT_PREFLIGHT');
  const state = await page!.evaluate(() => window.codehelm.runner.getState());
  expect(state.activeSessions).toHaveLength(0);
  expect(state.history.find(item => item.id === started.id)?.services).toHaveLength(2);
  expect(state.history.find(item => item.id === started.id)?.services.find(item => item.id === replacement.id)?.errorMessage).toContain('未创建替代进程');
  await page!.evaluate(id => { location.hash = `/projects/${id}?tab=environment`; }, project.id);
  await page!.getByRole('button', { name: '查看运行记录与失败原因', exact: true }).click();
  await expect(page!).toHaveURL(/tab=history/);
  await page!.getByText('2 条服务记录', { exact: false }).click();
  await expect(page!.getByText('处理建议：原服务已经停止；修复环境问题后重新启动方案，不会自动重试。', { exact: true })).toBeVisible();
  await page!.screenshot({ path: testInfo.outputPath('restart-history.png'), animations: 'disabled' });
});

test('bounds a confirmed version process and does not expose its output on timeout', async () => {
  const compiler = process.env.CODEHELM_E2E_CSC;
  test.skip(!compiler, 'Set CODEHELM_E2E_CSC to the trusted .NET Framework compiler for the timeout fixture.');
  const source = path.join(fixtureRoot, 'timeout.cs');
  const executable = path.join(fixtureRoot, 'node.exe');
  await fs.writeFile(source, 'class TimeoutFixture { static void Main() { System.Console.Error.WriteLine("SECRET_TIMEOUT_OUTPUT"); System.Threading.Thread.Sleep(15000); } }');
  execFileSync(compiler!, ['/nologo', '/target:exe', `/out:${executable}`, source], { windowsHide: true, timeout: 15000 });
  const project = await page!.evaluate(rootPath => window.codehelm.projects.import({ rootPath, name: 'V02 timeout', tags: [] }), path.join(fixtureRoot, 'fixture-project'));
  await page!.evaluate(id => window.codehelm.analysis.start(id), project.id);
  await expect.poll(() => page!.evaluate(async id => (await window.codehelm.analysis.getTask(id))?.status, project.id)).toBe('completed');
  await app!.evaluate(({ dialog }, executable) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [executable] });
    dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false });
  }, executable);
  await page!.evaluate(id => { location.hash = `/projects/${id}?tab=environment`; }, project.id);
  const started = Date.now();
  await page!.getByRole('button', { name: '选择并检查版本' }).click();
  await expect(page!.getByText('版本检查未完成：', { exact: false })).toBeVisible();
  expect(Date.now() - started).toBeLessThan(10000);
  expect(await page!.locator('body').innerText()).not.toContain('SECRET_TIMEOUT_OUTPUT');
  expect((await page!.evaluate(() => window.codehelm.runner.getState())).activeSessions).toHaveLength(0);
});

test('rechecks a fixed port after approval without stopping the process that occupied it', async () => {
  const server = net.createServer();
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as net.AddressInfo).port;
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  try {
    const imported = await page!.evaluate(rootPath => window.codehelm.projects.import({ rootPath, name: 'V02 port recheck', tags: [] }), path.join(fixtureRoot, 'fixture-project'));
    const profile = await page!.evaluate(({ projectId, executable, script, port }) => window.codehelm.profiles.save({
      projectId, name: 'Fixed port recheck', isDefault: true, failurePolicy: 'block_dependents',
      services: [{
        id: 'port-recheck', runProfileId: '', name: 'Fixed port service', type: 'tool',
        moduleRelativePath: '.', executable, args: [script], cwdRelative: '.', env: [],
        port, portMode: 'fixed', healthCheck: { type: 'none' }, dependsOn: [], enabled: true, source: 'manual',
      }],
    }), { projectId: imported.id, executable: process.execPath, script: managedService, port });
    const opened = app!.waitForEvent('window');
    const tokenPending = page!.evaluate(id => window.codehelm.runner.confirmExecution(id, 'start', 'light'), profile.id);
    const review = await opened;
    await review.getByRole('button', { name: '确认并启动' }).click();
    const token = await tokenPending;
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, '127.0.0.1', () => { server.removeListener('error', reject); resolve(); });
    });
    await expect(page!.evaluate(({ id, token }) => window.codehelm.runner.start(id, token), { id: profile.id, token }))
      .rejects.toThrow('CODEHELM_ENVIRONMENT_PREFLIGHT');
    expect(server.listening).toBe(true);
    expect((await page!.evaluate(() => window.codehelm.runner.getState())).activeSessions).toHaveLength(0);
  } finally {
    if (server.listening) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
