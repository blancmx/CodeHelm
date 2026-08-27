import type {
  ImportProjectInput,
  BatchImportInput,
  DiscoveredProjectDto,
  ProjectDto,
  ProjectSummaryDto,
  SelectedDirectoryDto,
  FileTreeNodeDto,
  ReadmeSummaryDto,
  WorkspaceScanInput,
  ProjectTaskDto,
  ProjectTaskProgressDto,
} from './dto/projects.js';
import type {
  AnalysisTaskDto,
  AnalysisSnapshotDto,
} from './dto/analysis.js';
import type {
  RunProfileDto,
  SaveRunProfileInput,
} from './dto/profiles.js';
import type {
  LogBatchDto,
  RunSessionDto,
  RunnerExecutionMode,
  ServiceStatusEventDto,
} from './dto/runner.js';
import type { AppSettingsDto, LogStorageStatusDto, LogCleanupResultDto } from './dto/settings.js';

export type Unsubscribe = () => void;

export interface CodeHelmApi {
  projects: {
    startScan(input: WorkspaceScanInput): Promise<{ taskId: string }>;
    startImport(input: BatchImportInput): Promise<{ taskId: string }>;
    getTask(taskId: string): Promise<ProjectTaskDto | null>;
    cancelTask(taskId: string): Promise<{ cancelled: boolean }>;
    onTaskProgress(listener: (event: ProjectTaskProgressDto) => void): Unsubscribe;
    selectDirectory(): Promise<SelectedDirectoryDto | null>;
    import(input: ImportProjectInput): Promise<ProjectDto>;
    batchImport(input: BatchImportInput): Promise<ProjectDto[]>;
    scanWorkspace(rootPath: string, options?: { maxDepth?: number }): Promise<DiscoveredProjectDto[]>;
    list(): Promise<ProjectSummaryDto[]>;
    get(id: string): Promise<ProjectDto | null>;
    remove(id: string): Promise<void>;
    update(id: string, patch: Partial<ProjectDto>): Promise<ProjectDto | null>;
    getFileTree(rootPath: string, options?: { maxDepth?: number }): Promise<FileTreeNodeDto[]>;
    getReadmeSummary(rootPath: string): Promise<ReadmeSummaryDto>;
  };
  analysis: {
    start(projectId: string): Promise<{ taskId: string }>;
    cancel(taskId: string): Promise<{ cancelled: boolean }>;
    getTask(projectId: string): Promise<AnalysisTaskDto | null>;
    getLatest(projectId: string): Promise<AnalysisSnapshotDto | null>;
    onProgress(listener: (event: AnalysisTaskDto) => void): Unsubscribe;
  };
  profiles: {
    save(input: SaveRunProfileInput): Promise<RunProfileDto>;
    list(projectId: string): Promise<RunProfileDto[]>;
    get(id: string): Promise<RunProfileDto | null>;
  };
  runner: {
    confirmExecution(profileId: string, mode: RunnerExecutionMode): Promise<string>;
    reuseExecutionApproval(profileId: string, mode: RunnerExecutionMode): Promise<string>;
    start(profileId: string, approvalToken: string): Promise<RunSessionDto>;
    installAndStart(profileId: string, approvalToken: string): Promise<RunSessionDto>;
    stopSession(sessionId: string): Promise<void>;
    stopService(serviceSessionId: string): Promise<void>;
    restartService(serviceSessionId: string): Promise<void>;
    onStatus(listener: (event: ServiceStatusEventDto) => void): Unsubscribe;
    onLogs(listener: (batch: LogBatchDto) => void): Unsubscribe;
  };
  settings: {
    get(): Promise<AppSettingsDto>;
    update(patch: Partial<AppSettingsDto>): Promise<AppSettingsDto>;
    getLogStatus(): Promise<LogStorageStatusDto>;
    clearLogs(): Promise<LogCleanupResultDto>;
    openLogDirectory(): Promise<void>;
  };
  window: {
    minimize(): Promise<void>;
    toggleMaximize(): Promise<boolean>;
    close(): Promise<void>;
    isMaximized(): Promise<boolean>;
    onMaximizeChange(listener: (isMaximized: boolean) => void): Unsubscribe;
  };
}

declare global {
  interface Window {
    codehelm: CodeHelmApi;
  }
}
