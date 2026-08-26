import spawn from 'cross-spawn';
import type { ChildProcess } from 'node:child_process';
import type { ProcessFingerprint, ServiceConfig, ServiceSession } from '@codehelm/domain';
import { generateId, safeResolvePath } from '@codehelm/shared';
import { killProcessTree } from './tree-killer.js';

interface ActiveProcess {
  session: ServiceSession;
  config: ServiceConfig;
  projectRoot: string;
  child?: ChildProcess;
  onLog: (sessionId: string, stream: 'stdout' | 'stderr', text: string) => void;
  onExit: (sessionId: string, exitCode: number | null, signal: string | null) => void;
}

export class ProcessManager {
  private processes = new Map<string, ActiveProcess>(); // serviceSessionId -> ActiveProcess

  async startService(
    service: ServiceConfig,
    projectRoot: string,
    runSessionId: string,
    onLog: (sessionId: string, stream: 'stdout' | 'stderr', text: string) => void,
    onExit: (sessionId: string, exitCode: number | null, signal: string | null) => void
  ): Promise<ServiceSession> {
    const serviceSessionId = generateId();
    const startTime = Date.now();

    // Resolve working directory safely within projectRoot
    const cwd = service.cwdRelative
      ? safeResolvePath(projectRoot, service.cwdRelative)
      : projectRoot;

    // Merge environment variables
    const env: NodeJS.ProcessEnv = { ...process.env };
    for (const v of service.env) {
      if (v.key) {
        env[v.key] = v.value;
      }
    }

    const session: ServiceSession = {
      id: serviceSessionId,
      runSessionId,
      serviceConfigId: service.id,
      serviceName: service.name,
      serviceType: service.type,
      status: 'STARTING',
      port: service.port,
      startedAt: new Date(startTime).toISOString(),
    };

    const active: ActiveProcess = {
      session,
      config: service,
      projectRoot,
      onLog,
      onExit,
    };
    this.processes.set(serviceSessionId, active);

    try {
      const child = spawn(service.executable, service.args, {
        cwd,
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });

      active.child = child;
      session.pid = child.pid;

      if (child.pid) {
        const fingerprint: ProcessFingerprint = {
          pid: child.pid,
          startTime,
          executable: service.executable,
          cwd,
          argsSummary: service.args.join(' '),
        };
        session.fingerprint = fingerprint;
      }

      // Hook output streams
      child.stdout?.on('data', (chunk: Buffer) => {
        const text = chunk.toString('utf-8');
        onLog(serviceSessionId, 'stdout', text);
      });

      child.stderr?.on('data', (chunk: Buffer) => {
        const text = chunk.toString('utf-8');
        onLog(serviceSessionId, 'stderr', text);
      });

      // Hook lifecycle events
      child.on('error', (err: Error) => {
        session.status = 'FAILED';
        session.errorMessage = err.message;
        session.stoppedAt = new Date().toISOString();
        onLog(serviceSessionId, 'stderr', `[Process Error] ${err.message}\n`);
        onExit(serviceSessionId, null, null);
      });

      child.on('exit', (code, signal) => {
        session.status = code === 0 ? 'STOPPED' : 'FAILED';
        session.exitCode = code ?? undefined;
        session.exitSignal = signal ?? undefined;
        session.stoppedAt = new Date().toISOString();
        onExit(serviceSessionId, code, signal);
      });

      return session;
    } catch (err: any) {
      session.status = 'FAILED';
      session.errorMessage = err.message;
      session.stoppedAt = new Date().toISOString();
      onLog(serviceSessionId, 'stderr', `[Spawn Exception] ${err.message}\n`);
      return session;
    }
  }

  async stopService(serviceSessionId: string, timeoutMs: number = 3000): Promise<void> {
    const active = this.processes.get(serviceSessionId);
    if (!active) return;

    active.session.status = 'STOPPING';

    if (active.session.pid) {
      await killProcessTree(active.session.pid, 'SIGTERM', timeoutMs);
    } else if (active.child) {
      active.child.kill();
    }

    active.session.status = 'STOPPED';
    active.session.stoppedAt = new Date().toISOString();
    this.processes.delete(serviceSessionId);
  }

  async restartService(serviceSessionId: string): Promise<ServiceSession> {
    const active = this.processes.get(serviceSessionId);
    if (!active) {
      throw new Error(`Active service session not found: ${serviceSessionId}`);
    }

    await this.stopService(serviceSessionId);
    return this.startService(
      active.config,
      active.projectRoot,
      active.session.runSessionId,
      active.onLog,
      active.onExit
    );
  }

  async stopAll(): Promise<void> {
    const promises: Promise<void>[] = [];
    for (const id of this.processes.keys()) {
      promises.push(this.stopService(id, 2000));
    }
    await Promise.allSettled(promises);
  }

  getSession(serviceSessionId: string): ServiceSession | undefined {
    return this.processes.get(serviceSessionId)?.session;
  }

  getActiveCount(): number {
    return this.processes.size;
  }
}
