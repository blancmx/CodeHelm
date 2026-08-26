import { ipcMain } from 'electron';
import type { Database as DatabaseInstance } from 'better-sqlite3';
import { IpcChannels } from '@codehelm/contracts';
import { AnalysisRepository, ProfileRepository, ProjectRepository } from '@codehelm/database';
import { AnalyzerEngine } from '@codehelm/analyzer';
import { generateId } from '@codehelm/shared';
import { upsertAutoDetectedProfile } from './auto-profile.js';

const activeAnalyzers = new Map<string, AnalyzerEngine>();

export function registerAnalysisHandlers(db: DatabaseInstance) {
  const analysisRepo = new AnalysisRepository(db);
  const projectRepo = new ProjectRepository(db);
  const profileRepo = new ProfileRepository(db);

  ipcMain.handle(IpcChannels.ANALYSIS_GET_LATEST, async (_event, projectId: string) => {
    return analysisRepo.findLatestByProjectId(projectId);
  });

  ipcMain.handle(IpcChannels.ANALYSIS_START, async (event, projectId: string) => {
    const project = projectRepo.findById(projectId);
    if (!project) {
      throw new Error(`Project not found: ${projectId}`);
    }

    const taskId = generateId();
    const analyzer = new AnalyzerEngine();
    activeAnalyzers.set(taskId, analyzer);

    try {
      const snapshot = await analyzer.analyze(project.rootPath, (percentage, stage) => {
        event.sender.send(IpcChannels.ANALYSIS_ON_PROGRESS, {
          projectId,
          taskId,
          stage,
          scannedFiles: 0,
          percentage,
        });
      });

      snapshot.projectId = projectId;
      const savedSnapshot = analysisRepo.save(snapshot);

      // Update project lastAnalyzedAt
      db.prepare('UPDATE projects SET last_analyzed_at = ? WHERE id = ?').run(
        new Date().toISOString(),
        projectId
      );

      // Refresh only the unconfirmed auto profile. Confirmed or manual profiles remain untouched.
      upsertAutoDetectedProfile(profileRepo, projectId, snapshot);

      return { taskId, snapshot: savedSnapshot };
    } finally {
      activeAnalyzers.delete(taskId);
    }
  });

  ipcMain.handle(IpcChannels.ANALYSIS_CANCEL, async (_event, taskId: string) => {
    const analyzer = activeAnalyzers.get(taskId);
    if (analyzer) {
      analyzer.cancel();
      activeAnalyzers.delete(taskId);
      return { cancelled: true };
    }
    return { cancelled: false };
  });
}
