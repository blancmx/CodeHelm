import { Worker } from 'node:worker_threads';
import path from 'node:path';
import { generateId, normalizePath } from '@codehelm/shared';
import { BatchImportInputSchema, WorkspaceScanInputSchema } from '@codehelm/contracts';
import type { ImportProjectInput, ProjectDto, ProjectTaskDto, ProjectTaskProgressDto, WorkspaceScanInput } from '@codehelm/contracts';
import type { AnalysisTasks } from './analysis-tasks.js';
import type { AnalysisBoundaryFactory } from './analysis-tasks.js';

export type WorkspaceWorkerFactory = (input: WorkspaceScanInput, rootSessionId?: string) => Worker;
const defaultWorker: WorkspaceWorkerFactory = (input, rootSessionId) =>
  new Worker(path.join(__dirname, 'workspace-worker.js'), { workerData: { ...input, rootSessionId } });
const noBoundary: AnalysisBoundaryFactory = () => ({ ready: Promise.resolve(undefined), async close() {} });

interface Task {
  key: string;
  state: ProjectTaskDto;
  inputs: ImportProjectInput[];
  controller: AbortController;
  analysisId?: string;
  done: Promise<ProjectTaskDto>;
  resolve: (state: ProjectTaskDto) => void;
}

export class ProjectTasks {
  private active: Task | undefined;
  private history = new Map<string, ProjectTaskDto>();
  private closed = false;
  private unsubscribe: () => void;

  constructor(
    private readonly analysis: AnalysisTasks,
    private readonly ensureProject: (input: ImportProjectInput, signal: AbortSignal) => Promise<{ project: ProjectDto; needsAnalysis: boolean }>,
    private readonly scanLimit: () => number,
    private readonly publish: (state: ProjectTaskProgressDto) => void = () => {},
    private readonly createWorker = defaultWorker,
    private readonly scanTimeoutMs = 120_000,
    private readonly createBoundary: AnalysisBoundaryFactory = noBoundary,
  ) {
    this.unsubscribe = analysis.subscribe((state) => {
      const task = this.active;
      if (!task || task.analysisId !== state.taskId || task.controller.signal.aborted) return;
      task.state.stage = `${task.state.results.at(-1)?.name ?? '当前项目'} · ${state.stage}`;
      task.state.scannedFiles = state.scannedFiles;
      this.emit(task);
    });
  }

  startScan(rawInput: unknown): { taskId: string } {
    const input = WorkspaceScanInputSchema.parse(rawInput);
    input.rootPath = normalizePath(input.rootPath);
    return this.begin('scan', input, [], (task) => this.scan(task, input));
  }

  startImport(rawInput: unknown): { taskId: string } {
    const input = BatchImportInputSchema.parse(rawInput);
    if (!input.projects.length) throw new Error('请至少选择一个项目');
    const seen = new Set<string>();
    const inputs = input.projects.map((item) => ({ ...item, rootPath: normalizePath(item.rootPath) })).filter((item) => {
      const key = process.platform === 'win32' ? item.rootPath.toLowerCase() : item.rootPath;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    return this.begin('import', inputs, inputs, (task) => this.importProjects(task));
  }

  get(taskId: string): ProjectTaskDto | null {
    const state = this.active?.state.taskId === taskId ? this.active.state : this.history.get(taskId);
    return state ? structuredClone(state) : null;
  }

  async wait(taskId: string): Promise<ProjectTaskDto> {
    if (this.active?.state.taskId === taskId) return this.active.done;
    const state = this.get(taskId);
    if (!state) throw new Error('导入任务不存在或已过期');
    return state;
  }

  async cancel(taskId: string): Promise<{ cancelled: boolean }> {
    const task = this.active;
    if (!task || task.state.taskId !== taskId) return { cancelled: false };
    task.controller.abort();
    task.state.status = 'cancelling';
    task.state.stage = '正在停止任务；若当前项目已进入保存阶段，将等待保存结束…';
    this.emit(task);
    if (task.analysisId) await this.analysis.cancel(task.analysisId);
    const final = await task.done;
    return { cancelled: final.status === 'cancelled' };
  }

  async stopForPath(rootPath: string): Promise<void> {
    const normalize = (value: string) => process.platform === 'win32' ? normalizePath(value).toLowerCase() : normalizePath(value);
    if (this.active?.inputs.some((input) => normalize(input.rootPath) === normalize(rootPath))) {
      await this.cancel(this.active.state.taskId);
    }
  }

  async stopActive(): Promise<void> {
    if (this.active) await this.cancel(this.active.state.taskId);
  }

  async close(): Promise<void> {
    this.closed = true;
    await this.stopActive();
    this.unsubscribe();
  }

  private begin(kind: ProjectTaskDto['kind'], input: unknown, inputs: ImportProjectInput[], operation: (task: Task) => Promise<void>): { taskId: string } {
    if (this.closed) throw new Error('项目任务服务正在关闭');
    const key = JSON.stringify({ kind, input });
    if (this.active) {
      if (this.active.key === key) return { taskId: this.active.state.taskId };
      throw new Error('已有工作区发现或导入任务，请先等待完成或取消');
    }
    const taskId = generateId();
    this.analysis.reserve(taskId);
    let resolve!: Task['resolve'];
    const done = new Promise<ProjectTaskDto>((finish) => { resolve = finish; });
    const task: Task = { key, inputs, controller: new AbortController(), done, resolve,
      state: { taskId, kind, status: 'running', stage: kind === 'scan' ? '正在启动工作区发现 Worker…' : '正在导入项目…',
        completedCount: 0, totalCount: inputs.length, scannedDirectories: 0, foundProjects: 0, scannedFiles: 0, discovered: [], results: [] } };
    this.active = task;
    this.emit(task);
    // Start only after the caller has a stable task id; errors become queryable terminal states.
    queueMicrotask(() => { void this.run(task, operation); });
    return { taskId };
  }

  private async run(task: Task, operation: (task: Task) => Promise<void>): Promise<void> {
    try {
      if (!task.controller.signal.aborted) await operation(task);
      const succeeded = task.state.results.filter((item) => item.status === 'completed' || item.status === 'existing').length;
      const incomplete = succeeded < task.state.results.length;
      task.state.status = task.controller.signal.aborted ? 'cancelled'
        : incomplete ? succeeded > 0 ? 'partial' : 'failed' : 'completed';
      task.state.stage = task.state.status === 'cancelled' ? '已停止，已导入的项目和已保存的结果保留'
        : task.state.status === 'partial' ? '导入结束，部分项目未完成分析，请查看逐项结果'
          : task.state.status === 'failed' ? '导入未完成，请查看逐项结果'
            : task.state.kind === 'scan' ? '工作区发现完成' : '导入任务完成';
    } catch (error) {
      task.state.status = task.controller.signal.aborted ? 'cancelled' : 'failed';
      task.state.errorMessage = error instanceof Error ? error.message : String(error);
      task.state.stage = task.state.status === 'cancelled' ? '已停止，已导入的项目和已保存的结果保留' : '任务失败，请查看错误信息';
    } finally {
      this.analysis.release(task.state.taskId);
      this.history.set(task.state.taskId, structuredClone(task.state));
      if (this.history.size > 10) this.history.delete(this.history.keys().next().value!);
      if (this.active === task) this.active = undefined;
      this.emit(task);
      task.resolve(structuredClone(task.state));
    }
  }

  private async scan(task: Task, input: WorkspaceScanInput): Promise<void> {
    const boundary = this.createBoundary(input.rootPath, this.scanLimit());
    let worker: Worker | undefined;
    let scanError: unknown;
    try {
      const sessionId = await boundary.ready;
      if (task.controller.signal.aborted) throw new Error('已取消工作区发现');
      worker = this.createWorker(input, sessionId);
      await new Promise<void>((resolve, reject) => {
        let settled = false;
        const finish = async (error?: Error) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          task.controller.signal.removeEventListener('abort', abort);
          try { await worker!.terminate(); } catch (terminationError) { error = new Error(`工作区 Worker 退出失败：${String(terminationError)}`); }
          worker!.removeAllListeners();
          if (error) reject(error); else resolve();
        };
        const abort = () => { void finish(new Error('已取消工作区发现')); };
        const timeout = setTimeout(() => { void finish(new Error('工作区发现超时，已停止扫描')); }, this.scanTimeoutMs);
        timeout.unref();
        worker!.on('message', (message) => {
          if (settled || task.controller.signal.aborted) return;
          if (message.type === 'progress') {
            task.state.scannedDirectories = message.scannedDirectories;
            task.state.foundProjects = message.foundProjects;
            task.state.stage = '正在发现工作区项目…';
            this.emit(task);
          } else if (message.type === 'result') {
            task.state.discovered = message.discovered;
            task.state.foundProjects = message.discovered.length;
            void finish();
          } else if (message.type === 'error') void finish(new Error(message.errorMessage));
        });
        worker!.once('error', (error) => { void finish(error); });
        worker!.once('exit', (code) => { if (!settled) void finish(new Error(`工作区 Worker 提前退出（${code}）`)); });
        task.controller.signal.addEventListener('abort', abort, { once: true });
        if (task.controller.signal.aborted) abort();
      });
    } catch (error) {
      scanError = error;
    }

    let boundaryError: unknown;
    try {
      await boundary.close();
    } catch (error) {
      boundaryError = error;
    }

    if (scanError !== undefined) {
      if (boundaryError !== undefined) {
        throw new AggregateError([scanError, boundaryError], '工作区发现失败且无法释放安全边界');
      }
      throw scanError;
    }
    if (boundaryError !== undefined) {
      throw new Error(`无法释放工作区安全边界：${String(boundaryError)}`, { cause: boundaryError });
    }
  }

  private async importProjects(task: Task): Promise<void> {
    for (const input of task.inputs) {
      if (task.controller.signal.aborted) break;
      task.state.stage = `正在导入 ${input.name || path.basename(input.rootPath)}…`;
      task.state.scannedFiles = 0;
      this.emit(task);
      const result: ProjectTaskDto['results'][number] = { rootPath: input.rootPath, name: input.name || path.basename(input.rootPath), status: 'imported' };
      task.state.results.push(result);
      try {
        const { project, needsAnalysis } = await this.ensureProject(input, task.controller.signal);
        result.project = project;
        result.name = project.name;
        if (task.controller.signal.aborted) { result.status = 'cancelled'; break; }
        if (needsAnalysis) {
          const started = this.analysis.start(project.id, project.rootPath, this.scanLimit(), task.state.taskId);
          task.analysisId = started.taskId;
          const analysis = await this.analysis.wait(started.taskId);
          task.analysisId = undefined;
          result.status = analysis.status === 'completed' ? 'completed' : analysis.status === 'cancelled' ? 'cancelled' : 'failed';
          result.errorMessage = analysis.errorMessage;
        } else result.status = 'existing';
      } catch (error) {
        result.status = task.controller.signal.aborted ? 'cancelled' : 'failed';
        result.errorMessage = error instanceof Error ? error.message : String(error);
      }
      task.state.completedCount++;
      this.emit(task);
    }
  }

  private emit(task: Task): void {
    const { discovered: _discovered, results: _results, ...progress } = task.state;
    try { this.publish({ ...progress }); } catch { /* Renderer lifetime cannot block worker cleanup. */ }
  }
}
