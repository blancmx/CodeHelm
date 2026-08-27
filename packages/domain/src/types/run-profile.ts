export type FailurePolicy = 'continue' | 'block_dependents' | 'rollback_all';

export type ServiceType = 'frontend' | 'backend' | 'auxiliary' | 'tool';

export interface HealthCheckConfig {
  type: 'none' | 'tcp' | 'http' | 'log_regex';
  port?: number;
  httpPath?: string;
  expectedStatus?: number;
  logRegex?: string;
  intervalMs?: number;
  timeoutMs?: number;
  retries?: number;
}

export interface ServiceEnvVar {
  key: string;
  value: string;
  isSecret?: boolean;
}

export interface ServiceConfig {
  id: string;
  runProfileId: string;
  name: string;
  type: ServiceType;
  moduleRelativePath: string;
  executable: string;
  args: string[];
  cwdRelative: string;
  env: ServiceEnvVar[];
  port?: number;
  /**
   * auto: CodeHelm may move the port when it is occupied.
   * fixed: the project has an external constraint (for example a hard-coded
   * CORS origin), so changing the port would make a seemingly healthy service
   * unusable.
   */
  portMode?: 'auto' | 'fixed';
  portExtractRegex?: string;
  healthCheck?: HealthCheckConfig;
  dependsOn: string[]; // IDs of other services
  enabled: boolean;
  source: 'detected' | 'manual';
  startTimeoutMs?: number;
  stopTimeoutMs?: number;
}

export interface RunProfile {
  id: string;
  projectId: string;
  name: string;
  description?: string;
  isDefault: boolean;
  failurePolicy: FailurePolicy;
  services: ServiceConfig[];
  userConfirmedAt?: string;
  createdAt: string;
  updatedAt: string;
}
