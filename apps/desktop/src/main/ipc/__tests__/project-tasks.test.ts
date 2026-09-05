import { ipcMain } from 'electron';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Worker } from 'node:worker_threads';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { AnalysisRepository, createDatabase, ProjectRepository } from '@codehelm/database';
import { getAnalysisTasks } from '../analysis-service.js';
import { getProjectTasks } from '../project-task-service.js';
import { ProjectTasks } from '../project-tasks.js';
import { registerProjectHandlers } from '../project-handlers.js';
import { IpcChannels } from '@codehelm/contracts';

const harness = vi.hoisted(() => ({ handlers: new Map<string, (...args: any[]) => any>() }));
vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: () => [] }, dialog: {},
  ipcMain: { handle: (channel: string, handler: (...args: any[]) => any) => harness.handlers.set(channel, handler) },
}));
const invoke = (channel: string, ...args: unknown[]) => harness.handlers.get(channel)!({ sender: { once: vi.fn() } }, ...args);

describe('workspace discovery and import task integration', () => {
  let root: string;
  let db: ReturnType<typeof createDatabase>;
  let analysis: ReturnType<typeof getAnalysisTasks>;
  let jobs: ProjectTasks;
  let analysisCode: string | undefined;
  let workspaceCode: string | undefined;
  let workers: Worker[];

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'codehelm-project-tasks-'));
    db = createDatabase(path.join(root, 'data.sqlite'));
    analysisCode = undefined; workspaceCode = undefined; workers = [];
    analysis = getAnalysisTasks(db, (rootPath, maxFiles) => {
      const worker = analysisCode ? new Worker(analysisCode, { eval: true })
        : new Worker(path.resolve('packages/analyzer/dist/analysis-worker.js'), { workerData: { rootPath, maxFiles } });
      workers.push(worker); return worker;
    });
    jobs = getProjectTasks(db, analysis, (input) => {
      const worker = workspaceCode ? new Worker(workspaceCode, { eval: true })
        : new Worker(path.resolve('packages/analyzer/dist/workspace-worker.js'), { workerData: input });
      workers.push(worker); return worker;
    });
    registerProjectHandlers(ipcMain.handle, db, analysis);
  });

  afterEach(async () => {
    await jobs.close(); await analysis.close(); db.close();
    expect(workers.every((worker) => worker.threadId === -1)).toBe(true);
    if (path.dirname(root) !== path.resolve(os.tmpdir()) || !path.basename(root).startsWith('codehelm-project-tasks-')) throw new Error('Unsafe fixture cleanup');
    // Windows may briefly retain directory entries after SQLite/Worker handles
    // close. Retry only cleanup; exhausted retries still fail the test.
    await fs.rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  });

  async function project(name: string) {
    const directory = path.join(root, name);
    await fs.mkdir(directory);
    await fs.writeFile(path.join(directory, 'package.json'), JSON.stringify({ name, scripts: { start: 'node index.js' } }));
    await fs.writeFile(path.join(directory, 'index.js'), '// static fixture; never executed');
    return directory;
  }

  it('discovers real workspace projects off-thread and reports actual directory counts', async () => {
    const first = await project('first'); const second = await project('second');
    const before = await fs.readdir(first);
    const started = invoke(IpcChannels.PROJECTS_START_SCAN, { rootPath: root, maxDepth: 1 });
    expect(invoke(IpcChannels.PROJECTS_GET_TASK, started.taskId).status).toBe('running');
    const result = await jobs.wait(started.taskId);
    expect(result.status).toBe('completed');
    expect(result.discovered.map((item) => item.rootPath.replace(/\\/g, '/')).sort()).toEqual([first, second].map((value) => value.replace(/\\/g, '/')).sort());
    expect(result.scannedDirectories).toBe(3);
    expect(result.foundProjects).toBe(2);
    expect(await fs.readdir(first)).toEqual(before);
    expect(new ProjectRepository(db).list()).toHaveLength(0);
  });

  it('deduplicates requests, reserves scanner capacity, and cancels a busy workspace worker', async () => {
    workspaceCode = 'while(true){}';
    const first = jobs.startScan({ rootPath: root, maxDepth: 1 });
    expect(jobs.startScan({ rootPath: root, maxDepth: 1 })).toEqual(first);
    expect(() => jobs.startImport({ projects: [{ rootPath: root }] })).toThrow('已有');
    expect(() => analysis.start('other', root, 1000)).toThrow('导入任务');
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(await jobs.cancel(first.taskId)).toEqual({ cancelled: true });
    expect(workers).toHaveLength(1);
    expect(workers[0].threadId).toBe(-1);
    expect((await jobs.wait(first.taskId)).status).toBe('cancelled');
    workspaceCode = undefined;
    expect((await jobs.wait(jobs.startScan({ rootPath: root, maxDepth: 0 }).taskId)).status).toBe('completed');
  });

  it('rejects invalid inputs and reports workspace failures without returning an empty success', async () => {
    expect(() => jobs.startScan({ rootPath: root, maxDepth: 5 })).toThrow();
    expect(() => jobs.startImport({ projects: [] })).toThrow('至少');
    expect(() => jobs.startImport({ projects: Array.from({ length: 101 }, () => ({ rootPath: root })) })).toThrow();
    const result = await jobs.wait(jobs.startScan({ rootPath: path.join(root, 'missing') }).taskId);
    expect(result.status).toBe('failed');
    workspaceCode = 'throw new Error("worker crashed")';
    expect((await jobs.wait(jobs.startScan({ rootPath: root }).taskId)).errorMessage).toContain('worker crashed');
    workspaceCode = 'process.exit(0)';
    expect((await jobs.wait(jobs.startScan({ rootPath: root }).taskId)).status).toBe('failed');
  });

  it('imports unique projects, preserves existing profiles, and reports partial failures per item', async () => {
    const first = await project('first'); const second = await project('second');
    const result = await jobs.wait(jobs.startImport({ projects: [{ rootPath: first }, { rootPath: first }, { rootPath: path.join(root, 'missing') }, { rootPath: second }] }).taskId);
    expect(result.status).toBe('partial');
    expect(result.totalCount).toBe(3);
    expect(result.results.map((item) => item.status)).toEqual(['completed', 'failed', 'completed']);
    expect(new ProjectRepository(db).list()).toHaveLength(2);
    const profiles = db.prepare('SELECT * FROM run_profiles').all();
    const existing = await jobs.wait(jobs.startImport({ projects: [{ rootPath: first, name: 'must not rename' }] }).taskId);
    expect(existing.results[0]).toMatchObject({ status: 'existing', name: 'first' });
    expect(db.prepare('SELECT * FROM run_profiles').all()).toEqual(profiles);
    await expect(invoke(IpcChannels.PROJECTS_IMPORT, { rootPath: path.join(root, 'missing') })).rejects.toThrow();
  });

  it('cancels current analysis, retains its project record, and never starts later imports', async () => {
    analysisCode = 'while(true){}';
    const first = await project('first'); const second = await project('second');
    const { taskId } = jobs.startImport({ projects: [{ rootPath: first }, { rootPath: second }] });
    await vi.waitFor(() => expect(workers).toHaveLength(1));
    expect(await jobs.cancel(taskId)).toEqual({ cancelled: true });
    const result = await jobs.wait(taskId);
    expect(result.status).toBe('cancelled');
    expect(result.results).toHaveLength(1);
    expect(result.results[0].status).toBe('cancelled');
    const projects = new ProjectRepository(db).list();
    expect(projects).toHaveLength(1);
    expect(new AnalysisRepository(db).findLatestByProjectId(projects[0].id)).toBeNull();
    expect(workers[0].threadId).toBe(-1);
    analysisCode = undefined;
    expect((await jobs.wait(jobs.startImport({ projects: [{ rootPath: first }] }).taskId)).results[0].status).toBe('completed');
  });

  it('retains completed projects when cancelling a later item and stops all further imports on close', async () => {
    const first = await project('first'); const second = await project('second'); const third = await project('third');
    const unsubscribe = analysis.subscribe((state) => { if (state.status === 'completed') analysisCode = 'while(true){}'; });
    const { taskId } = jobs.startImport({ projects: [{ rootPath: first }, { rootPath: second }, { rootPath: third }] });
    await vi.waitFor(() => expect(workers).toHaveLength(2));
    await jobs.close();
    unsubscribe();
    const result = await jobs.wait(taskId);
    expect(result.status).toBe('cancelled');
    expect(result.results.map((item) => item.status)).toEqual(['completed', 'cancelled']);
    expect(new ProjectRepository(db).list()).toHaveLength(2);
    expect(new AnalysisRepository(db).findLatestByProjectId(result.results[0].project!.id)?.status).toBe('completed');
    expect(() => jobs.startImport({ projects: [{ rootPath: third }] })).toThrow('关闭');
  });

  it('stops a planned import before a project is removed and cleans up on renderer close', async () => {
    const first = await project('first'); const second = await project('second');
    const existing = await jobs.wait(jobs.startImport({ projects: [{ rootPath: second }] }).taskId);
    analysisCode = 'while(true){}';
    const { taskId } = jobs.startImport({ projects: [{ rootPath: first }, { rootPath: second }] });
    await vi.waitFor(() => expect(workers).toHaveLength(2));
    await invoke(IpcChannels.PROJECTS_REMOVE, existing.results[0].project!.id);
    expect((await jobs.wait(taskId)).status).toBe('cancelled');
    expect(new ProjectRepository(db).list().map((item) => item.name)).toEqual(['first']);
    workspaceCode = 'while(true){}';
    const destroyed = vi.fn();
    harness.handlers.get(IpcChannels.PROJECTS_START_SCAN)!({ sender: { once: destroyed } }, { rootPath: root });
    const callback = destroyed.mock.calls[0][1];
    callback();
    await jobs.stopActive();
    expect(workers.every((worker) => worker.threadId === -1)).toBe(true);
  });

  it('times out a stuck workspace worker and releases the scanner reservation', async () => {
    await jobs.close();
    jobs = new ProjectTasks(analysis, async () => { throw new Error('unused'); }, () => 1000, () => {}, () => {
      const worker = new Worker('while(true){}', { eval: true }); workers.push(worker); return worker;
    }, 100);
    const result = await jobs.wait(jobs.startScan({ rootPath: root }).taskId);
    expect(result).toMatchObject({ status: 'failed', errorMessage: expect.stringContaining('超时') });
    expect(workers[0].threadId).toBe(-1);
    expect(() => analysis.reserve('available')).not.toThrow();
    analysis.release('available');
  });

  it('releases the native boundary when workspace Worker construction throws', async () => {
    await jobs.close();
    const close = vi.fn();
    jobs = new ProjectTasks(analysis, async () => { throw new Error('unused'); }, () => 1000, () => {},
      () => { throw new Error('worker construction failed'); }, 1000,
      () => ({ ready: Promise.resolve('test'), close: async () => { close(); } }));
    const result = await jobs.wait(jobs.startScan({ rootPath: root }).taskId);
    expect(result).toMatchObject({ status: 'failed', errorMessage: 'worker construction failed' });
    expect(close).toHaveBeenCalledOnce();
    expect(() => analysis.reserve('available')).not.toThrow();
    analysis.release('available');
  });
});
