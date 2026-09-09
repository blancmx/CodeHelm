import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const root = process.cwd();
const executable = process.env.CODEHELM_E2E_EXECUTABLE || path.join(root, 'test-results/v02-006-package/win-unpacked/CodeHelm.exe');
const p95 = (values: number[]) => [...values].sort((a, b) => a - b)[Math.ceil(values.length * .95) - 1];
const fullLimit = process.env.CODEHELM_E2E_SCAN_LIMIT === '1';
function assertFixture(fixture: string) {
  if (path.dirname(fixture) !== path.resolve(os.tmpdir()) || !path.basename(fixture).startsWith('codehelm-scan-perf-')) throw new Error('Unsafe fixture path');
}
async function cleanup(fixture: string, denied: string, sid: string) {
  assertFixture(fixture);
  if (sid) execFileSync('icacls.exe', [denied, '/remove:d', `*${sid}`]);
  await fs.rm(fixture, { recursive: true, force: true });
}

// eslint-disable-next-line no-empty-pattern
test('measures actual scan cancellation and budget failures in isolated packaged Electron', async ({}, info) => {
  expect(process.platform).toBe('win32');
  const fixture = await fs.mkdtemp(path.join(os.tmpdir(), 'codehelm-scan-perf-'));
  const normal = path.join(fixture, '普通目录'), deep = path.join(fixture, '深层目录'), permission = path.join(fixture, '权限目录');
  const budget = path.join(fixture, '预算目录'), denied = path.join(permission, 'blocked.txt');
  let sid = '', app: ElectronApplication | undefined;
  const samples: { scenario: string; phase: string; cancelMs: number; scannedDirectories: number; status: string }[] = [];
  try {
    for (const dir of [normal, deep, permission, budget]) {
      await fs.mkdir(dir); await fs.writeFile(path.join(dir, 'package.json'), '{"name":"scan-fixture","private":true}');
    }
    for (let i = 0; i < 1200; i++) await fs.mkdir(path.join(normal, `dir-${i}`));
    for (let i = 0; i < 300; i++) await fs.mkdir(path.join(deep, `group-${i}`, '二层', '三层', '四层'), { recursive: true });
    for (let i = 0; i < 1000; i++) await fs.writeFile(path.join(budget, `file-${i}.txt`), 'budget');
    const limitRoot = path.join(fixture, '50000 files');
    if (fullLimit) {
      await fs.mkdir(limitRoot);
      await fs.writeFile(path.join(limitRoot, 'package.json'), '{"name":"limit-fixture","private":true}');
      for (let group = 0; group < 100; group++) {
        const dir = path.join(limitRoot, `group-${group}`); await fs.mkdir(dir);
        await Promise.all(Array.from({ length: group === 0 ? 499 : 500 }, (_, i) => fs.writeFile(path.join(dir, `${i}.txt`), 'limit')));
      }
    }
    await fs.writeFile(denied, 'permission fixture');
    assertFixture(fixture);
    sid = execFileSync('whoami.exe', ['/user', '/fo', 'csv', '/nh'], { encoding: 'utf8' }).match(/S-1-5-[\d-]+/)?.[0] ?? '';
    expect(sid).not.toBe('');
    execFileSync('icacls.exe', [denied, '/deny', `*${sid}:(RD)`]);
    await expect(fs.readFile(denied)).rejects.toMatchObject({ code: expect.stringMatching(/^(EACCES|EPERM)$/) });
    const env: Record<string, string> = Object.fromEntries(Object.entries({ ...process.env, CODEHELM_USER_DATA_DIR: path.join(fixture, 'user-data') }).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
    delete env.ELECTRON_RUN_AS_NODE; delete env.VITE_DEV_SERVER_URL;
    app = await electron.launch({ executablePath: executable, args: [], cwd: path.join(root, 'apps/desktop'), env });
    const page = await app.firstWindow();
    await expect(page.getByRole('heading', { name: '项目总览', exact: true })).toBeVisible();
    expect((await page.evaluate(() => window.codehelm.settings.get())).maxScanFiles).toBe(50000);
    const scenarios: [string, string, number][] = [['normal', normal, 2], ['deep', deep, 4], ['permission', permission, 2]];
    if (fullLimit) scenarios.push(['50000-files', limitRoot, 2], ['50000-preparation', limitRoot, 2]);
    for (const [scenario, directory, maxDepth] of scenarios) {
      for (let i = 0; i < 10; i++) {
        const sample = await page.evaluate(async ({ scenario, directory, maxDepth }) => {
          const task = await window.codehelm.projects.startScan({ rootPath: directory, maxDepth, remember: true });
          let state = await window.codehelm.projects.getTask(task.taskId);
          const deadline = performance.now() + 60000;
          // ACL failures happen during native boundary preparation, before scanner progress.
          const waitForProgress = scenario !== 'permission' && scenario !== '50000-preparation';
          if (waitForProgress) {
            while (state?.status === 'running' && state.scannedDirectories === 0 && performance.now() < deadline) {
              await new Promise(resolve => setTimeout(resolve, 2));
              state = await window.codehelm.projects.getTask(task.taskId);
            }
          }
          if (state?.status !== 'running') throw new Error(`Not cancellable: ${JSON.stringify(state)}`);
          if (waitForProgress && !state.scannedDirectories) throw new Error('Scanner did not start');
          const started = performance.now();
          const result = await window.codehelm.projects.cancelTask(task.taskId);
          const final = await window.codehelm.projects.getTask(task.taskId);
          if (!result.cancelled || final?.status !== 'cancelled') throw new Error(`Cancellation failed: ${JSON.stringify(final)}`);
          return { scenario, phase: state.scannedDirectories > 0 ? 'scanning' : 'boundary-preparation', cancelMs: performance.now() - started, scannedDirectories: state.scannedDirectories, status: final.status };
        }, { scenario, directory, maxDepth });
        samples.push(sample);
        await fs.writeFile(info.outputPath('cancel-samples.json'), JSON.stringify(samples, null, 2));
      }
    }
    expect(await page.evaluate(() => window.codehelm.projects.workspaces())).toEqual([]);
    async function completeScan(page: Page, directory: string) {
      const task = await page.evaluate(rootPath => window.codehelm.projects.startScan({ rootPath, maxDepth: 2, remember: true }), directory);
      await expect.poll(async () => (await page.evaluate(id => window.codehelm.projects.getTask(id), task.taskId))?.status).toMatch(/^(completed|failed)$/);
      return page.evaluate(id => window.codehelm.projects.getTask(id), task.taskId);
    }
    const permissionFailure = await completeScan(page, permission);
    expect(permissionFailure?.status).toBe('failed');
    expect(permissionFailure?.errorMessage).toMatch(/lock|denied|拒绝/i);
    const success = await completeScan(page, budget);
    expect(success?.status).toBe('completed');
    const saved = await page.evaluate(() => window.codehelm.projects.workspaces());
    expect(saved).toHaveLength(1);
    await page.evaluate(() => window.codehelm.settings.update({ maxScanFiles: 1000 }));
    const budgetFailure = await completeScan(page, budget);
    expect(budgetFailure?.status).toBe('failed');
    expect(budgetFailure?.errorMessage).toMatch(/limit|超限/i);
    expect(await page.evaluate(() => window.codehelm.projects.workspaces())).toEqual(saved);
    for (const value of [999, 50001]) expect(await page.evaluate(value => window.codehelm.settings.update({ maxScanFiles: value }).then(() => false, () => true), value)).toBe(true);
    await page.evaluate(() => window.codehelm.settings.update({ maxScanFiles: 50000 }));
    expect((await completeScan(page, normal))?.status).toBe('completed');
    let fullLimitEvidence;
    if (fullLimit) {
      const atLimit = await completeScan(page, limitRoot);
      expect(atLimit?.status).toBe('completed');
      const baseline = await page.evaluate(() => window.codehelm.projects.workspaces());
      await fs.writeFile(path.join(limitRoot, 'over-limit.txt'), 'one more');
      const overLimit = await completeScan(page, limitRoot);
      expect(overLimit?.status).toBe('failed');
      expect(overLimit?.errorMessage).toMatch(/file count exceeds security lock limit/);
      expect(await page.evaluate(() => window.codehelm.projects.workspaces())).toEqual(baseline);
      fullLimitEvidence = { filesAtLimit: 50000, filesOverLimit: 50001, atLimit, overLimit, baselinePreserved: true };
    }
    const summaries = scenarios.map(([scenario]) => {
      const times = samples.filter(s => s.scenario === scenario).map(s => s.cancelMs);
      return { scenario, count: times.length, p95Ms: p95(times), maxMs: Math.max(...times) };
    });
    await fs.writeFile(info.outputPath('scan-performance.json'), JSON.stringify({
      executable, executableSha256: createHash('sha256').update(await fs.readFile(executable)).digest('hex'),
      os: os.release(), cpu: os.cpus()[0].model, samples, summaries,
      fixture: { normalDirectories: 1201, deepDirectories: 1201, budgetFiles: 1001, realAclReadDenied: true },
      permissionFailure, budgetFailure, fullLimitEvidence, historyPreservedAfterBudgetFailure: true,
      limitations: ['Cancellation measured from renderer IPC invocation to confirmed terminal state; excludes click dispatch.', 'Permission cancellations occur during native boundary preparation.', ...(fullLimit ? [] : ['Tests use 1001 files under the default 50000 budget, not a full 50000-file stress run.']), 'Existing local candidate binary; no cold-start or installation claim.'],
    }, null, 2));
    for (const sample of samples) expect(sample.cancelMs).toBeLessThanOrEqual(2000);
  } finally {
    await app?.close(); await cleanup(fixture, denied, sid);
  }
});
