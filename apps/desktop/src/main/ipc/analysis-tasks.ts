import { Worker } from 'node:worker_threads';
import path from 'node:path';
import { generateId } from '@codehelm/shared';
import type { AnalysisSnapshot } from '@codehelm/domain';
import type { AnalysisTaskDto } from '@codehelm/contracts';

export type AnalysisWorkerFactory = (rootPath: string, maxFiles: number, rootSessionId?: string) => Worker;
export const createAnalysisWorker: AnalysisWorkerFactory = (rootPath, maxFiles, rootSessionId) =>
  new Worker(path.join(__dirname, 'analysis-worker.js'), { workerData: { rootPath, maxFiles, rootSessionId } });

export interface AnalysisBoundary {
  ready: Promise<string | undefined>;
  close(): Promise<void>;
}

export type AnalysisBoundaryFactory = (rootPath: string, maxDirectories: number) => AnalysisBoundary;
export function createAnalysisBoundaryFromWorker(worker: Worker): AnalysisBoundary {
  let readySettled = false;
  let closeRequested = false;
  let closeSettled = false;
  let resolveReady!: (sessionId: string) => void;
  let rejectReady!: (error: Error) => void;
  let resolveClose!: () => void;
  let rejectClose!: (error: Error) => void;
  const ready = new Promise<string>((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
  const closed = new Promise<void>((resolve, reject) => { resolveClose = resolve; rejectClose = reject; });

  const fail = (error: Error) => {
    if (!readySettled) {
      readySettled = true;
      rejectReady(error);
    }
    if (closeRequested && !closeSettled) {
      closeSettled = true;
      rejectClose(error);
    }
  };
  worker.on('message', (message: { type?: string; sessionId?: string; errorMessage?: string }) => {
    if (message.type === 'ready' && typeof message.sessionId === 'string') {
      if (!readySettled) {
        readySettled = true;
        resolveReady(message.sessionId);
      }
    } else if (message.type === 'error') {
      fail(new Error(message.errorMessage || '无法建立项目安全边界'));
    } else if (message.type === 'closed') {
      if (!closeSettled) {
        closeSettled = true;
        resolveClose();
      }
    } else if (message.type === 'close-error') {
      if (!closeSettled) {
        closeSettled = true;
        rejectClose(new Error(message.errorMessage || '无法释放项目安全边界'));
      }
    }
  });
  worker.once('error', (error) => fail(error));
  worker.once('exit', (code) => {
    if (!readySettled) fail(new Error(`安全边界 Worker 提前退出（${code}）`));
    if (closeRequested && !closeSettled) {
      closeSettled = true;
      if (code === 0) resolveClose();
      else rejectClose(new Error(`安全边界 Worker 退出失败（${code}）`));
    }
  });

  let closePromise: Promise<void> | undefined;
  return {
    ready,
    close() {
      if (closePromise) return closePromise;
      closeRequested = true;
      closePromise = (async () => {
        try {
          await ready;
        } catch {
          try { await worker.terminate(); } catch { /* Preserve the boundary creation error. */ }
          return;
        }
        if (worker.threadId === -1) return;
        worker.postMessage({ type: 'close' });
        await closed;
        try { await worker.terminate(); } catch { /* The worker already acknowledged cleanup. */ }
      })();
      return closePromise;
    },
  };
}

export const createNativeAnalysisBoundary: AnalysisBoundaryFactory = (rootPath, maxDirectories) => {
  const worker = new Worker(path.join(__dirname, 'analysis-boundary-worker.js'), {
    workerData: { rootPath, maxEntries: maxDirectories },
  });
  return createAnalysisBoundaryFromWorker(worker);
};
const noBoundary: AnalysisBoundaryFactory = () => ({ ready: Promise.resolve(undefined), async close() {} });

interface Task {
  state: AnalysisTaskDto;
  controller: AbortController;
  done: Promise<AnalysisTaskDto>;
  resolve: (state: AnalysisTaskDto) => void;
  worker?: Worker;
  settling: boolean;
  timeout?: ReturnType<typeof setTimeout>;
  boundary?: ReturnType<AnalysisBoundaryFactory>;
}

/** One worker at a time bounds CPU/memory; duplicate requests share the same task. */
export class AnalysisTasks {
  private active: Task | undefined;
  private history = new Map<string, AnalysisTaskDto>();
  private closed = false;
  private reservation: string | undefined;
  private listeners = new Set<(state: AnalysisTaskDto) => void>();

  reserve(owner: string): void {
    if (this.closed || this.active || this.reservation) throw new Error('已有扫描或导入任务，请先等待完成或取消');
    this.reservation = owner;
  }

  release(owner: string): void {
    if (this.reservation === owner) this.reservation = undefined;
  }

  subscribe(listener: (state: AnalysisTaskDto) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  constructor(
    private readonly persist: (snapshot: AnalysisSnapshot, projectId: string, rootPath: string, signal: AbortSignal) => Promise<void>,
    private readonly publish: (state: AnalysisTaskDto) => void = () => {},
    private readonly createWorker = createAnalysisWorker,
    private readonly timeoutMs = 120_000,
    private readonly createBoundary: AnalysisBoundaryFactory = noBoundary,
    private readonly persistenceTimeoutMs = 30_000,
  ) {}

  get(projectId: string): AnalysisTaskDto | null {
    const state = this.active?.state.projectId === projectId ? this.active.state : this.history.get(projectId);
    return state ? { ...state } : null;
  }

  start(projectId: string, rootPath: string, maxFiles: number, owner?: string): { taskId: string } {
    if (this.closed) throw new Error('分析服务正在关闭');
    if (this.reservation && owner !== this.reservation) throw new Error('工作区发现或导入任务正在运行，请先等待完成或取消');
    if (this.active) {
      if (this.active.state.projectId === projectId) return { taskId: this.active.state.taskId };
      throw new Error('另一个项目正在分析，请等待完成或先取消该任务');
    }
    let resolve!: Task['resolve'];
    const done = new Promise<AnalysisTaskDto>((settle) => { resolve = settle; });
    const task: Task = {
      state: { taskId: generateId(), projectId, status: 'running', stage: '正在启动扫描 Worker…', percentage: 0, scannedFiles: 0 },
      controller: new AbortController(), done, resolve, settling: false,
    };
    this.active = task;
    this.emit(task);
    task.timeout = setTimeout(() => {
      task.controller.abort();
      void this.finish(task, 'failed', '分析超时，已终止 Worker；原分析结果保留');
    }, this.timeoutMs);
    task.timeout.unref();
    try {
      task.boundary = this.createBoundary(rootPath, maxFiles);
      void this.launch(task, rootPath, maxFiles);
    } catch (error) {
      void this.finish(task, 'failed', error instanceof Error ? error.message : String(error));
    }
    return { taskId: task.state.taskId };
  }

  private async launch(task: Task, rootPath: string, maxFiles: number): Promise<void> {
    try {
      const sessionId = await task.boundary!.ready;
      if (task.settling || task.controller.signal.aborted || task.state.status !== 'running') return;
      const worker = this.createWorker(rootPath, maxFiles, sessionId);
      task.worker = worker;
      worker.on('message', (message) => {
        if (task.settling || task.controller.signal.aborted || task.state.status !== 'running') return;
        if (message.type === 'progress') {
          if (!Number.isFinite(message.percentage) || !Number.isSafeInteger(message.scannedFiles)) return;
          task.state = { ...task.state, percentage: Math.max(0, Math.min(95, message.percentage)),
            scannedFiles: Math.max(task.state.scannedFiles, message.scannedFiles), stage: String(message.stage) };
          this.emit(task);
        } else if (message.type === 'result') {
          const snapshot = message.snapshot as AnalysisSnapshot;
          if (snapshot.status !== 'completed') {
            void this.finish(task, snapshot.status === 'cancelled' ? 'cancelled' : 'failed', snapshot.errorMessage || '分析失败');
            return;
          }
          task.state.status = 'saving';
          task.state.stage = '正在保存分析结果与启动方案…';
          task.state.percentage = 98;
          this.emit(task);
          // Persistence is the commit point: user cancellation cannot report success after saving has begun,
          // but shutdown must still have a finite upper bound if profile preparation or storage stalls.
          clearTimeout(task.timeout);
          task.timeout = setTimeout(() => {
            task.controller.abort();
            void this.finish(task, 'failed', '保存分析结果超时；原分析结果保留');
          }, this.persistenceTimeoutMs);
          task.timeout.unref();
          void (async () => {
            try {
              await worker.terminate();
              if (task.settling || task.controller.signal.aborted) return;
              worker.removeAllListeners();
              await this.persist(snapshot, task.state.projectId, rootPath, task.controller.signal);
              await this.finish(task, 'completed');
            } catch (error) {
              await this.finish(task, 'failed', error instanceof Error ? error.message : String(error));
            }
          })();
        } else if (message.type === 'error') {
          void this.finish(task, 'failed', String(message.errorMessage));
        }
      });
      worker.once('error', (error) => { void this.finish(task, 'failed', error.message); });
      worker.once('exit', (code) => {
        if (!task.settling && task.state.status === 'running') {
          void this.finish(task, 'failed', `扫描 Worker 提前退出（${code}），原分析结果保留`);
        }
      });
    } catch (error) {
      if (!task.settling) await this.finish(task, 'failed', error instanceof Error ? error.message : String(error));
    }
  }

  async wait(taskId: string): Promise<AnalysisTaskDto> {
    if (this.active?.state.taskId === taskId) return this.active.done;
    const result = [...this.history.values()].find((state) => state.taskId === taskId);
    if (!result) throw new Error('分析任务不存在或已过期');
    return { ...result };
  }

  async cancel(taskId: string): Promise<{ cancelled: boolean }> {
    const task = this.active;
    if (!task || task.state.taskId !== taskId || task.state.status === 'saving' || task.settling) return { cancelled: false };
    task.controller.abort();
    task.state.status = 'cancelling';
    task.state.stage = '正在停止扫描 Worker…';
    this.emit(task);
    await this.finish(task, 'cancelled');
    return { cancelled: true };
  }

  async cancelProject(projectId: string): Promise<void> {
    const task = this.active;
    if (task?.state.projectId !== projectId) return;
    await this.cancel(task.state.taskId);
    await task.done;
  }

  async close(): Promise<void> {
    this.closed = true;
    await this.stopActive();
  }

  async stopActive(): Promise<void> {
    if (this.active) await this.cancelProject(this.active.state.projectId);
  }

  private emit(task: Task): void {
    try { this.publish({ ...task.state }); } catch { /* A closed renderer cannot hold a task open. */ }
    for (const listener of this.listeners) {
      try { listener({ ...task.state }); } catch { /* Observers cannot interrupt task cleanup. */ }
    }
  }

  private async finish(task: Task, status: 'completed' | 'failed' | 'cancelled', errorMessage?: string): Promise<void> {
    if (task.settling) return task.done.then(() => {});
    task.settling = true;
    clearTimeout(task.timeout);
    try { await task.worker?.terminate(); } catch (error) {
      status = 'failed';
      errorMessage = `无法终止扫描 Worker：${String(error)}`;
    }
    task.worker?.removeAllListeners();
    try { await task.boundary?.close(); } catch (error) {
      status = 'failed';
      errorMessage = `无法释放项目安全边界：${String(error)}`;
    }
    task.state = { ...task.state, status, errorMessage,
      stage: status === 'completed' ? '分析完成' : status === 'cancelled' ? '已取消，原分析结果保留' : '分析失败，原分析结果保留',
      percentage: status === 'completed' ? 100 : task.state.percentage };
    this.history.delete(task.state.projectId);
    this.history.set(task.state.projectId, { ...task.state });
    if (this.history.size > 100) this.history.delete(this.history.keys().next().value!);
    if (this.active === task) this.active = undefined;
    this.emit(task);
    task.resolve({ ...task.state });
  }
}
