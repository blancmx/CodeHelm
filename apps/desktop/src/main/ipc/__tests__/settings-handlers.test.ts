import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { Worker } from 'node:worker_threads';
import { createDatabase, AnalysisRepository } from '@codehelm/database';
import { IpcChannels } from '@codehelm/contracts';
import { registerSettingsHandlers } from '../settings-handlers.js';
import { registerProjectHandlers } from '../project-handlers.js';
import { registerAnalysisHandlers } from '../analysis-handlers.js';
import { getAppSettings } from '../app-settings.js';
import { LogStorage } from '../log-storage.js';
import { getAnalysisTasks } from '../analysis-service.js';
import type { AnalysisTasks } from '../analysis-tasks.js';
import { getProjectTasks } from '../project-task-service.js';
import { createTrustedIpcRegistrar, type TrustedIpcContext } from '../trusted-ipc.js';

const harness = vi.hoisted(() => ({
  handlers: new Map<string, (...args: any[]) => any>(), openPath: vi.fn(async () => ''),
}));
vi.mock('electron', () => ({
  ipcMain: { handle: (channel: string, fn: (...args: any[]) => any) => harness.handlers.set(channel, fn) },
  dialog: {}, shell: { openPath: harness.openPath }, BrowserWindow: { getAllWindows: () => [] },
}));
let event: any;
let context: TrustedIpcContext;
const handle = createTrustedIpcRegistrar(() => context);
const invoke = async (channel: string, ...args: unknown[]) => harness.handlers.get(channel)!(event, ...args);

describe('persisted settings and desktop execution integration', () => {
  let root: string;
  let db: ReturnType<typeof createDatabase>;
  let logs: LogStorage;
  let tasks: AnalysisTasks;

  beforeEach(async () => {
    const frame = { url: 'http://localhost:15173/#/settings', detached: false };
    const sender = { mainFrame: frame, getURL: () => frame.url, isDestroyed: () => false, send: vi.fn(), once: vi.fn() };
    event = { sender, senderFrame: frame };
    context = { window: { webContents: sender, isDestroyed: () => false } as any, renderer: { kind: 'dev', origin: 'http://localhost:15173' } };
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'codehelm-settings-'));
    db = createDatabase(path.join(root, 'settings.sqlite'));
    logs = new LogStorage(path.join(root, 'logs'), () => getAppSettings(db));
    tasks = getAnalysisTasks(db, (rootPath, maxFiles) => new Worker(path.resolve('packages/analyzer/dist/analysis-worker.js'), { workerData: { rootPath, maxFiles } }));
    registerSettingsHandlers(handle, db, logs);
    registerProjectHandlers(handle, db);
    registerAnalysisHandlers(handle, db);
  });

  it('rejects foreign callers across the registered project, analysis, and settings entry points', async () => {
    const original = getAppSettings(db);
    event = { ...event, sender: { ...event.sender } };
    for (const channel of harness.handlers.keys()) {
      await expect(invoke(channel, { maxScanFiles: 1200 })).rejects.toThrow('IPC 来源校验失败');
    }
    expect(getAppSettings(db)).toEqual(original);
    expect(harness.openPath).not.toHaveBeenCalled();
    expect(db.prepare('SELECT count(*) AS count FROM projects').get()).toEqual({ count: 0 });
  });
  afterEach(async () => {
    await getProjectTasks(db, tasks).close();
    await tasks.close();
    await logs.close();
    db.close();
    vi.restoreAllMocks();
    if (path.dirname(root) !== path.resolve(os.tmpdir()) || !path.basename(root).startsWith('codehelm-settings-')) throw new Error('Unsafe fixture cleanup');
    await fs.rm(root, { recursive: true, force: true });
  });

  it('rejects invalid patches without saving and preserves settings across reopening SQLite', async () => {
    await invoke(IpcChannels.SETTINGS_UPDATE, { maxScanFiles: 1200, maxLogRetentionDays: 7, maxLogRetentionMb: 80 });
    await expect(invoke(IpcChannels.SETTINGS_UPDATE, { maxScanFiles: 500001 })).rejects.toThrow();
    db.close();
    db = createDatabase(path.join(root, 'settings.sqlite'));
    registerSettingsHandlers(handle, db, logs);
    expect(await invoke(IpcChannels.SETTINGS_GET)).toMatchObject({ maxScanFiles: 1200, maxLogRetentionDays: 7, maxLogRetentionMb: 80 });
    db.close();
    await expect(invoke(IpcChannels.SETTINGS_UPDATE, { maxScanFiles: 1500 })).rejects.toThrow();
    db = createDatabase(path.join(root, 'settings.sqlite'));
    expect(getAppSettings(db).maxScanFiles).toBe(1200);
  });

  it('normalizes the old unsupported scan limit but reports corrupted settings', () => {
    db.prepare("INSERT INTO app_settings (key, value) VALUES ('global', ?)").run(JSON.stringify({ maxScanFiles: 500000 }));
    expect(getAppSettings(db).maxScanFiles).toBe(50000);
    db.prepare("UPDATE app_settings SET value = 'broken' WHERE key = 'global'").run();
    expect(() => getAppSettings(db)).toThrow();
  });

  it('creates the log directory before opening and does not open a failed storage path', async () => {
    harness.openPath.mockClear();
    await invoke(IpcChannels.SETTINGS_OPEN_LOG_DIRECTORY);
    expect((await fs.stat(logs.directory)).isDirectory()).toBe(true);
    expect(harness.openPath).toHaveBeenCalledWith(logs.directory);
    await fs.rmdir(logs.directory);
    await fs.writeFile(logs.directory, 'not a directory');
    harness.openPath.mockClear();
    await expect(invoke(IpcChannels.SETTINGS_OPEN_LOG_DIRECTORY)).rejects.toThrow();
    expect(harness.openPath).not.toHaveBeenCalled();
  });

  it('uses new limits for import and reanalysis and preserves the last successful snapshot', async () => {
    const projectRoot = path.join(root, 'project');
    await fs.mkdir(projectRoot);
    for (let i = 0; i < 1001; i++) await fs.writeFile(path.join(projectRoot, `${i}.ts`), '// fixture');
    await invoke(IpcChannels.SETTINGS_UPDATE, { maxScanFiles: 1000 });
    const imported = await invoke(IpcChannels.PROJECTS_START_IMPORT, { projects: [{ rootPath: projectRoot }] });
    const result = await getProjectTasks(db, tasks).wait(imported.taskId);
    expect(result.status).toBe('failed');
    const project = result.results[0].project!;
    const snapshots = new AnalysisRepository(db);
    expect(snapshots.findLatestByProjectId(project.id)).toBeNull();
    expect(tasks.get(project.id)).toMatchObject({ status: 'failed', scannedFiles: 1000 });
    await invoke(IpcChannels.SETTINGS_UPDATE, { maxScanFiles: 1100 });
    const first = await invoke(IpcChannels.ANALYSIS_START, project.id);
    expect((await tasks.wait(first.taskId)).status).toBe('completed');
    expect(snapshots.findLatestByProjectId(project.id)!.languages[0].fileCount).toBe(1001);
    const previous = snapshots.findLatestByProjectId(project.id)!;
    await invoke(IpcChannels.SETTINGS_UPDATE, { maxScanFiles: 1000 });
    const second = await invoke(IpcChannels.ANALYSIS_START, project.id);
    expect((await tasks.wait(second.taskId)).errorMessage).toContain('超过上限 1000');
    expect(snapshots.findLatestByProjectId(project.id)!.id).toBe(previous.id);
    const changedRoot = path.join(root, 'removed-project');
    await fs.rename(projectRoot, changedRoot);
    const third = await invoke(IpcChannels.ANALYSIS_START, project.id);
    expect((await tasks.wait(third.taskId)).status).toBe('failed');
    expect(snapshots.findLatestByProjectId(project.id)!.id).toBe(previous.id);
  }, 20000);

  it('rolls back profile refresh when snapshot persistence fails', async () => {
    const projectRoot = path.join(root, 'transaction-project');
    await fs.mkdir(projectRoot);
    await fs.writeFile(path.join(projectRoot, 'package.json'), JSON.stringify({ name: 'fixture', scripts: { start: 'node index.js' } }));
    await fs.writeFile(path.join(projectRoot, 'index.js'), '// never executed');
    const project = await invoke(IpcChannels.PROJECTS_IMPORT, { rootPath: projectRoot });
    const previous = new AnalysisRepository(db).findLatestByProjectId(project.id)!;
    const profilesBefore = db.prepare('SELECT * FROM run_profiles').all();
    const servicesBefore = db.prepare('SELECT * FROM service_configs').all();
    expect(profilesBefore.length).toBeGreaterThan(0);
    db.exec("CREATE TRIGGER reject_snapshot BEFORE INSERT ON analysis_snapshots BEGIN SELECT RAISE(ABORT, 'snapshot storage failed'); END");
    const { taskId } = await invoke(IpcChannels.ANALYSIS_START, project.id);
    expect(await tasks.wait(taskId)).toMatchObject({ status: 'failed', errorMessage: expect.stringContaining('snapshot storage failed') });
    expect(new AnalysisRepository(db).findLatestByProjectId(project.id)!.id).toBe(previous.id);
    expect(db.prepare('SELECT * FROM run_profiles').all()).toEqual(profilesBefore);
    expect(db.prepare('SELECT * FROM service_configs').all()).toEqual(servicesBefore);
  });

  it('uses the saved retention policy, counts real removals, and reports cleanup/open failures', async () => {
    const projectDir = path.join(logs.directory, 'project');
    await fs.mkdir(projectDir, { recursive: true });
    const oldFile = path.join(projectDir, 'web-old.log');
    await fs.writeFile(oldFile, 'history');
    const oldDate = new Date(Date.now() - 3 * 86400000);
    await fs.utimes(oldFile, oldDate, oldDate);
    await logs.maintain();
    expect((await invoke(IpcChannels.SETTINGS_LOG_STATUS)).fileCount).toBe(1);
    await invoke(IpcChannels.SETTINGS_UPDATE, { maxLogRetentionDays: 1 });
    await logs.maintain();
    expect((await invoke(IpcChannels.SETTINGS_LOG_STATUS)).fileCount).toBe(0);

    const oversized = await fs.open(oldFile, 'w');
    await oversized.truncate(51 * 1048576);
    await oversized.close();
    await logs.maintain();
    expect((await logs.getStatus()).fileCount).toBe(1);
    await invoke(IpcChannels.SETTINGS_UPDATE, { maxLogRetentionMb: 50 });
    await logs.maintain();
    expect((await logs.getStatus()).fileCount).toBe(0);

    await fs.writeFile(oldFile, '12345');
    const unlink = vi.spyOn(fs, 'unlink').mockRejectedValueOnce(Object.assign(new Error('locked'), { code: 'EBUSY' }));
    await expect(invoke(IpcChannels.SETTINGS_CLEAR_LOGS)).rejects.toThrow(/EBUSY/);
    expect((await invoke(IpcChannels.SETTINGS_LOG_STATUS)).lastError).toContain('EBUSY');
    unlink.mockRestore();
    expect(await invoke(IpcChannels.SETTINGS_CLEAR_LOGS)).toEqual({ deletedCount: 1, freedBytes: 5 });
    expect(await invoke(IpcChannels.SETTINGS_CLEAR_LOGS)).toEqual({ deletedCount: 0, freedBytes: 0 });
    harness.openPath.mockResolvedValueOnce('blocked');
    await expect(invoke(IpcChannels.SETTINGS_OPEN_LOG_DIRECTORY)).rejects.toThrow('blocked');
  });
});
