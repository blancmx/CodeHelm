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

export type StatusListener = (session: ServiceSession, projectId: string, runSessionId: string) => void;

export class Orchestrator {
  private processManager: ProcessManager;
  private logCollector: LogCollector;
  private activeSessions = new Map<string, RunSession>(); // runSessionId -> RunSession
  private statusListeners = new Set<StatusListener>();

  constructor() {
    this.processManager = new ProcessManager();
    this.logCollector = new LogCollector();
  }

  getLogCollector(): LogCollector {
    return this.logCollector;
  }

  onStatusChange(listener: StatusListener): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  onLogs(listener: (batch: LogBatch) => void): () => void {
    return this.logCollector.onBatch(listener);
  }

  async startSession(projectRoot: string, profile: RunProfile): Promise<RunSession> {
    const existingSession = [...this.activeSessions.values()].find((session) =>
      session.projectId === profile.projectId
      && session.runProfileId === profile.id
      && ['STARTING', 'RUNNING'].includes(session.status)
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

    // 1. DAG Topological Layers
    const layers = topologicalSortServices(profile.services);

    // Run execution in background sequence so startSession returns initial session
    this.executeLayers(projectRoot, profile, runSession, layers).catch((err) => {
      console.error('Session execution error:', err);
      runSession.status = 'FAILED';
    });

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
            ? `手工配置端口 ${error.port} 已被占用，未自动修改。`
            : error instanceof Error ? error.message : String(error);
          this.logCollector.append(
            profile.projectId,
            runSession.id,
            service.id,
            service.name,
            'stderr',
            `[Port Conflict] ${detail}\n`
          );
        }
      }

      // Start all services in the current layer concurrently
      const servicePromises = preparedServices.map(async (service) => {
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
          (_sId, exitCode, _signal) => {
            if (exitCode !== 0) {
              failedServiceIds.add(service.id);
            }
            this.notifyStatus(serviceSession, profile.projectId, runSession.id);
          }
        );

        runSession.services.push(serviceSession);
        this.notifyStatus(serviceSession, profile.projectId, runSession.id);

        // Perform health check or readiness check
        if (serviceSession.status === 'STARTING') {
          let healthy = true;

          if (service.healthCheck?.type === 'tcp' && service.healthCheck.port) {
            healthy = await HealthChecker.waitForPortOpen(
              service.healthCheck.port,
              service.startTimeoutMs || 10000
            );
          } else if (service.healthCheck?.type === 'http' && service.healthCheck.port) {
            const url = `http://localhost:${service.healthCheck.port}${service.healthCheck.httpPath || '/'}`;
            healthy = await HealthChecker.waitForHttp(
              url,
              service.healthCheck.expectedStatus || 200,
              service.startTimeoutMs || 10000
            );
          } else {
            // Wait 500ms to verify process did not immediately crash
            await new Promise((r) => setTimeout(r, 500));
            healthy = (serviceSession.status as string) !== 'FAILED';
          }

          if (healthy && serviceSession.status === 'STARTING') {
            serviceSession.status = 'RUNNING';
            this.notifyStatus(serviceSession, profile.projectId, runSession.id);
          } else if (!healthy && serviceSession.status === 'STARTING') {
            serviceSession.status = 'DEGRADED';
            failedServiceIds.add(service.id);
            this.notifyStatus(serviceSession, profile.projectId, runSession.id);
          }
        }

        return serviceSession;
      });

      const results = await Promise.allSettled(servicePromises);

      // Check failure policy rollback
      const anyFailed = portPreparationFailed || results.some(
        (r) => r.status === 'rejected' || (r.status === 'fulfilled' && r.value.status === 'FAILED')
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
        await this.stopSession(runSession.id);
        runSession.status = 'FAILED';
        return;
      }
    }

    const hasUsableService = runSession.services.some((service) =>
      ['STARTING', 'RUNNING', 'DEGRADED'].includes(service.status)
    );
    runSession.status = hasUsableService ? 'RUNNING' : 'FAILED';
  }

  async stopSession(runSessionId: string): Promise<void> {
    const session = this.activeSessions.get(runSessionId);
    if (!session) return;

    session.status = 'STOPPING';

    const promises = session.services.map(async (s) => {
      await this.processManager.stopService(s.id);
      s.status = 'STOPPED';
      this.notifyStatus(s, session.projectId, runSessionId);
    });

    await Promise.allSettled(promises);
    session.status = 'STOPPED';
    session.stoppedAt = new Date().toISOString();
  }

  async stopService(serviceSessionId: string): Promise<void> {
    await this.processManager.stopService(serviceSessionId);
    for (const session of this.activeSessions.values()) {
      const s = session.services.find((x) => x.id === serviceSessionId);
      if (s) {
        s.status = 'STOPPED';
        this.notifyStatus(s, session.projectId, session.id);
        break;
      }
    }
  }

  async restartService(serviceSessionId: string): Promise<ServiceSession> {
    const newSession = await this.processManager.restartService(serviceSessionId);
    for (const session of this.activeSessions.values()) {
      const idx = session.services.findIndex((x) => x.id === serviceSessionId);
      if (idx >= 0) {
        session.services[idx] = newSession;
        this.notifyStatus(newSession, session.projectId, session.id);
        break;
      }
    }
    return newSession;
  }

  async stopAll(): Promise<void> {
    await this.processManager.stopAll();
    for (const session of this.activeSessions.values()) {
      session.status = 'STOPPED';
      session.stoppedAt = new Date().toISOString();
      for (const s of session.services) {
        s.status = 'STOPPED';
        this.notifyStatus(s, session.projectId, session.id);
      }
    }
    this.activeSessions.clear();
  }

  getActiveSessions(): RunSession[] {
    return Array.from(this.activeSessions.values()).filter(
      (s) => s.status === 'RUNNING' || s.status === 'STARTING'
    );
  }

  getSession(runSessionId: string): RunSession | undefined {
    return this.activeSessions.get(runSessionId);
  }

  private notifyStatus(session: ServiceSession, projectId: string, runSessionId: string): void {
    for (const listener of this.statusListeners) {
      try {
        listener(session, projectId, runSessionId);
      } catch (err) {
        console.error('Status listener error:', err);
      }
    }
  }
}
