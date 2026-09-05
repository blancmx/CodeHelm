import type { RegisterIpcHandler } from './trusted-ipc.js';
import type { Database as DatabaseInstance } from 'better-sqlite3';
import { IpcChannels } from '@codehelm/contracts';
import { AnalysisRepository, ProjectRepository } from '@codehelm/database';
import { getAppSettings } from './app-settings.js';
import { getAnalysisTasks } from './analysis-service.js';
import type { AnalysisTasks } from './analysis-tasks.js';

export function registerAnalysisHandlers(handle: RegisterIpcHandler, db: DatabaseInstance, tasks: AnalysisTasks = getAnalysisTasks(db)) {
  const analysisRepo = new AnalysisRepository(db);
  const projectRepo = new ProjectRepository(db);
  const owners = new WeakSet<Electron.WebContents>();

  handle(IpcChannels.ANALYSIS_GET_LATEST, async (_event, projectId: string) =>
    analysisRepo.findLatestByProjectId(projectId));
  handle(IpcChannels.ANALYSIS_GET_TASK, async (_event, projectId: string) => tasks.get(projectId));
  handle(IpcChannels.ANALYSIS_START, (event, projectId: string) => {
    const project = projectRepo.findById(projectId);
    if (!project) throw new Error(`Project not found: ${projectId}`);
    const result = tasks.start(projectId, project.rootPath, getAppSettings(db).maxScanFiles);
    if (!owners.has(event.sender)) {
      owners.add(event.sender);
      event.sender.once('destroyed', () => { void tasks.stopActive(); });
    }
    return result;
  });
  handle(IpcChannels.ANALYSIS_CANCEL, (_event, taskId: string) => tasks.cancel(taskId));
}
