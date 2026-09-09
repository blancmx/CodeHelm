import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';

const root = process.cwd();
const median = (values: number[]) => { const sorted = [...values].sort((a, b) => a - b); return (sorted[4] + sorted[5]) / 2; };
async function cleanup(fixture: string) {
  if (path.dirname(fixture) !== path.resolve(os.tmpdir()) || !path.basename(fixture).startsWith('codehelm-startup-')) throw new Error('Unsafe cleanup');
  await fs.rm(fixture, { recursive: true, force: true });
}

// eslint-disable-next-line no-empty-pattern
test('compares ten interleaved warm starts against extracted v0.1 installer', async ({}, info) => {
  const fixture = await fs.mkdtemp(path.join(os.tmpdir(), 'codehelm-startup-'));
  const cases = [
    { name: 'v010', executable: path.join(root, 'test-results/v02-006-v010-baseline/CodeHelm.exe'), userData: path.join(fixture, 'v010'), samplesMs: [] as number[] },
    { name: 'candidate', executable: process.env.CODEHELM_E2E_EXECUTABLE || path.join(root, 'test-results/v02-006-cancel-package/win-unpacked/CodeHelm.exe'), userData: path.join(fixture, 'candidate'), samplesMs: [] as number[] },
  ];
  try {
    const requireDesktop = createRequire(path.join(root, 'apps/desktop/package.json'));
    const DB = requireDesktop('better-sqlite3');
    await fs.mkdir(cases[0].userData); await fs.mkdir(cases[1].userData);
    const database = new DB(path.join(cases[0].userData, 'codehelm.sqlite'));
    database.exec(await fs.readFile(path.join(root, 'e2e/fixtures/v010-schema.sql'), 'utf8'));
    const insert = database.prepare('INSERT INTO projects(id,name,root_path,created_at,updated_at) VALUES (?,?,?,?,?)');
    database.transaction(() => { for (let i = 0; i < 1000; i++) insert.run(crypto.randomUUID(), `Startup-${i}`, path.join(fixture, `project-${i}`), '2026-09-01', '2026-09-01'); })();
    database.close();
    await fs.copyFile(path.join(cases[0].userData, 'codehelm.sqlite'), path.join(cases[1].userData, 'codehelm.sqlite'));
    async function launch(item: typeof cases[number]) {
      const env: Record<string, string> = Object.fromEntries(Object.entries({ ...process.env, CODEHELM_USER_DATA_DIR: item.userData }).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
      delete env.ELECTRON_RUN_AS_NODE; delete env.VITE_DEV_SERVER_URL;
      const started = performance.now();
      const app = await electron.launch({ executablePath: item.executable, args: [], cwd: path.join(root, 'apps/desktop'), env });
      try {
        const page = await app.firstWindow();
        await expect(page.getByRole('heading', { name: '项目总览', exact: true })).toBeVisible();
        expect(await page.evaluate(async () => (await window.codehelm.projects.list()).length)).toBe(1000);
        return performance.now() - started;
      } finally { await app.close(); }
    }
    for (const item of cases) await launch(item);
    for (let i = 0; i < 10; i++) for (const item of i % 2 ? [...cases].reverse() : cases) item.samplesMs.push(await launch(item));
    const hash = async (file: string) => createHash('sha256').update(await fs.readFile(file)).digest('hex');
    const result = {
      environment: { os: os.release(), cpu: os.cpus()[0].model, memoryBytes: os.totalmem() },
      projects: 1000, mode: 'warm-process-restart',
      baselineInstallerSha256: await hash(path.join(root, 'dist-release/CodeHelm Setup 0.1.0.exe')),
      cases: await Promise.all(cases.map(async item => ({ ...item, medianMs: median(item.samplesMs), asarSha256: await hash(path.join(path.dirname(item.executable), 'resources/app.asar')) }))),
      ratio: median(cases[1].samplesMs) / median(cases[0].samplesMs),
      limitations: ['Warmup excludes initial migration.', 'Alternating binaries and pair order; caches not cleared.', 'Cold-start comparison requires a controlled isolated OS.', 'Baseline extracted from existing installer; extraction is not installation validation.'],
    };
    await fs.writeFile(info.outputPath('startup.json'), JSON.stringify(result, null, 2));
    expect(result.ratio).toBeLessThanOrEqual(1.2);
  } finally { await cleanup(fixture); }
});
