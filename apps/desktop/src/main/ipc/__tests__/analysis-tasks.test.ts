import { afterEach, describe, expect, it, vi } from 'vitest';
import { Worker } from 'node:worker_threads';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { AnalysisTasks } from '../analysis-tasks.js';

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

function create(code: string, persist = vi.fn(async () => {}), timeout = 5000) {
  const workers: Worker[] = [];
  const publish = vi.fn();
  const manager = new AnalysisTasks(persist, publish, () => {
    const worker = new Worker(code, { eval: true });
    workers.push(worker);
    return worker;
  }, timeout);
  managers.push(manager);
  return { manager, persist, publish, workers };
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

  it('deduplicates starts, bounds concurrency, and awaits worker exit on cancellation', async () => {
    const { manager, persist, workers } = create('while(true){}');
    const task = manager.start('project', '.', 1000);
    expect(manager.start('project', '.', 1000)).toEqual(task);
    expect(() => manager.start('other', '.', 1000)).toThrow('另一个项目');
    expect(workers).toHaveLength(1);
    expect(await manager.cancel(task.taskId)).toEqual({ cancelled: true });
    expect((await manager.wait(task.taskId)).status).toBe('cancelled');
    expect(workers[0].threadId).toBe(-1);
    expect(persist).not.toHaveBeenCalled();
    expect(await manager.cancel(task.taskId)).toEqual({ cancelled: false });
    manager.start('other', '.', 1000);
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
    const saved = vi.fn(async () => {});
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
});
