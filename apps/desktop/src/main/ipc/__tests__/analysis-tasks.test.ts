import { afterEach, describe, expect, it, vi } from 'vitest';
import { Worker } from 'node:worker_threads';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { AnalysisTasks, createAnalysisBoundaryFromWorker } from '../analysis-tasks.js';

const snapshot = { status: 'completed', modules: [], languages: [], primaryLanguage: 'Unknown' };
const resultCode = `require('node:worker_threads').parentPort.postMessage({type:'result',snapshot:${JSON.stringify(snapshot)}})`;
const managers: AnalysisTasks[] = [];
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(managers.splice(0).map((manager) => manager.close()));
  for (const root of roots.splice(0)) {
    if (path.dirname(root) !== path.resolve(os.tmpdir()) || !path.basename(root).startsWith('codehelm-worker-')) throw new Error('Unsafe fixture cleanup');
    await fs.rm(root, { recursive: true, force: true });
  }
});

function create(code: string, persist = vi.fn(async () => {}), timeout = 5000, persistenceTimeout = 30000) {
  const workers: Worker[] = [];
  const publish = vi.fn();
  const manager = new AnalysisTasks(persist, publish, () => {
    const worker = new Worker(code, { eval: true });
    workers.push(worker);
    return worker;
  }, timeout, undefined, persistenceTimeout);
  managers.push(manager);
  return { manager, persist, publish, workers };
}

function createTestNativeBoundary(rootPath: string, maxEntries: number) {
  const modulePath = path.resolve('packages/safe-fs/index.js');
  const worker = new Worker(`
    const { parentPort, workerData } = require('node:worker_threads');
    const { openRoot, closeRoot } = require(workerData.modulePath);
    let sessionId;
    try {
      sessionId = openRoot(workerData.rootPath, workerData.maxEntries);
      parentPort.postMessage({ type: 'ready', sessionId });
    } catch (error) {
      parentPort.postMessage({ type: 'error', errorMessage: error.message });
      parentPort.close();
    }
    parentPort.on('message', (message) => {
      if (message.type !== 'close' || !sessionId) return;
      try {
        closeRoot(sessionId);
        sessionId = undefined;
        parentPort.postMessage({ type: 'closed' });
      } catch (error) {
        parentPort.postMessage({ type: 'close-error', errorMessage: error.message });
      } finally {
        parentPort.close();
      }
    });
  `, { eval: true, workerData: { modulePath, rootPath, maxEntries } });
  return createAnalysisBoundaryFromWorker(worker);
}

describe('analysis Worker task lifecycle', () => {
  it('returns before CPU work completes, keeps host timers responsive, and saves before completion', async () => {
    const { manager, persist, publish, workers } = create(`const until=Date.now()+400;while(Date.now()<until){};${resultCode}`);
    const task = manager.start('project', '.', 1000);
    expect(manager.get('project')?.status).toBe('running');
    let ticks = 0;
    const timer = setInterval(() => { ticks++; }, 10);
    const result = await manager.wait(task.taskId);
    clearInterval(timer);
    expect(ticks).toBeGreaterThan(5);
    expect(result.status).toBe('completed');
    expect(persist).toHaveBeenCalledOnce();
    expect(publish.mock.calls.at(-1)?.[0]).toMatchObject({ status: 'completed', percentage: 100 });
    expect(workers[0].threadId).toBe(-1);
  });

  it('returns a task id and keeps host timers responsive while an asynchronous boundary is prepared', async () => {
    let resolveBoundary!: (sessionId: string) => void;
    const ready = new Promise<string>((resolve) => { resolveBoundary = resolve; });
    const createWorker = vi.fn(() => new Worker(resultCode, { eval: true }));
    const manager = new AnalysisTasks(vi.fn(async () => {}), () => {}, createWorker, 5000, () => ({
      ready,
      close: vi.fn(async () => {}),
    }));
    managers.push(manager);

    const started = manager.start('project', '.', 1000);
    expect(started.taskId).toBeTruthy();
    expect(createWorker).not.toHaveBeenCalled();
    let ticks = 0;
    const timer = setInterval(() => { ticks += 1; }, 10);
    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(ticks).toBeGreaterThan(5);
    resolveBoundary('synthetic-session');
    expect((await manager.wait(started.taskId)).status).toBe('completed');
    clearInterval(timer);
    expect(createWorker).toHaveBeenCalledWith('.', 1000, 'synthetic-session');
  });

  it('deduplicates starts, bounds concurrency, and awaits worker exit on cancellation', async () => {
    const { manager, persist, workers } = create('while(true){}');
    const task = manager.start('project', '.', 1000);
    expect(manager.start('project', '.', 1000)).toEqual(task);
    expect(() => manager.start('other', '.', 1000)).toThrow('另一个项目');
    await vi.waitFor(() => expect(workers).toHaveLength(1));
    expect(await manager.cancel(task.taskId)).toEqual({ cancelled: true });
    expect((await manager.wait(task.taskId)).status).toBe('cancelled');
    expect(workers[0].threadId).toBe(-1);
    expect(persist).not.toHaveBeenCalled();
    expect(await manager.cancel(task.taskId)).toEqual({ cancelled: false });
    manager.start('other', '.', 1000);
    await vi.waitFor(() => expect(workers).toHaveLength(2));
    await manager.close();
    expect(workers[1].threadId).toBe(-1);
    expect(() => manager.start('project', '.', 1000)).toThrow('关闭');
  });

  it.each(['throw new Error("worker broke")', 'process.exit(0)', 'while(true){}'])(
    'settles errors, premature exits and timeouts without saving: %s', async (code) => {
      const { manager, persist, workers } = create(code, vi.fn(async () => {}), 400);
      const { taskId } = manager.start('project', '.', 1000);
      expect((await manager.wait(taskId)).status).toBe('failed');
      expect(persist).not.toHaveBeenCalled();
      expect(workers[0].threadId).toBe(-1);
    },
  );

  it('does not report cancelled after the persistence commit point, and waits on project close', async () => {
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => { release = resolve; });
    const { manager } = create(resultCode, vi.fn(() => barrier));
    const { taskId } = manager.start('project', '.', 1000);
    await vi.waitFor(() => expect(manager.get('project')?.status).toBe('saving'));
    expect(await manager.cancel(taskId)).toEqual({ cancelled: false });
    let stopped = false;
    const stop = manager.cancelProject('project').then(() => { stopped = true; });
    expect(stopped).toBe(false);
    release();
    await stop;
    expect((await manager.wait(taskId)).status).toBe('completed');
  });

  it('reports persistence failure instead of completion', async () => {
    const { manager } = create(resultCode, vi.fn(async () => { throw new Error('save failed'); }));
    const { taskId } = manager.start('project', '.', 1000);
    expect(await manager.wait(taskId)).toMatchObject({ status: 'failed', errorMessage: 'save failed' });
  });

  it('scans a real 3000-file fixture with accurate counts and cancels another real worker', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codehelm-worker-'));
    roots.push(root);
    for (let batch = 0; batch < 30; batch++) {
      await Promise.all(Array.from({ length: 100 }, (_, index) => fs.writeFile(path.join(root, `${batch}-${index}.ts`), '// test')));
    }
    const saved = vi.fn(async (_snapshot: unknown) => {});
    const states = vi.fn();
    const workers: Worker[] = [];
    const manager = new AnalysisTasks(saved, states, (rootPath, maxFiles) => {
      const worker = new Worker(path.resolve('packages/analyzer/dist/analysis-worker.js'), { workerData: { rootPath, maxFiles } });
      workers.push(worker);
      return worker;
    });
    managers.push(manager);
    const first = manager.start('project', root, 3000);
    expect((await manager.wait(first.taskId)).scannedFiles).toBe(3000);
    expect(saved).toHaveBeenCalledOnce();
    const limited = manager.start('project', root, 1000);
    expect(await manager.wait(limited.taskId)).toMatchObject({ status: 'failed', errorMessage: expect.stringContaining('超过上限 1000') });
    const cancel = manager.start('project', root, 3000);
    await vi.waitFor(() => expect(states.mock.calls.some(([state]) => state.taskId === cancel.taskId && state.scannedFiles > 0)).toBe(true));
    expect(await manager.cancel(cancel.taskId)).toEqual({ cancelled: true });
    expect(workers.at(-1)?.threadId).toBe(-1);
    expect(saved).toHaveBeenCalledOnce();
  }, 20000);

  it('holds the native root boundary through Worker result and persistence', async () => {
    const fixture = await fs.mkdtemp(path.join(os.tmpdir(), 'codehelm-worker-'));
    roots.push(fixture);
    const root = path.join(fixture, 'root');
    const moved = path.join(fixture, 'moved');
    await fs.mkdir(root);
    await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({ name: 'R05_INSIDE_CONTROL', scripts: { dev: 'vite' } }));
    let releasePersist!: () => void;
    const persistBarrier = new Promise<void>((resolve) => { releasePersist = resolve; });
    const saved = vi.fn(async (_snapshot: unknown) => persistBarrier);
    const manager = new AnalysisTasks(saved, () => {}, (rootPath, maxFiles, rootSessionId) =>
      new Worker(path.resolve('packages/analyzer/dist/analysis-worker.js'), { workerData: { rootPath, maxFiles, rootSessionId } }),
    5000, createTestNativeBoundary);
    managers.push(manager);

    const started = manager.start('project', root, 100);
    await vi.waitFor(() => expect(manager.get('project')?.status).toBe('saving'));
    await expect(fs.rename(root, moved)).rejects.toMatchObject({ code: 'EBUSY' });
    releasePersist();
    const result = await manager.wait(started.taskId);

    expect(result.status).toBe('completed');
    expect(saved).toHaveBeenCalledOnce();
    expect(JSON.stringify(saved.mock.calls[0]?.[0])).toContain('R05_INSIDE_CONTROL');
  });

  it('bounds a stalled persistence stage and releases shutdown with the previous result intact', async () => {
    const persist = vi.fn(async (_snapshot: unknown, _projectId: string, _rootPath: string, signal: AbortSignal) => {
      await new Promise<void>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new Error('persistence aborted')), { once: true });
      });
    });
    const { manager, workers } = create(resultCode, persist, 5000, 50);
    const started = manager.start('project', '.', 1000);
    const result = await manager.wait(started.taskId);

    expect(result).toMatchObject({
      status: 'failed',
      stage: '分析失败，原分析结果保留',
      errorMessage: '保存分析结果超时；原分析结果保留',
    });
    expect(persist).toHaveBeenCalledOnce();
    expect(workers[0].threadId).toBe(-1);
    await expect(manager.close()).resolves.toBeUndefined();
  });
});
