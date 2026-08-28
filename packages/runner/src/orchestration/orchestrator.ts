import type {
  LogBatch,
  RunProfile,
  RunSession,
  ServiceConfig,
  ServiceSession,
} from '@codehelm/domain';
import { generateId } from '@codehelm/shared';
import { topologicalSortServices } from './topology.js';
import { ProcessManager } from '../process/process-manager.js';
import { LogCollector } from '../logs/log-collector.js';
import { HealthChecker } from '../health/health-checker.js';
import { PortConflictError, prepareServicePort } from './port-allocator.js';
import { setTimeout as delay } from 'node:timers/promises';

export type StatusListener = (session: ServiceSession, projectId: string, runSessionId: string) => void;

export class Orchestrator {
  private processManager: ProcessManager;
  private logCollector: LogCollector;
  private activeSessions = new Map<string, RunSession>(); // runSessionId -> RunSession
  private startupTasks = new Map<string, Promise<void>>();
  private statusListeners = new Set<StatusListener>();
  private saveSession?: (session: RunSession) => void;
  private persistenceError?: string;
  private shutdownRequested = false;
  private cancelled = new Set<string>();
  private stopTasks = new Map<string, Promise<void>>();
  private readiness = new Map<string, AbortController>();
  private restarts = new Map<string, { runId: string; configId: string; cancelled: boolean; task: Promise<ServiceSession> }>();

  constructor() {
    this.processManager = new ProcessManager();
    this.logCollector = new LogCollector();
  }

  getLogCollector(): LogCollector {
    return this.logCollector;
  }

  setSessionPersistence(save: (session: RunSession) => void): void {
    this.saveSession = save;
  }

  getPersistenceError(): string | undefined { return this.persistenceError; }

  assertCanStart(): void {
    if (this.shutdownRequested) throw new Error('应用正在退出，不能启动新的服务。');
    if (this.persistenceError) throw new Error(this.persistenceError);
  }

  private persist(session: RunSession, required = false): void {
    try { this.saveSession?.(session); }
    catch (error) {
      this.persistenceError = '运行记录写入失败，已阻止继续启动服务。请检查数据库和磁盘后重启应用。';
      console.error('[Runner] Session persistence failed:', error);
    }
    if (required && this.persistenceError) throw new Error(this.persistenceError);
  }

  private updateAggregate(session: RunSession): void {
    if (this.startupTasks.has(session.id) || session.status === 'STOPPING') return;
    const active = session.services.some(s => ['STARTING','RUNNING','DEGRADED','STOPPING','ORPHANED'].includes(s.status));
    const restarting = [...this.restarts.values()].some(r => r.runId === session.id && !r.cancelled);
    const failed = session.services.some(s => ['FAILED','DEGRADED','ORPHANED'].includes(s.status))
      || (session.services.length === 0 && session.status === 'FAILED');
    session.status = active ? (failed ? 'PARTIAL_FAILED' : 'RUNNING') : restarting ? 'STARTING' : failed ? 'FAILED' : 'STOPPED';
    if (active || restarting) session.stoppedAt = undefined;
    else session.stoppedAt ??= new Date().toISOString();
  }

  onStatusChange(listener: StatusListener): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  onLogs(listener: (batch: LogBatch) => void): () => void {
    return this.logCollector.onBatch(listener);
  }

  async startSession(projectRoot: string, profile: RunProfile): Promise<RunSession> {
    this.assertCanStart();
    const existingSession = [...this.activeSessions.values()].find((session) =>
      session.projectId === profile.projectId
      && session.runProfileId === profile.id
      && ['STARTING', 'RUNNING', 'PARTIAL_FAILED', 'STOPPING'].includes(session.status)
    );
    if (existingSession) {
      this.logCollector.append(
        profile.projectId,
        existingSession.id,
        'system',
        'System',
        'system',
        '[Start Ignored] 当前启动方案已有活动会话，本次重复启动请求已忽略。\n'
      );
      // A second renderer request can arrive while the first startup is still
      // performing health checks. Wait for that same startup task so both IPC
      // callers receive a complete, stable session snapshot.
      const startupTask = this.startupTasks.get(existingSession.id);
      if (startupTask) await startupTask;

      // A renderer reload loses its in-memory status map while the main process
      // and child services keep running. Re-emit the live snapshot so the UI
      // can rehydrate without launching duplicate processes.
      for (const service of existingSession.services) {
        this.notifyStatus(service, existingSession.projectId, existingSession.id);
      }
      return existingSession;
    }

    const runSessionId = generateId();
    const runSession: RunSession = {
      id: runSessionId,
      projectId: profile.projectId,
      runProfileId: profile.id,
      status: 'STARTING',
      services: [],
      startedAt: new Date().toISOString(),
    };
    this.activeSessions.set(runSessionId, runSession);
    try { this.persist(runSession, true); }
    catch (error) { this.activeSessions.delete(runSessionId); throw error; }

    // 1. DAG Topological Layers
    let layers: ServiceConfig[][];
    try { layers = topologicalSortServices(profile.services); }
    catch (error) {
      runSession.status = 'FAILED';
      runSession.stoppedAt = new Date().toISOString();
      this.persist(runSession);
      throw error;
    }

    // Complete the initial launch and health-check pass before resolving the
    // IPC request. Returning the empty STARTING shell made the renderer report
    // success even when every child process failed moments later.
    const startupTask = this.executeLayers(projectRoot, profile, runSession, layers)
      .catch((err) => {
        console.error('Session execution error:', err);
        runSession.status = 'FAILED';
        this.persist(runSession);
      });
    this.startupTasks.set(runSessionId, startupTask);
    try {
      await startupTask;
    } finally {
      this.startupTasks.delete(runSessionId);
    }

    if (this.persistenceError) {
      await this.stopSession(runSessionId);
      throw new Error(this.persistenceError);
    }
    if (!this.cancelled.has(runSessionId)) this.updateAggregate(runSession);
    this.persist(runSession, true);

    return runSession;
  }

  private async executeLayers(
    projectRoot: string,
    profile: RunProfile,
    runSession: RunSession,
    layers: ServiceConfig[][]
  ): Promise<void> {
    const failedServiceIds = new Set<string>();
    const reservedPorts = new Set<number>();
    for (const active of this.activeSessions.values()) {
      if (active.id === runSession.id) continue;
      for (const service of active.services) {
        if (service.port && ['STARTING', 'RUNNING', 'DEGRADED'].includes(service.status)) {
          reservedPorts.add(service.port);
        }
      }
    }

    for (const layer of layers) {
      if (this.cancelled.has(runSession.id) || this.shutdownRequested) return;
      // Filter out services whose dependencies failed under block_dependents
      const executableServices = layer.filter((s) => {
        if (profile.failurePolicy === 'block_dependents') {
          const hasFailedDep = s.dependsOn.some((depId) => failedServiceIds.has(depId));
          if (hasFailedDep) {
            this.logCollector.append(
              profile.projectId,
              runSession.id,
              s.id,
              s.name,
              'system',
              `[Skipped] 前置依赖服务启动失败，已按策略阻止启动: ${s.name}\n`
            );
            return false;
          }
        }
        return true;
      });

      if (executableServices.length === 0) continue;

      // Resolve ports sequentially so services in the same layer cannot select the same port.
      const preparedServices: ServiceConfig[] = [];
      let portPreparationFailed = false;
      for (const service of executableServices) {
        this.assertCanStart();
        if (this.cancelled.has(runSession.id)) return;
        try {
          const resolution = await prepareServicePort(service, reservedPorts);
          preparedServices.push(resolution.service);
          if (resolution.changed) {
            this.logCollector.append(
              profile.projectId,
              runSession.id,
              service.id,
              service.name,
              'system',
              `[Port Auto-Assign] 首选端口 ${resolution.preferredPort} 已占用，已为本次运行分配 ${resolution.assignedPort}。\n`
            );
          }
        } catch (error) {
          portPreparationFailed = true;
          failedServiceIds.add(service.id);
          const detail = error instanceof PortConflictError
            ? error.reason === 'project_constraint'
              ? `项目配置要求固定使用端口 ${error.port}（通常来自 CORS/回调地址），但该端口已被占用。请先停止占用进程。`
              : `手工配置端口 ${error.port} 已被占用，未自动修改。`
            : error instanceof Error ? error.message : String(error);
          this.logCollector.append(
            profile.projectId,
            runSession.id,
            service.id,
            service.name,
            'stderr',
            `[Port Conflict] ${detail}\n`
          );
          const failed: ServiceSession = {
            id: generateId(), runSessionId: runSession.id, serviceConfigId: service.id,
            serviceName: service.name, serviceType: service.type, status: 'FAILED', port: service.port,
            errorMessage: detail, startedAt: new Date().toISOString(), stoppedAt: new Date().toISOString(),
          };
          runSession.services.push(failed);
          this.notifyStatus(failed, profile.projectId, runSession.id);
        }
      }

      // Start all services in the current layer concurrently
      const servicePromises = preparedServices.map(async (service) => {
        if (this.cancelled.has(runSession.id) || this.shutdownRequested) return undefined;
        this.assertCanStart();
        const serviceSession = await this.processManager.startService(
          service,
          projectRoot,
          runSession.id,
          (sId, stream, text) => {
            this.logCollector.append(
              profile.projectId,
              runSession.id,
              sId,
              service.name,
              stream,
              text
            );
          },
          (sId, exitCode, _signal) => {
            if (exitCode !== 0) {
              failedServiceIds.add(service.id);
            }
            const exited = runSession.services.find(s => s.id === sId);
            if (exited) this.notifyStatus(exited, profile.projectId, runSession.id);
          },
          (prepared) => {
            this.assertCanStart();
            if (this.cancelled.has(runSession.id)) throw new Error('会话已停止，取消服务启动。');
            runSession.services.push(prepared);
            this.persist(runSession, true);
          },
          (changed) => this.notifyStatus(changed, profile.projectId, runSession.id),
        );

        this.notifyStatus(serviceSession, profile.projectId, runSession.id);

        await this.waitForReadiness(service, serviceSession, runSession);
        if (['FAILED', 'DEGRADED'].includes(serviceSession.status)) failedServiceIds.add(service.id);

        return serviceSession;
      });

      const results = await Promise.allSettled(servicePromises);

      // Check failure policy rollback
      const anyFailed = portPreparationFailed || results.some(
        (r) => r.status === 'rejected' || (r.status === 'fulfilled' && r.value?.status === 'FAILED')
      );

      if (anyFailed && profile.failurePolicy === 'rollback_all') {
        this.logCollector.append(
          profile.projectId,
          runSession.id,
          'system',
          'System',
          'system',
          '[Rollback] 遇到关键服务启动失败，正在回滚停止已启动的服务...\n'
        );
        // Do not await our own startup task through stopSession.
        this.cancelled.add(runSession.id);
        await Promise.allSettled(runSession.services.map(s => this.processManager.stopService(s.id)));
        runSession.status = 'FAILED';
        return;
      }
    }

    const hasUsableService = runSession.services.some((service) =>
      ['STARTING', 'RUNNING', 'DEGRADED'].includes(service.status)
    );
    runSession.status = hasUsableService ? 'RUNNING' : 'FAILED';
    this.persist(runSession);
  }

  async stopSession(runSessionId: string): Promise<void> {
    const pending = this.stopTasks.get(runSessionId);
    if (pending) return pending;
    const session = this.activeSessions.get(runSessionId);
    if (!session) throw new Error('该会话不属于当前进程，历史会话不能直接停止。');
    const task = this.performStop(session);
    this.stopTasks.set(runSessionId, task);
    try { await task; } finally { this.stopTasks.delete(runSessionId); }
  }

  private async performStop(session: RunSession): Promise<void> {
    const runSessionId = session.id;
    this.cancelled.add(runSessionId);
    for (const restart of this.restarts.values()) if (restart.runId === runSessionId) restart.cancelled = true;
    for (const service of session.services) this.readiness.get(service.id)?.abort();
    session.status = 'STOPPING';
    this.persist(session);
    // Stop existing children immediately, and prevent later DAG layers from spawning after stop.
    const needsStop = (s: ServiceSession) => this.processManager.getSession(s.id)
      && ['STARTING','RUNNING','DEGRADED','ORPHANED','STOPPING'].includes(s.status);
    await Promise.allSettled(session.services.filter(needsStop).map(s => this.processManager.stopService(s.id)));
    await this.startupTasks.get(runSessionId);
    await Promise.allSettled([...this.restarts.values()].filter(r => r.runId === runSessionId).map(r => r.task));
    await Promise.allSettled(session.services.filter(needsStop).map(s => this.processManager.stopService(s.id)));
    session.status = 'STOPPED';
    this.updateAggregate(session);
    this.persist(session);
    if (session.services.some(s => ['ORPHANED','RUNNING','STARTING','DEGRADED'].includes(s.status))) {
      throw new Error('部分服务未确认停止，请查看运行记录；未操作不明进程。');
    }
  }

  async stopService(serviceSessionId: string): Promise<void> {
    const owner = [...this.activeSessions.values()].find(s => s.services.some(child => child.id === serviceSessionId));
    const configId = owner?.services.find(child => child.id === serviceSessionId)?.serviceConfigId;
    const restart = [...this.restarts.values()].find(r => r.runId === owner?.id && r.configId === configId);
    if (restart) {
      restart.cancelled = true;
      for (const child of owner!.services.filter(s => s.serviceConfigId === configId)) this.readiness.get(child.id)?.abort();
      await Promise.allSettled([restart.task]);
      for (const child of owner!.services.filter(s => s.serviceConfigId === configId)) {
        if (this.processManager.getSession(child.id)) await this.processManager.stopService(child.id);
      }
      return;
    }
    if (!this.processManager.getSession(serviceSessionId)) throw new Error('历史或已结束的服务不能直接停止。');
    this.readiness.get(serviceSessionId)?.abort();
    await this.processManager.stopService(serviceSessionId);
    for (const session of this.activeSessions.values()) {
      const s = session.services.find((x) => x.id === serviceSessionId);
      if (s) {
        this.notifyStatus(s, session.projectId, session.id);
        break;
      }
    }
  }

  async restartService(serviceSessionId: string): Promise<ServiceSession> {
    this.assertCanStart();
    const run = [...this.activeSessions.values()].find(s => s.services.some(child => child.id === serviceSessionId));
    const previous = run?.services.find(s => s.id === serviceSessionId);
    if (!run || !previous) throw new Error(`Active service session not found: ${serviceSessionId}`);
    const key = `${run.id}:${previous.serviceConfigId}`;
    const pending = this.restarts.get(key);
    if (pending) return pending.task;
    const config = this.processManager.getServiceConfig(serviceSessionId);
    if (!config) throw new Error(`Active service session not found: ${serviceSessionId}`);
    if (this.startupTasks.has(run.id) || this.stopTasks.has(run.id) || this.cancelled.has(run.id)) {
      throw new Error('会话正在启动或已停止，不能同时重启服务。');
    }
    const restart = { runId: run.id, configId: config.id, cancelled: false, task: null as unknown as Promise<ServiceSession> };
    const ensureAllowed = () => {
      this.assertCanStart();
      if (restart.cancelled || this.cancelled.has(run.id)) throw new Error('停止请求已取消本次重启。');
    };
    restart.task = Promise.resolve().then(async () => {
      ensureAllowed();
      const child = await this.processManager.restartService(serviceSessionId, ensureAllowed);
      if (this.persistenceError || restart.cancelled || this.cancelled.has(run.id) || this.shutdownRequested) {
        await this.processManager.stopService(child.id);
        ensureAllowed();
      }
      await this.waitForReadiness(config, child, run);
      return child;
    }).finally(() => {
      this.restarts.delete(key);
      this.updateAggregate(run);
      this.persist(run);
    });
    this.restarts.set(key, restart);
    return restart.task;
  }

  private async waitForReadiness(config: ServiceConfig, child: ServiceSession, run: RunSession): Promise<void> {
    if (child.status !== 'STARTING') return;
    const controller = new AbortController();
    this.readiness.set(child.id, controller);
    try {
      const check = config.healthCheck;
      let healthy: boolean;
      if (check?.type === 'tcp' && check.port) {
        healthy = await HealthChecker.waitForPortOpen(check.port, config.startTimeoutMs || 10000, 200, undefined, controller.signal);
      } else if (check?.type === 'http' && check.port) {
        healthy = await HealthChecker.waitForHttp(`http://localhost:${check.port}${check.httpPath || '/'}`, check.expectedStatus || 200,
          config.startTimeoutMs || 10000, 300, controller.signal);
      } else {
        await delay(500, undefined, { signal: controller.signal }).catch(() => {});
        healthy = child.status === 'STARTING';
      }
      if (controller.signal.aborted || child.status !== 'STARTING' || this.cancelled.has(run.id) || this.shutdownRequested) return;
      child.status = healthy ? 'RUNNING' : 'DEGRADED';
      if (!healthy) child.errorMessage = '服务未在规定时间内通过就绪检查，请查看日志和端口。';
      this.notifyStatus(child, run.projectId, run.id);
    } finally { this.readiness.delete(child.id); }
  }

  async stopAll(): Promise<void> {
    this.shutdownRequested = true;
    await Promise.allSettled([...this.activeSessions.keys()].map(id => this.stopSession(id)));
    this.logCollector.flush();
  }

  getActiveSessions(): RunSession[] {
    return Array.from(this.activeSessions.values()).filter(
      (s) => ['RUNNING','STARTING','PARTIAL_FAILED','STOPPING'].includes(s.status)
    );
  }

  getSession(runSessionId: string): RunSession | undefined {
    return this.activeSessions.get(runSessionId);
  }

  private notifyStatus(session: ServiceSession, projectId: string, runSessionId: string): void {
    if (session.status !== 'STARTING') this.readiness.get(session.id)?.abort();
    const run = this.activeSessions.get(runSessionId);
    if (run) {
      this.updateAggregate(run);
      this.persist(run);
    }
    for (const listener of this.statusListeners) {
      try {
        listener(session, projectId, runSessionId);
      } catch (err) {
        console.error('Status listener error:', err);
      }
    }
  }
}
