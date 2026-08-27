export type ProcessStatus =
  | 'IDLE'
  | 'STARTING'
  | 'RUNNING'
  | 'STOPPING'
  | 'STOPPED'
  | 'DEGRADED'
  | 'FAILED'
  | 'VERIFYING'
  | 'ORPHANED';

export interface ProcessFingerprint {
  pid: number;
  startTime: number;
  /** False means the platform could not observe the creation time at spawn. */
  identityVerified?: boolean;
  executable: string;
  cwd: string;
  argsSummary: string;
}

export interface ServiceSession {
  id: string;
  runSessionId: string;
  serviceConfigId: string;
  serviceName: string;
  serviceType: string;
  status: ProcessStatus;
  pid?: number;
  fingerprint?: ProcessFingerprint;
  port?: number;
  exitCode?: number;
  exitSignal?: string;
  errorMessage?: string;
  startedAt?: string;
  stoppedAt?: string;
}

export type RunSessionStatus = 'STARTING' | 'RUNNING' | 'STOPPING' | 'STOPPED' | 'PARTIAL_FAILED' | 'FAILED';

export interface RunSession {
  id: string;
  projectId: string;
  runProfileId: string;
  status: RunSessionStatus;
  services: ServiceSession[];
  startedAt: string;
  stoppedAt?: string;
}
