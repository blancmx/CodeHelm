import spawn from 'cross-spawn';
import type { ChildProcess } from 'node:child_process';
import type { ProcessFingerprint, ServiceConfig, ServiceSession } from '@codehelm/domain';
import { generateId, safeResolvePath } from '@codehelm/shared';
import { killProcessTree } from './tree-killer.js';
import { ProcessVerifier } from './process-verifier.js';
import { SecretRedactor } from '../logs/secret-redactor.js';

interface ActiveProcess {
  session: ServiceSession;
  config: ServiceConfig;
  projectRoot: string;
  child?: ChildProcess;
  outputClosed?: Promise<void>;
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
    const secrets = service.env.filter((v) => v.isSecret).map((v) => v.value);
    const redactError = (text: string) => {
      const redactor = new SecretRedactor(secrets);
      return redactor.write(Buffer.from(text)) + redactor.end();
    };

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
      active.outputClosed = new Promise((resolve) => child.once('close', () => resolve()));
      session.pid = child.pid;

      if (child.pid) {
        const observedStartTime = ProcessVerifier.getProcessStartTime(child.pid);
        const fingerprint: ProcessFingerprint = {
          pid: child.pid,
          startTime: observedStartTime ?? startTime,
          identityVerified: observedStartTime !== undefined,
          executable: service.executable,
          cwd,
          argsSummary: service.args.join(' '),
        };
        session.fingerprint = fingerprint;
      }

      // Hook output streams
      for (const stream of ['stdout', 'stderr'] as const) {
        const redactor = new SecretRedactor(secrets);
        const emit = (text: string) => { if (text) onLog(serviceSessionId, stream, text); };
        child[stream]?.on('data', (chunk: Buffer) => emit(redactor.write(chunk)));
        child[stream]?.once('end', () => emit(redactor.end()));
        child.once('close', () => emit(redactor.end()));
      }

      // Hook lifecycle events
      child.on('error', (err: Error) => {
        session.status = 'FAILED';
        session.errorMessage = redactError(err.message);
        session.stoppedAt = new Date().toISOString();
        onLog(serviceSessionId, 'stderr', `[Process Error] ${session.errorMessage}\n`);
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
      session.errorMessage = redactError(err.message);
      session.stoppedAt = new Date().toISOString();
      onLog(serviceSessionId, 'stderr', `[Spawn Exception] ${session.errorMessage}\n`);
      return session;
    }
  }

  async stopService(serviceSessionId: string, timeoutMs: number = 3000): Promise<void> {
    const active = this.processes.get(serviceSessionId);
    if (!active) return;

    active.session.status = 'STOPPING';

    const pid = active.session.pid;
    const child = active.child;
    const isOwnedChild = () => Boolean(
      pid
      && ProcessVerifier.isActiveChildProcess(pid, child)
      && ProcessVerifier.isFingerprintCurrent(pid, active.session.fingerprint) !== false
    );
    const canForceKill = () => Boolean(
      isOwnedChild()
      && pid
      && ProcessVerifier.isFingerprintCurrent(pid, active.session.fingerprint) === true
    );
    const isStillRunning = () => Boolean(
      pid
      && child
      && child.pid === pid
      && ProcessVerifier.isPidAlive(pid)
    );
    const fallbackKill = (signal: string) => {
      if (pid && child && ProcessVerifier.isActiveChildProcess(pid, child)) {
        child.kill(signal as NodeJS.Signals);
      }
    };

    if (pid && isOwnedChild()) {
      await killProcessTree(
        pid,
        'SIGTERM',
        timeoutMs,
        isOwnedChild,
        canForceKill,
        isStillRunning,
        fallbackKill
      );
    } else if (!pid && child && child.exitCode === null && child.signalCode === null) {
      // A child object without a live PID cannot be safely tree-killed. Let
      // Node signal only the still-owned child handle instead.
      child.kill();
    }

    if (active.outputClosed) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([
        active.outputClosed,
        new Promise<void>((resolve) => { timer = setTimeout(resolve, 1000); }),
      ]);
      clearTimeout(timer);
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
