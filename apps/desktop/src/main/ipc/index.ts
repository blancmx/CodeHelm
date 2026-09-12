import { registerRuntimeProbeHandlers } from './runtime-probe-handlers.js';
import type { RegisterIpcHandler } from './trusted-ipc.js';
import type { Database as DatabaseInstance } from 'better-sqlite3';
import { registerProjectHandlers } from './project-handlers.js';
import { registerGitSummaryHandlers } from './git-summary-handlers.js';
import { registerProfileHandlers } from './profile-handlers.js';
import { registerProfileTransferHandlers } from './profile-transfer.js';
import { registerDiagnosticHandlers } from './diagnostic-handlers.js';
import { registerAnalysisHandlers } from './analysis-handlers.js';
import { registerRunnerHandlers, assertProfileRemovable, invalidateProfileApproval } from './runner-handlers.js';
import { registerSettingsHandlers } from './settings-handlers.js';
import { registerHistoryHandlers } from './history-handlers.js';
import { app } from 'electron';
import { getAppSettings } from './app-settings.js';
import { LogStorage } from './log-storage.js';
import { resolveLogDirectory } from './log-directory.js';
import { getAnalysisTasks } from './analysis-service.js';
import type { AnalysisTasks } from './analysis-tasks.js';
import { getProjectTasks } from './project-task-service.js';
import type { ProjectTasks } from './project-tasks.js';

let logs: LogStorage | undefined;
let analysisTasks: AnalysisTasks | undefined;
let projectTasks: ProjectTasks | undefined;

export async function closeAnalysisTasks(): Promise<void> {
  await projectTasks?.close();
  await analysisTasks?.close();
}

export async function closeLogStorage(): Promise<void> {
  await logs?.close();
}

export { stopAllRunnerSessions } from './runner-handlers.js';

export async function registerAllIpcHandlers(db: DatabaseInstance, handle: RegisterIpcHandler) {
  analysisTasks = getAnalysisTasks(db);
  projectTasks = getProjectTasks(db, analysisTasks);
  logs = new LogStorage(resolveLogDirectory({
    isPackaged: app.isPackaged,
    appPath: app.getAppPath(),
    executablePath: app.getPath('exe'),
  }), () => getAppSettings(db));
  registerProjectHandlers(handle, db, analysisTasks, assertProfileRemovable, invalidateProfileApproval);
  registerGitSummaryHandlers(handle, db);
  registerProfileHandlers(handle, db, assertProfileRemovable);
  registerProfileTransferHandlers(handle, db);
  registerDiagnosticHandlers(handle, db);
  registerRuntimeProbeHandlers(handle, db);
  registerAnalysisHandlers(handle, db);
  await registerRunnerHandlers(handle, db, logs);
  registerSettingsHandlers(handle, db, logs);
  registerHistoryHandlers(handle, db, logs);
  logs.start();
}
