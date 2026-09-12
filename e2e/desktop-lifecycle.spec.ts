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
    __codehelmLoad?: { lines: number; bytes: number };
  }
}

const repositoryRoot = process.cwd();
const desktopRoot = path.join(repositoryRoot, 'apps', 'desktop');
const mainEntry = path.join(desktopRoot, 'dist-electron', 'main', 'index.js');
const managedService = path.join(repositoryRoot, 'e2e', 'fixtures', 'managed-service.cjs');
const requireFromDesktop = createRequire(path.join(desktopRoot, 'package.json'));
const electronExecutable = process.env.CODEHELM_E2E_EXECUTABLE || requireFromDesktop('electron') as string;
const launchArgs=[...(process.env.CODEHELM_E2E_EXECUTABLE ? [] : [mainEntry]),
  ...(process.env.CODEHELM_E2E_SOFTWARE_RENDERING === '1' ? ['--disable-gpu'] : [])];
if(process.env.CI && ['CODEHELM_E2E_PYTHON','CODEHELM_E2E_JAVA','CODEHELM_E2E_CSC'].some(name=>!process.env[name])) {
  throw new Error('CI requires Python, Java and CSC fixture paths; required desktop coverage must not silently skip.');
}

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
    args: [...launchArgs, ...(process.env.CODEHELM_E2E_PERFORMANCE === '1' ? ['--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding', '--disable-background-timer-throttling', '--disable-features=CalculateNativeWinOcclusion'] : [])],
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

// eslint-disable-next-line no-empty-pattern
test('keeps the project overview inside the window and scrolls to its complete bottom content', async ({}, testInfo) => {
  const projectRoot = path.join(fixtureRoot, 'fixture-project');
  await fs.writeFile(path.join(projectRoot, 'README.md'), [
    '# Scrollable overview fixture',
    '',
    'A fixture with enough overview content to require an internal scrollbar.',
    '',
    '## Features',
    '',
    ...Array.from({ length: 12 }, (_, index) => `- Feature ${index + 1} with representative project detail content`),
  ].join('\n'));

  const project = await page!.evaluate(rootPath => window.codehelm.projects.import({
    rootPath,
    name: 'Overview Scroll Fixture',
    tags: [],
  }), projectRoot);
  await page!.evaluate(id => window.codehelm.analysis.start(id), project.id);
  await expect.poll(() => page!.evaluate(async id => (await window.codehelm.analysis.getTask(id))?.status, project.id)).toBe('completed');
  await app!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setBounds({ width: 900, height: 600 }));
  await page!.evaluate(id => { location.hash = `/projects/${id}`; }, project.id);

  const overviewPane = page!.getByTestId('project-overview-pane');
  await expect(overviewPane).toBeVisible();
  await expect.poll(async () => overviewPane.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);

  const bounds = await overviewPane.evaluate((element) => {
    const paneBounds = element.getBoundingClientRect();
    const mainBounds = element.closest('main')?.getBoundingClientRect();
    return {
      paneBottom: paneBounds.bottom,
      mainBottom: mainBounds?.bottom ?? 0,
      overflowY: getComputedStyle(element).overflowY,
    };
  });
  expect(bounds.overflowY).toBe('auto');
  expect(bounds.paneBottom).toBeLessThanOrEqual(bounds.mainBottom + 1);

  await overviewPane.evaluate((element) => element.scrollTo({ top: element.scrollHeight }));
  await expect.poll(async () => overviewPane.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  await expect(page!.getByTestId('project-overview-profile-card')).toBeInViewport();
  await page!.screenshot({ path: testInfo.outputPath('overview-bottom-visible.png'), animations: 'disabled' });
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

// eslint-disable-next-line no-empty-pattern
test('shows local Git summary and refreshes without changing repository files', async ({}, testInfo) => {
  const projectRoot = path.join(fixtureRoot, 'fixture-project');
  const git = (await import('../apps/desktop/src/main/ipc/git-summary.js')).findGitExecutable;
  const executable = await git(projectRoot); expect(executable).toBeTruthy();
  const run = (args: string[]) => execFileSync(executable!, ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', ...args], { cwd: projectRoot, windowsHide: true, encoding: 'utf8' });
  run(['init', '-b', 'main']); run(['config', 'core.autocrlf', 'false']); run(['add', '.']); run(['commit', '-m', 'Git 中文摘要']);
  const project = await page!.evaluate(rootPath => window.codehelm.projects.import({ rootPath, name: 'Git 摘要验收', tags: [] }), projectRoot);
  const indexFile = path.join(projectRoot, '.git', 'index');
  const indexBefore = await fs.readFile(indexFile);
  await page!.evaluate(id => { location.hash = `/projects/${id}`; }, project.id);
  const card = page!.getByRole('region', { name: '本地 Git 状态' });
  await expect(card.getByText('main', { exact: true })).toBeVisible();
  await expect(card).toContainText('0 个路径');
  await expect(card).toContainText('Git 中文摘要');
  await fs.writeFile(path.join(projectRoot, '中文 新文件.txt'), 'new file');
  await expect(card).toContainText('0 个路径');
  await card.getByRole('button', { name: '刷新 Git 状态' }).click();
  await expect(card).toContainText('1 个路径');
  await expect(card).toContainText('未跟踪 1');
  expect(await fs.readFile(indexFile)).toEqual(indexBefore);
  expect(await fs.readFile(path.join(projectRoot, '中文 新文件.txt'), 'utf8')).toBe('new file');
  await app!.evaluate(({ BrowserWindow }) => { const win = BrowserWindow.getAllWindows()[0]; win.setBounds({ width: 960, height: 600 }); win.show(); win.focus(); });
  await card.scrollIntoViewIfNeeded();
  await page!.screenshot({ path: testInfo.outputPath('git-summary-960.png'), animations: 'disabled' });
  await page!.evaluate(() => localStorage.setItem('codehelm_theme', 'light'));
  await page!.reload();
  await expect(card).toContainText('1 个路径');
  await card.scrollIntoViewIfNeeded();
  await page!.screenshot({ path: testInfo.outputPath('git-summary-light-960.png'), animations: 'disabled' });
  run(['checkout', '--detach']);
  await card.getByRole('button', { name: '刷新 Git 状态' }).click();
  await expect(card).toContainText('分离 HEAD');
  run(['config', 'filter.unsupported.clean', 'echo should-not-run']);
  await card.getByRole('button', { name: '刷新 Git 状态' }).click();
  await expect(card).toContainText('暂不支持');
  await expect(card).not.toContainText('1 个路径');
  await expect(page!.getByRole('button', { name: '重新分析', exact: true })).toBeEnabled();
});

// eslint-disable-next-line no-empty-pattern
test('imports a portable profile template through reviewed UI and retains it across restart', async ({}, testInfo) => {
  const project = await page!.evaluate(rootPath => window.codehelm.projects.import({ rootPath, name: '模板验收', tags: [] }), path.join(fixtureRoot, 'fixture-project'));
  await page!.evaluate(id => { location.hash = `/projects/${id}`; }, project.id);
  await app!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setBounds({ width: 960, height: 600 }));
  await page!.getByRole('button', { name: '导入 / 导出模板' }).click();
  await page!.getByRole('button', { name: '使用 Node 通用模板' }).click();
  await page!.getByRole('button', { name: '校验模板', exact: true }).click();
  await expect(page!.getByRole('button', { name: '预览新方案' })).toBeDisabled();
  await page!.getByLabel('ENTRY_FILE', { exact: true }).fill('service.cjs');
  await page!.getByRole('button', { name: '预览新方案' }).click();
  await expect(page!.getByRole('region', { name: '导入差异预览' })).toBeVisible();
  await page!.getByRole('checkbox', { name: '已核对目标项目与新增服务' }).check();
  await page!.getByRole('button', { name: '确认导入为新方案' }).scrollIntoViewIfNeeded();
  await app!.evaluate(({ BrowserWindow }) => { const window = BrowserWindow.getAllWindows()[0]; window.show(); window.focus(); });
  await page!.bringToFront();
  await page!.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await page!.screenshot({ path: testInfo.outputPath('template-preview-960.png'), animations: 'disabled' });
  await page!.getByRole('button', { name: '确认导入为新方案' }).click();
  await expect(page!.getByText('运行配置模板', { exact: true })).toHaveCount(0);
  const imported = (await page!.evaluate(id => window.codehelm.profiles.list(id), project.id)).find(p => p.name === 'Node 服务模板 导入')!;
  expect(imported.services[0].args).toEqual(['service.cjs']);
  expect(imported.userConfirmedAt).toBeUndefined();
  expect((await page!.evaluate(() => window.codehelm.runner.getState())).activeSessions).toHaveLength(0);
  await page!.getByRole('button', { name: '导入 / 导出模板' }).click();
  await page!.getByRole('button', { name: '导出当前方案' }).click();
  const json = await page!.getByRole('textbox', { name: '模板 JSON', exact: true }).inputValue();
  expect(json).toContain('{{SERVICE_1_ARG_1}}'); expect(json).not.toContain('service.cjs');
  const exportFile = path.join(fixtureRoot, 'exported-template.json');
  await app!.evaluate(({ dialog }, filePath) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath });
  }, exportFile);
  await page!.getByRole('button', { name: '保存脱敏 JSON 文件' }).click();
  await expect(page!.getByRole('status').filter({ hasText: '脱敏模板已保存' })).toBeVisible();
  expect(await fs.readFile(exportFile, 'utf8')).toBe(json);
  await app!.close(); app = undefined;
  const environment = { ...process.env }; delete environment.ELECTRON_RUN_AS_NODE; delete environment.VITE_DEV_SERVER_URL;
  app = await electron.launch({ executablePath: electronExecutable, args: launchArgs, cwd: desktopRoot, env: { ...environment, CODEHELM_USER_DATA_DIR: path.join(fixtureRoot, 'user-data'), CODEHELM_VALIDATION_WINDOW: '0' } });
  page = await app.firstWindow(); await page.waitForLoadState('domcontentloaded');
  expect(await page.evaluate(id => window.codehelm.profiles.get(id), imported.id)).toMatchObject({ name: imported.name, services: [{ args: ['service.cjs'] }] });
});

// eslint-disable-next-line no-empty-pattern
test('organizes projects across restart and repairs a moved project through reviewed UI', async ({}, testInfo) => {
  const original = path.join(fixtureRoot,'fixture-project');
  const project = await page!.evaluate(rootPath => window.codehelm.projects.import({rootPath,name:'V02-007 整理验收',tags:['work','web']}),original);
  await page!.getByRole('button',{name:'刷新项目列表与实时状态'}).click();
  await page!.getByRole('button',{name:'收藏 V02-007 整理验收',exact:true}).click();
  await page!.getByLabel('归档范围').click();
  await page!.getByText('未归档',{exact:true}).click();
  await page!.getByRole('checkbox',{name:'仅收藏',exact:true}).check();
  await page!.getByLabel('组合标签').click();
  await page!.getByText('work',{exact:true}).click();
  await page!.getByText('web',{exact:true}).click();
  await page!.keyboard.press('Escape');
  await expect(page!.getByText('V02-007 整理验收',{exact:true})).toBeVisible();
  await page!.getByRole('button',{name:'归档',exact:true}).click();
  await expect(page!.getByText('V02-007 整理验收',{exact:true})).toHaveCount(0);
  await page!.getByLabel('归档范围').click();
  await page!.getByText('已归档',{exact:true}).click();
  await expect(page!.getByText('V02-007 整理验收',{exact:true})).toBeVisible();
  await expect(page!.getByRole('button',{name:'取消收藏 V02-007 整理验收',exact:true}).locator('svg')).toHaveCSS('color', 'rgb(250, 204, 21)');
  await expect(page!.getByRole('button',{name:'取消归档',exact:true}).locator('svg')).toHaveCSS('color', 'rgb(14, 165, 233)');
  await page!.screenshot({path:testInfo.outputPath('organization-dark.png'),animations:'disabled'});
  await app!.close();app=undefined;
  const environment={...process.env};delete environment.ELECTRON_RUN_AS_NODE;delete environment.VITE_DEV_SERVER_URL;
  app=await electron.launch({executablePath:electronExecutable,args:launchArgs,cwd:desktopRoot,env:{...environment,CODEHELM_USER_DATA_DIR:path.join(fixtureRoot,'user-data'),CODEHELM_VALIDATION_WINDOW:'0'}});
  page=await app.firstWindow();await page.waitForLoadState('domcontentloaded');
  expect(await page.evaluate(id=>window.codehelm.projects.get(id),project.id)).toMatchObject({favorite:true,archived:true,tags:['work','web']});
  await page.evaluate(id=>{location.hash=`/projects/${id}`;},project.id);
  await page.getByRole('textbox',{name:'新标签',exact:true}).fill('v02');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Escape');
  await page.getByRole('button',{name:'保存标签',exact:true}).click();
  await expect.poll(async()=>(await page!.evaluate(id=>window.codehelm.projects.get(id),project.id))?.tags).toEqual(['work','web','v02']);
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setBounds({width:960,height:600}));
  const moved=path.join(fixtureRoot,'移动后的 中文项目');
  await fs.rename(original,moved);
  await page.getByRole('button',{name:'修复项目路径'}).click();
  await page.getByRole('textbox',{name:'新项目路径'}).fill(moved);
  await page.getByRole('button',{name:'核对新位置'}).click();
  await expect(page.getByText('package.json',{exact:true})).toBeVisible();
  await page.getByRole('checkbox',{name:'我已核对，这是原项目的新位置'}).check();
  await page.screenshot({path:testInfo.outputPath('relocation-preview.png'),animations:'disabled'});
  await page.getByRole('button',{name:'确认绑定并重新分析'}).click();
  await expect.poll(async()=>{
    const saved=await page!.evaluate(id=>window.codehelm.projects.get(id),project.id);
    return saved?.rootPath.includes('移动后的 中文项目') && !!saved.lastAnalyzedAt;
  }).toBe(true);
  await expect.poll(async()=>(await page!.evaluate(id=>window.codehelm.analysis.getTask(id),project.id))?.status).toBe('completed');
  await page.evaluate(()=>{location.hash='/settings';});
  await page.getByRole('button',{name:'明亮模式',exact:true}).click();
  await page.evaluate(id=>{location.hash=`/projects/${id}`;},project.id);
  await expect(page.getByLabel('项目标签')).toBeVisible();
  await expect(page.locator('.project-tag-select .n-base-suffix')).toHaveCSS('color','rgb(9, 9, 11)');
  await page.evaluate(()=>{location.hash='/';});
  await page.getByLabel('归档范围').click();
  await expect(page.locator('.n-base-select-option--selected .n-base-select-option__check').first()).toHaveCSS('color','rgb(9, 9, 11)');
  await page.getByText('已归档',{exact:true}).click();
  await page.getByRole('button',{name:'选择本页',exact:true}).click();
  await page.mouse.move(0,0);
  await expect(page.getByRole('button',{name:'取消选择',exact:true})).toHaveCSS('color','rgb(225, 29, 72)');
  await expect(page.locator('html')).toHaveCSS('color','rgb(9, 9, 11)');
  await page.screenshot({path:testInfo.outputPath('selection-colors-light.png'),animations:'disabled'});
  await page.getByRole('button',{name:'批量取消归档',exact:true}).click();
  await expect(page.getByRole('status').filter({hasText:'批量整理'})).toContainText('成功 1 / 1');
  await page.getByLabel('归档范围').click();await page.getByText('未归档',{exact:true}).click();
  await expect(page.getByText('V02-007 整理验收',{exact:true}).first()).toBeVisible();
  await page.screenshot({path:testInfo.outputPath('organization-light.png'),animations:'disabled'});
  await page.evaluate(id=>window.codehelm.projects.remove(id),project.id);
  expect(await fs.readFile(path.join(moved,'package.json'),'utf8')).toContain('codehelm-e2e-fixture');
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
  await page!.evaluate(id => window.codehelm.projects.update(id,{archived:true}), imported.id);
  expect((await page!.evaluate(() => window.codehelm.runner.getState())).activeSessions.some(run => run.id === started.id)).toBe(true);
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

async function restartWithReview(id: string) {
  const opened = app!.waitForEvent('window');
  const pending = page!.evaluate(serviceId => window.codehelm.runner.restartService(serviceId), id);
  const review = await opened;
  await expect(review.getByText('其他服务不会联动重启。', { exact: false })).toBeVisible();
  await review.getByRole('button', { name: '确认并启动' }).click();
  return pending;
}

async function createMultiProfileFixture() {
  const root = path.join(fixtureRoot, 'fixture-project');
  await fs.copyFile(managedService, path.join(root, 'controlled.cjs'));
  const project = await page!.evaluate(rootPath => window.codehelm.projects.import({ rootPath, name: '多方案验收', tags: [] }), root);
  await page!.evaluate(id => window.codehelm.analysis.start(id), project.id);
  await expect.poll(() => page!.evaluate(async id => (await window.codehelm.analysis.getTask(id))?.status, project.id)).toBe('completed');
  return page!.evaluate(async ({ projectId, executable }) => window.codehelm.profiles.save({
    id: (await window.codehelm.profiles.list(projectId))[0].id,
    projectId, name: '完整开发', isDefault: true, failurePolicy: 'block_dependents',
    services: [{ id: 'multi-service', runProfileId: '', name: '受控服务', type: 'tool', moduleRelativePath: '.', executable,
      args: ['controlled.cjs'], cwdRelative: '.', env: [], dependsOn: [], enabled: true, source: 'manual' }],
  }), { projectId: project.id, executable: process.execPath });
}

// eslint-disable-next-line no-empty-pattern
test('migrates the released v0.1 schema and preserves a usable pre-upgrade snapshot',async({},testInfo)=>{
  await app!.close();app=undefined;
  const userData=path.join(fixtureRoot,'升级 中文 空格');await fs.mkdir(userData);
  const DB=requireFromDesktop('better-sqlite3');
  const filename=path.join(userData,'codehelm.sqlite'),old=new DB(filename);
  old.exec(await fs.readFile(path.join(repositoryRoot,'e2e','fixtures','v010-schema.sql'),'utf8'));
  const projectId=crypto.randomUUID(),profileId=crypto.randomUUID(),runId=crypto.randomUUID();
  old.prepare('INSERT INTO projects(id,name,root_path,created_at,updated_at) VALUES (?,?,?,?,?)').run(projectId,'旧版项目',path.join(fixtureRoot,'fixture-project'),'2026-09-01','2026-09-01');
  old.prepare('INSERT INTO run_profiles(id,project_id,name,created_at,updated_at) VALUES (?,?,?,?,?)').run(profileId,projectId,'旧版方案','2026-09-01','2026-09-01');
  old.prepare('INSERT INTO run_sessions(id,project_id,run_profile_id,status,started_at,stopped_at) VALUES (?,?,?,?,?,?)').run(runId,projectId,profileId,'FAILED','2026-09-01T00:00:00.000Z','2026-09-01T00:01:00.000Z');
  old.prepare('INSERT INTO app_settings VALUES (?,?)').run('global',JSON.stringify({maxScanFiles:12345}));old.close();
  const environment={...process.env};delete environment.ELECTRON_RUN_AS_NODE;delete environment.VITE_DEV_SERVER_URL;
  app=await electron.launch({executablePath:electronExecutable,args:launchArgs,cwd:desktopRoot,env:{...environment,CODEHELM_USER_DATA_DIR:userData}});
  page=await app.firstWindow();await page.waitForLoadState('domcontentloaded');
  expect((await page.evaluate(id=>window.codehelm.projects.get(id),projectId))?.name).toBe('旧版项目');
  expect((await page.evaluate(id=>window.codehelm.profiles.get(id),profileId))?.name).toBe('旧版方案');
  expect((await page.evaluate(()=>window.codehelm.settings.get())).maxScanFiles).toBe(12345);
  expect((await page.evaluate(()=>window.codehelm.runner.queryHistory({limit:20}))).sessions[0].id).toBe(runId);
  await page.evaluate(()=>{location.hash='/settings';});
  await expect(page.getByRole('list',{name:'数据库备份列表'})).toContainText('schema 2');
  await page.screenshot({path:testInfo.outputPath('upgrade-v010.png'),animations:'disabled'});
  await app.close();app=undefined;page=undefined;
  const upgraded=new DB(filename,{readonly:true});expect(upgraded.pragma('user_version',{simple:true})).toBe(4);upgraded.close();
  const directories=await fs.readdir(path.join(userData,'backups'));
  const snapshot=new DB(path.join(userData,'backups',directories.find(id=>!id.startsWith('.'))!,'codehelm.sqlite'),{readonly:true});
  expect(snapshot.pragma('user_version',{simple:true})).toBe(2);
  expect(snapshot.prepare('SELECT name FROM projects').get()).toEqual({name:'旧版项目'});snapshot.close();
});

// eslint-disable-next-line no-empty-pattern
test('measures sustained log memory and stop latency',async({},testInfo)=>{
  test.skip(process.env.CODEHELM_E2E_PERFORMANCE!=='1','Opt-in ten-minute sustained performance run.');
  test.setTimeout(720_000);
  // Input measurements model an active desktop window, not Chromium's occluded-window frame timer.
  await app!.evaluate(({ BrowserWindow }) => {
    for (const window of BrowserWindow.getAllWindows()) window.webContents.setBackgroundThrottling(false);
  });
  const profile=await createMultiProfileFixture();
  await fs.writeFile(path.join(fixtureRoot,'fixture-project','controlled.cjs'),"const line='load '+'x'.repeat(194)+'\\n';const started=Date.now();let sent=0;function tick(){const count=Math.min(100,Math.floor((Date.now()-started)/100)*100-sent);if(count>0){sent+=count;if(!process.stdout.write(line.repeat(count))){process.stdout.once('drain',()=>setTimeout(tick,10));return;}}setTimeout(tick,10);}tick();");
  await page!.evaluate(() => {
    window.__codehelmLoad = { lines: 0, bytes: 0 };
    window.codehelm.runner.onLogs(batch => {
      for (const entry of batch.entries) if (entry.message.startsWith('load ')) {
        window.__codehelmLoad!.lines += (entry.message.match(/\n/g) ?? []).length;
        window.__codehelmLoad!.bytes += new TextEncoder().encode(entry.message).length;
      }
    });
  });
  const opened=app!.waitForEvent('window'),pending=page!.evaluate(id=>window.codehelm.runner.confirmExecution(id,'start'),profile.id);
  await(await opened).getByRole('button',{name:'确认并启动'}).click();const token=await pending;
  const run=await page!.evaluate(({id,token})=>window.codehelm.runner.start(id,token),{id:profile.id,token});
  await page!.evaluate(()=>{location.hash='/console';});
  await app!.evaluate(({ BrowserWindow }) => { for (const window of BrowserWindow.getAllWindows()) { window.show(); window.focus(); } });
  const samples:Array<{seconds:number;workingSetKb:number;receivedLines:number;receivedBytes:number}>=[];
  const inputLatencyMs: number[] = [];
  const filterInput = page!.getByPlaceholder('检索日志关键字...');
  await expect(filterInput).toBeVisible();
  const start=Date.now();
  const smoke = process.env.CODEHELM_E2E_SCOPE === 'smoke';
  const durationMs = smoke ? 60000 : 600000;
  while(Date.now()-start<durationMs){
    const memory=await app!.evaluate(({app})=>app.getAppMetrics().reduce((sum,item)=>({workingSetKb:sum.workingSetKb+item.memory.workingSetSize}),{workingSetKb:0}));
    const received = await page!.evaluate(() => window.__codehelmLoad!);
    samples.push({seconds:(Date.now()-start)/1000,...memory,receivedLines:received.lines,receivedBytes:received.bytes});
    await filterInput.evaluate(el => el.addEventListener('input', () => performance.mark('log-filter-input'), { once: true, capture: true }));
    await filterInput.fill(samples.length % 2 ? 'load' : '');
    inputLatencyMs.push(await page!.evaluate(() => new Promise<number>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => {
      resolve(performance.now() - performance.getEntriesByName('log-filter-input').at(-1)!.startTime);
    })))));
    if (samples.length % 12 === 0) {
      await fs.writeFile(testInfo.outputPath('performance-progress.json'), JSON.stringify({ complete: false, samples, inputLatencyMs }, null, 2));
    }
    await new Promise(resolve=>setTimeout(resolve,5000));
  }
  const median=(values:number[])=>{const sorted=[...values].sort((a,b)=>a-b);return sorted[Math.floor(sorted.length/2)];};
  const early=median(samples.filter(s=>smoke ? s.seconds < 20 : s.seconds>=120&&s.seconds<180).map(s=>s.workingSetKb));
  const late=median(samples.filter(s=>smoke ? s.seconds >= 40 : s.seconds>=540).map(s=>s.workingSetKb));
  const bufferStatus = await page!.getByText(/^当前缓冲 /).first().textContent();
  await page!.evaluate(()=>{location.hash='/runner';});
  const stopButton = page!.getByRole('button',{name:'停止该项目'});
  await expect(stopButton).toBeVisible(); await expect(stopButton).toBeEnabled();
  await stopButton.evaluate(el => el.addEventListener('click', () => performance.mark('stop-click'), { once: true, capture: true }));
  await stopButton.click();
  await expect.poll(()=>page!.evaluate(()=>window.codehelm.runner.getState()).then(state=>state.activeSessions.length), { intervals: [20] }).toBe(0);
  const stopMs=await page!.evaluate(() => performance.now() - performance.getEntriesByName('stop-click').at(-1)!.startTime);
  const first = samples[0], last = samples.at(-1)!;
  const receivedLinesPerSecond = (last.receivedLines - first.receivedLines) / (last.seconds - first.seconds);
  const sortedLatency = [...inputLatencyMs].sort((a, b) => a - b);
  const inputP95Ms = sortedLatency[Math.ceil(sortedLatency.length * .95) - 1];
  await fs.writeFile(testInfo.outputPath('performance.json'),JSON.stringify({sample:'nominal 1000 lines/s, 200 bytes/line',durationMs,acceptanceRun:!smoke,backgroundThrottling:false,occlusionThrottling:false,stopTiming:'captured DOM click to zero active sessions; navigation excluded',os:os.release(),cpu:os.cpus()[0].model,totalMemory:os.totalmem(),packaged:!!process.env.CODEHELM_E2E_EXECUTABLE,samples,receivedLinesPerSecond,inputLatencyMs,inputP95Ms,bufferStatus,earlyMedianKb:early,lateMedianKb:late,growth:late/early-1,stopMs,runId:run.id},null,2));
  await page!.screenshot({path:testInfo.outputPath('performance-stopped.png'),animations:'disabled'});
  expect(stopMs).toBeLessThanOrEqual(1000);if (!smoke) expect(late/early).toBeLessThanOrEqual(1.2);
  expect(inputP95Ms).toBeLessThanOrEqual(200);
});

// eslint-disable-next-line no-empty-pattern
test('backs up management data and restores it after confirmation and a real application restart',async({},testInfo)=>{
  const profile=await createMultiProfileFixture();
  await page!.evaluate(()=>window.codehelm.settings.update({maxScanFiles:12345}));
  await page!.evaluate(()=>{location.hash='/settings';});
  await page!.getByRole('button',{name:'创建管理数据备份',exact:true}).click();
  const item=page!.getByRole('list',{name:'数据库备份列表'}).getByRole('listitem').filter({hasText:'手动备份'}).first();
  await expect(item).toContainText('校验通过');
  await expect(item).toContainText(`版本 ${JSON.parse(await fs.readFile(path.join(desktopRoot,'package.json'),'utf8')).version}`);
  await item.getByRole('button',{name:'明确保留',exact:true}).click();
  await expect(item.getByRole('button',{name:'解除保留'})).toBeVisible();
  await page!.evaluate(async id=>{await window.codehelm.projects.update(id,{name:'恢复后应消失的名称'});await window.codehelm.settings.update({maxScanFiles:23456});},profile.projectId);
  await item.getByRole('button',{name:'预检恢复'}).click();
  await expect(page!.getByRole('dialog')).toContainText('项目 1 个');
  await page!.screenshot({path:testInfo.outputPath('backup-restore-preview.png'),animations:'disabled'});
  // Native system dialogs are replaced only in this isolated test process; business IPC is real.
  await app!.evaluate(({dialog})=>{dialog.showMessageBox=(async()=>({response:0,checkboxChecked:false})) as typeof dialog.showMessageBox;});
  await page!.getByRole('button',{name:'继续恢复确认'}).click();
  await expect(page!.getByRole('dialog')).not.toBeVisible();
  expect((await page!.evaluate(id=>window.codehelm.projects.get(id),profile.projectId))?.name).toBe('恢复后应消失的名称');
  const opened=app!.waitForEvent('window');
  const pending=page!.evaluate(id=>window.codehelm.runner.confirmExecution(id,'start'),profile.id);
  await(await opened).getByRole('button',{name:'确认并启动'}).click();
  const token=await pending;
  const run=await page!.evaluate(({id,token})=>window.codehelm.runner.start(id,token),{id:profile.id,token});
  const pid=run.services[0].pid!;
  await item.getByRole('button',{name:'预检恢复'}).click();
  await app!.evaluate(({dialog})=>{dialog.showMessageBox=(async(options:Electron.MessageBoxOptions)=>{
    if(options.title!=='恢复 CodeHelm 管理数据'||!options.detail?.includes('将停止本应用任务'))throw new Error('Missing restore confirmation');
    return {response:1,checkboxChecked:false};
  }) as typeof dialog.showMessageBox;});
  await page!.getByRole('button',{name:'继续恢复确认'}).click();
  await expect(page!.getByText('恢复完成。原数据保全目录：',{exact:false})).toBeVisible();
  expect(()=>process.kill(pid,0)).toThrow();
  await expect(page!.evaluate(()=>window.codehelm.projects.list())).rejects.toThrow('维护');
  await page!.screenshot({path:testInfo.outputPath('backup-restored.png'),animations:'disabled'});
  await app!.close();app=undefined;
  const environment={...process.env};delete environment.ELECTRON_RUN_AS_NODE;delete environment.VITE_DEV_SERVER_URL;
  app=await electron.launch({executablePath:electronExecutable,args:launchArgs,cwd:desktopRoot,env:{...environment,CODEHELM_USER_DATA_DIR:path.join(fixtureRoot,'user-data'),CODEHELM_VALIDATION_WINDOW:'0'}});
  page=await app.firstWindow();await page.waitForLoadState('domcontentloaded');
  expect((await page.evaluate(id=>window.codehelm.projects.get(id),profile.projectId))?.name).toBe('多方案验收');
  expect((await page.evaluate(()=>window.codehelm.settings.get())).maxScanFiles).toBe(12345);
  expect((await page.evaluate(id=>window.codehelm.profiles.get(id),profile.id))?.name).toBe('完整开发');
  expect((await page.evaluate(()=>window.codehelm.runner.getState())).activeSessions).toHaveLength(0);
  await page.evaluate(()=>{location.hash='/settings';});
  await expect(page.getByRole('list',{name:'数据库备份列表'})).toContainText('恢复前保全');
  await page.getByRole('button',{name:'明亮模式',exact:true}).click();
  await page.screenshot({path:testInfo.outputPath('backup-management-light.png'),animations:'disabled'});
});

// eslint-disable-next-line no-empty-pattern
test('finds deleted-profile failure logs after app restart and exports the filtered loaded page', async ({}, testInfo) => {
  let profile = await createMultiProfileFixture();
  const script = path.join(fixtureRoot,'fixture-project','controlled.cjs');
  const secret='V02_PRIVATE_FAILURE_SECRET';
  await fs.writeFile(script, `process.stdout.write('ordinary-output\\n'); process.stderr.write('prefix '+process.env.SECRET.slice(0,8)); setTimeout(()=>{process.stderr.write(process.env.SECRET.slice(8)+'\\n');process.stderr.write('failure '+process.env.SECRET+'\\n');setTimeout(()=>process.exit(7),50)},40);`);
  profile=await page!.evaluate(({input,secret})=>window.codehelm.profiles.save({...input,name:'日志故障方案',services:input.services.map(s=>({...s,env:[{key:'SECRET',value:secret,isSecret:true}]}))}),{input:profile,secret});
  const opened=app!.waitForEvent('window');
  const pending=page!.evaluate(id=>window.codehelm.runner.confirmExecution(id,'start'),profile.id);
  await (await opened).getByRole('button',{name:'确认并启动'}).click();
  const token=await pending;
  await page!.evaluate(({id,token})=>window.codehelm.runner.start(id,token).catch(()=>null),{id:profile.id,token});
  const state=await waitForRunnerState(state=>state.history.some(run=>run.runProfileId===profile.id&&run.status==='FAILED'));
  const run=state.history.find(run=>run.runProfileId===profile.id)!;
  await expect.poll(()=>page!.evaluate(async id=>(await window.codehelm.runner.queryLogs({runSessionId:id,stream:'stderr',keyword:'failure'})).entries.length,run.id)).toBeGreaterThan(0);
  await page!.evaluate(id=>window.codehelm.profiles.remove(id),profile.id);
  await app!.close();app=undefined;
  const environment={...process.env};delete environment.ELECTRON_RUN_AS_NODE;delete environment.VITE_DEV_SERVER_URL;
  app=await electron.launch({executablePath:electronExecutable,args:launchArgs,cwd:desktopRoot,env:{...environment,CODEHELM_USER_DATA_DIR:path.join(fixtureRoot,'user-data'),CODEHELM_VALIDATION_WINDOW:'0'}});
  page=await app.firstWindow();await page.waitForLoadState('domcontentloaded');
  const history=await page.evaluate(projectId=>window.codehelm.runner.queryHistory({projectId,profileName:'日志故障',serviceName:'受控',status:'FAILED',limit:20}),profile.projectId);
  expect(history.sessions.map(item=>item.id)).toContain(run.id);
  expect(history.sessions.find(item=>item.id===run.id)!.services[0].exitCode).toBe(7);
  await page.evaluate(id=>{location.hash=`/projects/${id}?tab=history`;},profile.projectId);
  await page.getByRole('textbox',{name:'历史方案名称'}).fill('日志故障');
  await page.getByRole('button',{name:'检索会话',exact:true}).click();
  await page.getByText('1 条服务记录',{exact:false}).click();
  await page.getByRole('button',{name:'查看此服务日志',exact:true}).click();
  const modal=page.getByRole('dialog');
  await expect(modal.getByText('ordinary-output',{exact:false})).toBeVisible();
  await modal.getByRole('combobox',{name:'历史日志输出流'}).selectOption('stderr');
  await modal.getByRole('textbox',{name:'历史日志关键词'}).fill('failure');
  await modal.getByRole('button',{name:'查询日志',exact:true}).click();
  await expect(modal.locator('pre')).toContainText(['failure [REDACTED]']);
  await expect(modal.getByText('ordinary-output',{exact:false})).toHaveCount(0);
  expect(await modal.innerText()).not.toContain(secret);
  const output=path.join(fixtureRoot,'filtered-history.log');
  await app.evaluate(({BrowserWindow},file)=>{BrowserWindow.getAllWindows()[0].webContents.session.once('will-download',(_event,item)=>{item.setSavePath(file);});},output);
  await modal.getByRole('button',{name:'导出本页已加载日志'}).click();
  await expect.poll(async()=>fs.readFile(output,'utf8').catch(()=>'' )).toContain('failure [REDACTED]');
  const exported=await fs.readFile(output,'utf8');
  expect(exported).toContain('不是完整会话日志');expect(exported).not.toContain(secret);expect(exported).not.toContain('ordinary-output');
  expect(exported.split('\n').filter(line=>line.startsWith('{')).every(line=>JSON.parse(line).stream==='stderr')).toBe(true);
  await page.screenshot({path:testInfo.outputPath('stored-failure-logs.png'),animations:'disabled'});
});

// eslint-disable-next-line no-empty-pattern
test('keeps stop controls responsive during high-volume logging and a stored-log query', async ({},testInfo)=>{
  const profile=await createMultiProfileFixture();
  await fs.writeFile(path.join(fixtureRoot,'fixture-project','controlled.cjs'),`let bytes=0;const value='x'.repeat(32768);const timer=setInterval(()=>{if(bytes<6*1024*1024){process.stdout.write(value+'\\n');bytes+=value.length;}},2);`);
  const opened=app!.waitForEvent('window');
  const pending=page!.evaluate(id=>window.codehelm.runner.confirmExecution(id,'start'),profile.id);
  await(await opened).getByRole('button',{name:'确认并启动'}).click();
  const token=await pending;
  const run=await page!.evaluate(({id,token})=>window.codehelm.runner.start(id,token),{id:profile.id,token});
  await page!.evaluate(()=>{location.hash='/console';});
  await expect(page!.getByText('当前缓冲',{exact:false})).toBeVisible();
  await expect.poll(()=>page!.locator('[data-log-entry-id]').count()).toBeGreaterThan(0);
  await page!.getByRole('button',{name:'跟随最新',exact:true}).click();
  await page!.getByPlaceholder('检索日志关键字...').fill('x');
  await page!.getByRole('button',{name:'OUT',exact:true}).click();
  const serviceButton=page!.getByRole('button',{name:new RegExp(`^${run.services[0].serviceName} \\(`)});
  await serviceButton.click();
  const scrollArea=page!.locator('.terminal-code-stream .v-vl');
  const savedTop=await scrollArea.evaluate(el=>{el.scrollTop=320;el.dispatchEvent(new Event('scroll'));return el.scrollTop;});
  expect(savedTop).toBeGreaterThan(0);
  await page!.getByRole('button',{name:/^全部服务/}).click();
  await serviceButton.click();
  await expect.poll(()=>scrollArea.evaluate(el=>el.scrollTop)).toBe(savedTop);
  await expect(page!.getByPlaceholder('检索日志关键字...')).toHaveValue('x');
  await expect(page!.getByRole('button',{name:'OUT',exact:true})).toHaveClass(/bg-zinc-700/);
  await page!.getByRole('button',{name:'回到最新',exact:true}).click();
  await expect.poll(()=>scrollArea.evaluate(el=>el.scrollTop)).toBe(0);
  const outcome=await page!.evaluate(async id=>{
    const reading=window.codehelm.runner.queryLogs({runSessionId:id});
    const start=performance.now();await window.codehelm.runner.stopSession(id);
    return {elapsed:performance.now()-start,logs:await reading};
  },run.id);
  expect(outcome.elapsed).toBeLessThan(5000);
  expect(outcome.logs.entries.length).toBeLessThanOrEqual(200);
  expect((await page!.evaluate(()=>window.codehelm.runner.getState())).activeSessions).toHaveLength(0);
  await page!.screenshot({path:testInfo.outputPath('bounded-live-console.png'),animations:'disabled'});
});

// eslint-disable-next-line no-empty-pattern
test('manages three independent profiles in the desktop UI and persists the default after restart', async ({}, testInfo) => {
  const original = await createMultiProfileFixture();
  await page!.evaluate(id => { location.hash = `/projects/${id}?tab=config`; }, original.projectId);
  for (const name of ['仅前端', '仅后端']) {
    await page!.getByRole('button', { name: '复制方案', exact: true }).click();
    const modal = page!.getByRole('dialog');
    await modal.getByRole('textbox', { name: '方案名称', exact: true }).fill(name);
    await modal.getByRole('button', { name: '保存方案', exact: true }).click();
    await expect(page!.getByRole('textbox', { name: '编辑方案名称' })).toHaveValue(name);
  }
  await page!.getByRole('checkbox', { name: '设为此项目默认方案' }).check();
  await page!.getByRole('button', { name: '保存方案修改', exact: true }).click();
  await expect(page!.getByRole('combobox', { name: '当前运行方案' })).toBeEnabled();
  const profiles = await page!.evaluate(id => window.codehelm.profiles.list(id), original.projectId);
  expect(profiles).toHaveLength(3);
  expect(profiles.filter(p => p.isDefault).map(p => p.name)).toEqual(['仅后端']);
  expect(new Set(profiles.flatMap(p => p.services.map(s => s.id))).size).toBe(3);
  for (const profile of profiles) {
    await page!.getByRole('combobox', { name: '当前运行方案' }).selectOption(profile.id);
    await expect(page!.getByRole('textbox', { name: '编辑方案名称' })).toHaveValue(profile.name);
  }
  await page!.getByRole('textbox', { name: '编辑方案名称' }).fill('未保存名称');
  await expect(page!.getByRole('combobox', { name: '当前运行方案' })).toBeDisabled();
  await page!.getByRole('button', { name: '放弃修改', exact: true }).click();
  await expect(page!.getByRole('combobox', { name: '当前运行方案' })).toBeEnabled();
  await page!.getByRole('button', { name: '新建方案', exact: true }).click();
  await page!.getByRole('dialog').getByRole('textbox', { name: '方案名称', exact: true }).fill('临时方案');
  await page!.getByRole('dialog').getByRole('button', { name: '保存方案', exact: true }).click();
  await expect(page!.getByRole('textbox', { name: '编辑方案名称' })).toHaveValue('临时方案');
  await page!.getByRole('button', { name: '删除方案', exact: true }).click();
  await page!.getByRole('dialog').getByRole('button', { name: '删除方案', exact: true }).click();
  await expect(page!.getByRole('textbox', { name: '编辑方案名称' })).toHaveValue('仅后端');
  await page!.screenshot({ path: testInfo.outputPath('profiles-dark.png'), animations: 'disabled' });
  await page!.locator('a[href="#/settings"]').click();
  await page!.getByRole('button', { name: '明亮模式' }).click();
  await expect(page!.locator('html')).toHaveClass(/light/);
  await app!.close(); app = undefined;
  const environment = { ...process.env }; delete environment.ELECTRON_RUN_AS_NODE; delete environment.VITE_DEV_SERVER_URL;
  app = await electron.launch({ executablePath: electronExecutable, args: launchArgs, cwd: desktopRoot,
    env: { ...environment, CODEHELM_USER_DATA_DIR: path.join(fixtureRoot, 'user-data'), CODEHELM_VALIDATION_WINDOW: '0' } });
  page = await app.firstWindow(); await page.waitForLoadState('domcontentloaded');
  await page.evaluate(id => { location.hash = `/projects/${id}?tab=config`; }, original.projectId);
  await expect(page.getByRole('textbox', { name: '编辑方案名称' })).toHaveValue('仅后端');
  expect(await page.evaluate(id => window.codehelm.profiles.list(id), original.projectId)).toEqual(profiles);
  await page.screenshot({ path: testInfo.outputPath('profiles-light.png'), animations: 'disabled' });
});

// eslint-disable-next-line no-empty-pattern
test('invalidates edited approvals and preserves the effective profile and history after deletion', async ({}, testInfo) => {
  let profile = await createMultiProfileFixture();
  async function confirmation(approved: boolean) {
    const opened = app!.waitForEvent('window');
    const pending = page!.evaluate(id => window.codehelm.runner.confirmExecution(id, 'start').then(token => ({ token, error: '' })).catch(error => ({ token: '', error: String(error) })), profile.id);
    const review = await opened;
    await review.getByRole('button', { name: approved ? '确认并启动' : '取消', exact: true }).click();
    return pending;
  }
  expect((await confirmation(false)).error).toContain('cancelled');
  expect((await page!.evaluate(() => window.codehelm.runner.getState())).activeSessions).toHaveLength(0);
  const old = await confirmation(true);
  profile = await page!.evaluate(input => window.codehelm.profiles.save({ ...input, services: input.services.map(s => ({ ...s, args: [...s.args, 'changed'] })) }), profile);
  await expect(page!.evaluate(({ id, token }) => window.codehelm.runner.start(id, token), { id: profile.id, token: old.token })).rejects.toThrow('confirmation required');
  expect((await page!.evaluate(() => window.codehelm.runner.getState())).activeSessions).toHaveLength(0);
  const token = (await confirmation(true)).token;
  const run = await page!.evaluate(({ id, token }) => window.codehelm.runner.start(id, token), { id: profile.id, token });
  await expect(page!.evaluate(id => window.codehelm.profiles.remove(id), profile.id)).rejects.toThrow('停止');
  const renamed = await page!.evaluate(input => window.codehelm.profiles.save({ ...input, name: '下次启动配置', services: input.services.map(s => ({ ...s, args: ['not-used.cjs'] })) }), profile);
  const state = await page!.evaluate(() => window.codehelm.runner.getState());
  expect(state.activeSessions[0].effectiveProfile?.name).toBe('完整开发');
  expect(state.activeSessions[0].effectiveProfile?.services[0].args).toEqual(profile.services[0].args);
  expect(state.activeSessions[0].services[0].pid).toBe(run.services[0].pid);
  await page!.evaluate(id => { location.hash = `/projects/${id}?tab=services`; }, profile.projectId);
  await expect(page!.getByText('本次会话配置快照：', { exact: false })).toBeVisible();
  await expect(page!.getByRole('button', { name: '删除方案', exact: true })).toBeDisabled();
  await page!.screenshot({ path: testInfo.outputPath('effective-profile.png'), animations: 'disabled' });
  const opened = app!.waitForEvent('window');
  const cancelled = page!.evaluate(id => window.codehelm.runner.restartService(id).then(() => '').catch(e => String(e)), run.services[0].id);
  const review = await opened;
  await expect(review.getByText('其他服务不会联动重启。', { exact: false })).toBeVisible();
  await review.getByRole('button', { name: '取消', exact: true }).click();
  expect(await cancelled).toContain('cancelled');
  expect((await page!.evaluate(() => window.codehelm.runner.getState())).activeSessions[0].services[0].pid).toBe(run.services[0].pid);
  await page!.evaluate(id => window.codehelm.runner.stopSession(id), run.id);
  await page!.evaluate(id => window.codehelm.profiles.remove(id), renamed.id);
  const history = (await page!.evaluate(() => window.codehelm.runner.getState())).history.find(item => item.id === run.id)!;
  expect(history.profileName).toBe('完整开发'); expect(history.services).toHaveLength(1);
  await page!.evaluate(id => { location.hash = `/projects/${id}?tab=history`; }, profile.projectId);
  await page!.getByRole('button', { name: '刷新记录', exact: true }).click();
  await expect(page!.getByText('完整开发 ·', { exact: false })).toBeVisible();
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
  const replacement = await restartWithReview(started.services[0].id);
  expect(replacement.status).toBe('RUNNING');
  await fs.unlink(script);
  await expect(restartWithReview(replacement.id)).rejects.toThrow('CODEHELM_ENVIRONMENT_PREFLIGHT');
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

// eslint-disable-next-line no-empty-pattern
test('rescans saved workspaces and explicitly applies analysis changes', async ({}, testInfo) => {
  const root = path.join(fixtureRoot, 'fixture-project');
  const project = await page!.evaluate(rootPath => window.codehelm.projects.import({ rootPath, name: 'V02 rescan', tags: [] }), root);
  const profilesBefore = await page!.evaluate(id => window.codehelm.profiles.list(id), project.id);
  const scan = async () => {
    const { taskId } = await page!.evaluate(rootPath => window.codehelm.projects.startScan({ rootPath, maxDepth: 2, remember: true }), root);
    await expect.poll(() => page!.evaluate(id => window.codehelm.projects.getTask(id), taskId).then(task => task?.status)).toBe('completed');
  };
  await scan();
  const manifest = path.join(root, 'package.json');
  const oldText = await fs.readFile(manifest, 'utf8');
  await fs.writeFile(manifest, oldText.replace('node service.cjs', 'node changed.cjs').replace('"start"', '"dev"'));
  await fs.writeFile(path.join(root, 'changed.cjs'), 'process.exit(0)');
  await scan();
  const saved = await page!.evaluate(() => window.codehelm.projects.workspaces());
  expect(saved[0].entries.find(item => item.relativePath === '.')).toMatchObject({ status: 'changed', changedFiles: ['package.json'] });
  await page!.getByRole('button', { name: '导入项目', exact: true }).click();
  await page!.getByRole('button', { name: '工作区批量导入', exact: true }).click();
  await page!.getByText('打开工作区复扫记录', { exact: true }).click();
  await page!.getByRole('combobox', { name: '保存的工作区', exact: true }).selectOption(root.replace(/\\/g, '/'));
  await expect(page!.getByText('分析可能过期：package.json', { exact: true })).toBeVisible();
  await page!.getByRole('button', { name: '保存设置并复扫', exact: true }).click();
  await expect(page!.getByText('工作区发现完成', { exact: false })).toBeVisible();
  await expect(page!.getByText('分析可能过期：package.json', { exact: true })).toBeVisible();
  await page!.getByText('分析可能过期：package.json', { exact: true }).scrollIntoViewIfNeeded();
  await page!.screenshot({ path: testInfo.outputPath('workspace-change.png'), animations: 'disabled' });
  await page!.getByRole('button', { name: '关闭', exact: true }).last().click();
  await page!.evaluate(id => { location.hash = `/projects/${id}?tab=config`; }, project.id);
  await page!.getByRole('button', { name: '重新分析', exact: true }).click();
  await expect.poll(() => page!.evaluate(id => window.codehelm.analysis.getTask(id), project.id).then(task => task?.status)).toBe('completed');
  await page!.getByRole('dialog').getByRole('button', { name: '关闭', exact: true }).click();
  expect(await page!.evaluate(id => window.codehelm.profiles.list(id), project.id)).toEqual(profilesBefore);
  await page!.getByRole('button', { name: '查看分析差异', exact: true }).click();
  await expect(page!.getByText('现在：', { exact: false })).toContainText('changed.cjs');
  await page!.screenshot({ path: testInfo.outputPath('analysis-change.png'), animations: 'disabled' });
  await page!.getByRole('button', { name: '确认应用分析建议', exact: true }).click();
  await expect.poll(() => page!.evaluate(id => window.codehelm.profiles.list(id), project.id).then(profiles => profiles.some(profile => profile.services.some(service => service.args.includes('dev'))))).toBe(true);
  const goodSnapshot = await page!.evaluate(id => window.codehelm.analysis.getLatest(id), project.id);
  await fs.writeFile(manifest, '{broken');
  await page!.evaluate(id => window.codehelm.analysis.start(id), project.id);
  await expect.poll(() => page!.evaluate(id => window.codehelm.analysis.getTask(id), project.id).then(task => task?.status)).toBe('failed');
  expect((await page!.evaluate(id => window.codehelm.analysis.getLatest(id), project.id))?.id).toBe(goodSnapshot?.id);
  expect((await page!.evaluate(() => window.codehelm.runner.getState())).activeSessions).toHaveLength(0);
});

test('retains workspace settings across restart and retries only failed imports', async () => {
  const root = path.join(fixtureRoot, '工作区 space');
  for (const name of ['good', 'broken', 'archive', 'ignored']) {
    await fs.mkdir(path.join(root, name), { recursive: true });
    await fs.writeFile(path.join(root, name, 'package.json'), name === 'broken' ? '{broken' : JSON.stringify({ name }));
  }
  const input = { rootPath: root, maxDepth: 2, remember: true, excludeDirs: ['archive'], ignoredPaths: ['ignored'] };
  const { taskId } = await page!.evaluate(input => window.codehelm.projects.startScan(input), input);
  await expect.poll(() => page!.evaluate(id => window.codehelm.projects.getTask(id), taskId).then(task => task?.status)).toBe('completed');
  const before = await page!.evaluate(() => window.codehelm.projects.workspaces());
  expect(before[0].excludeDirs).toEqual(['archive']);
  expect(before[0].issues).toContain('broken/package.json');
  await app!.close();
  app = undefined;
  const environment = { ...process.env };
  delete environment.ELECTRON_RUN_AS_NODE; delete environment.VITE_DEV_SERVER_URL;
  app = await electron.launch({ executablePath: electronExecutable, args: launchArgs, cwd: desktopRoot,
    env: { ...environment, CODEHELM_USER_DATA_DIR: path.join(fixtureRoot, 'user-data'), CODEHELM_VALIDATION_WINDOW: '0' } });
  page = await app.firstWindow(); await page.waitForLoadState('domcontentloaded');
  expect(await page.evaluate(() => window.codehelm.projects.workspaces())).toEqual(before);
  await page.getByRole('button', { name: '导入项目', exact: true }).click();
  await page.getByRole('button', { name: '工作区批量导入', exact: true }).click();
  await page.getByText('打开工作区复扫记录', { exact: true }).click();
  await page.getByRole('combobox', { name: '保存的工作区', exact: true }).selectOption(root.replace(/\\/g, '/'));
  await page.getByRole('button', { name: '保存设置并复扫', exact: true }).click();
  await expect(page.getByRole('button', { name: '导入未忽略的新项目（2）', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: '导入未忽略的新项目（2）', exact: true }).click();
  await expect(page.getByText('成功 1 · 已纳管跳过 0 · 失败 1', { exact: true })).toBeVisible();
  await fs.writeFile(path.join(root, 'broken', 'package.json'), '{"name":"fixed"}');
  await page.getByRole('button', { name: '仅重试失败项目', exact: true }).click();
  await expect(page.getByText('成功 1 · 已纳管跳过 0 · 失败 0', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.codehelm.projects.list())).toHaveLength(2);
  const rows = await page.evaluate(() => window.codehelm.projects.workspaces());
  expect(rows[0].entries.filter(entry => entry.relativePath !== 'ignored').every(entry => !!entry.projectId)).toBe(true);
  expect((await page.evaluate(() => window.codehelm.runner.getState())).activeSessions).toHaveLength(0);
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

// eslint-disable-next-line no-empty-pattern
test('opts into the native tray, preserves a running service and quits through its menu', async ({}, testInfo) => {
  await page!.evaluate(() => { location.hash = '/settings'; });
  const checkbox = page!.getByRole('checkbox', { name: '关闭到托盘' });
  await expect(checkbox).not.toBeChecked();
  await app!.evaluate(({ dialog, Tray }) => {
    dialog.showMessageBox = async () => ({ response: 0, checkboxChecked: false });
    const original = Tray.prototype.setContextMenu;
    Tray.prototype.setContextMenu = function(menu) {
      (globalThis as any).__e2eTray = this;
      (globalThis as any).__e2eTrayMenu = menu;
      return original.call(this, menu);
    };
  });
  await checkbox.check();
  await page!.getByRole('button', { name: '保存设置' }).click();
  await expect(checkbox).not.toBeChecked();
  expect((await page!.evaluate(() => window.codehelm.settings.get())).closeToTray).toBe(false);
  await app!.evaluate(({ dialog }) => {
    dialog.showMessageBox = async (...args: any[]) => {
      const options = args[args.length - 1];
      if (!('message' in options) || !options.message.includes('继续运行')) throw new Error('Missing tray consent');
      return { response: 1, checkboxChecked: false };
    };
  });
  await checkbox.check();
  await page!.getByRole('button', { name: '保存设置' }).click();
  await expect.poll(() => page!.evaluate(async () => (await window.codehelm.settings.get()).closeToTray)).toBe(true);
  await checkbox.scrollIntoViewIfNeeded();
  await page!.screenshot({ path: testInfo.outputPath('tray-settings-dark.png') });
  await page!.getByRole('button', { name: '明亮模式' }).click();
  await checkbox.scrollIntoViewIfNeeded();
  await page!.screenshot({ path: testInfo.outputPath('tray-settings-light.png') });
  const project = await page!.evaluate(rootPath => window.codehelm.projects.import({ rootPath, name: 'Tray lifecycle', tags: [] }), path.join(fixtureRoot, 'fixture-project'));
  const profile = await page!.evaluate(({ projectId, executable, script }) => window.codehelm.profiles.save({
    projectId, name: 'Tray service', isDefault: true, failurePolicy: 'block_dependents',
    services: [{ id: 'tray-service', runProfileId: '', name: 'Tray managed service', type: 'tool', moduleRelativePath: '.',
      executable, args: [script], cwdRelative: '.', env: [], healthCheck: { type: 'none' }, dependsOn: [], enabled: true,
      source: 'manual', startTimeoutMs: 5000, stopTimeoutMs: 5000 }],
  }), { projectId: project.id, executable: process.execPath, script: managedService });
  const reviewOpened = app!.waitForEvent('window');
  const pending = page!.evaluate(id => window.codehelm.runner.confirmExecution(id, 'start', 'light'), profile.id);
  const review = await reviewOpened;
  await review.getByRole('button', { name: '确认并启动' }).click();
  const token = await pending;
  const started = await page!.evaluate(({ id, token }) => window.codehelm.runner.start(id, token), { id: profile.id, token });
  const pid = started.services[0].pid!;
  expect(started.status).toBe('RUNNING');
  const windowId = await app!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].id);
  await page!.evaluate(() => {
    (window as any).__trayLogEvents = 0;
    (window as any).__trayUnsubscribe = window.codehelm.runner.onLogs(() => { (window as any).__trayLogEvents++; });
  });
  for (let cycle = 0; cycle < 3; cycle++) {
    await page!.evaluate(() => window.codehelm.window.close());
    expect(await app!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible())).toBe(false);
    expect((await page!.evaluate(() => window.codehelm.runner.getState())).activeSessions[0].id).toBe(started.id);
    await app!.evaluate(() => { (globalThis as any).__e2eTray.emit('click'); });
    expect(await app!.evaluate(({ BrowserWindow }) => ({ id: BrowserWindow.getAllWindows()[0].id, visible: BrowserWindow.getAllWindows()[0].isVisible() }))).toEqual({ id: windowId, visible: true });
  }
  await page!.evaluate(() => window.codehelm.window.close());
  const hiddenLogEvents = await page!.evaluate(() => (window as any).__trayLogEvents);
  await expect.poll(() => page!.evaluate(() => (window as any).__trayLogEvents)).toBeGreaterThan(hiddenLogEvents);
  await app!.evaluate(({ app }) => { app.emit('second-instance', {}, [], '', {}); });
  expect(await app!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible())).toBe(true);
  await app!.evaluate(() => { (globalThis as any).__e2eTrayMenu.items.find((item: any) => item.label === '查看运行状态').click(); });
  await expect(page!.getByRole('heading', { name: '全局运行中心' })).toBeVisible();
  await expect(page!.locator('span').filter({ hasText: /^Tray managed service$/ })).toBeVisible();
  const closed = app!.waitForEvent('close');
  await app!.evaluate(() => {
    setTimeout(() => {
      const quit = (globalThis as any).__e2eTrayMenu.items.find((item: any) => item.label === '退出 CodeHelm');
      quit.click(); quit.click();
    }, 50);
  });
  await closed; app = undefined; page = undefined;
  await expect.poll(() => { try { process.kill(pid, 0); return true; } catch { return false; } }).toBe(false);
  const environment = { ...process.env }; delete environment.ELECTRON_RUN_AS_NODE; delete environment.VITE_DEV_SERVER_URL;
  app = await electron.launch({ executablePath: electronExecutable, args: launchArgs, cwd: desktopRoot,
    env: { ...environment, CODEHELM_USER_DATA_DIR: path.join(fixtureRoot, 'user-data'), CODEHELM_VALIDATION_WINDOW: '0' } });
  page = await app.firstWindow(); await page.waitForLoadState('domcontentloaded');
  expect((await page.evaluate(() => window.codehelm.settings.get())).closeToTray).toBe(true);
  expect((await page.evaluate(() => window.codehelm.runner.getState())).activeSessions).toHaveLength(0);
  await page.evaluate(() => window.codehelm.window.close());
  expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible())).toBe(false);
  await page.evaluate(() => window.codehelm.settings.update({ closeToTray: false }));
  expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible())).toBe(true);
  const defaultClosed = app.waitForEvent('close');
  await app.evaluate(({ BrowserWindow }) => { setTimeout(() => BrowserWindow.getAllWindows()[0].close(), 50); });
  await defaultClosed; app = undefined; page = undefined;
});
