export type LogStreamType = 'stdout' | 'stderr' | 'system';

export interface LogEntry {
  id: string;
  serviceSessionId: string;
  serviceName: string;
  stream: LogStreamType;
  message: string;
  timestamp: string;
}

export interface LogBatch {
  projectId: string;
  runSessionId: string;
  entries: LogEntry[];
}
