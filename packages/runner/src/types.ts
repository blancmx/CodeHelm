import type {
  LogBatch,
  RunProfile,
  RunSession,
  ServiceConfig,
  ServiceSession,
} from '@codehelm/domain';

export interface ServiceExecutionPlan {
  order: ServiceConfig[][]; // Batches of services that can be started concurrently
  hasCycle: boolean;
}

export interface IProcessManager {
  startService(
    service: ServiceConfig,
    runSessionId: string,
    onLog: (sessionId: string, stream: 'stdout' | 'stderr', text: string) => void,
    onExit: (sessionId: string, exitCode: number | null, signal: string | null) => void
  ): Promise<ServiceSession>;

  stopService(serviceSessionId: string, timeoutMs?: number): Promise<void>;
  restartService(serviceSessionId: string): Promise<ServiceSession>;
  stopAll(): Promise<void>;
}

export interface IOrchestrator {
  startSession(profile: RunProfile): Promise<RunSession>;
  stopSession(sessionId: string): Promise<void>;
  getSession(sessionId: string): RunSession | undefined;
  getActiveSessions(): RunSession[];
  onStatusChange(callback: (session: ServiceSession) => void): () => void;
  onLogs(callback: (batch: LogBatch) => void): () => void;
}
