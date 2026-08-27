import { BrowserWindow } from 'electron';
import type { Database as DatabaseInstance } from 'better-sqlite3';
import fs from 'node:fs/promises';
import path from 'node:path';
import { AnalysisRepository, ProfileRepository, ProjectRepository } from '@codehelm/database';
import { IpcChannels } from '@codehelm/contracts';
import { ProjectTasks, type WorkspaceWorkerFactory } from './project-tasks.js';
import { getAnalysisTasks } from './analysis-service.js';
import { getAppSettings } from './app-settings.js';
import type { AnalysisTasks } from './analysis-tasks.js';

const services = new WeakMap<DatabaseInstance, ProjectTasks>();

export function getProjectTasks(db: DatabaseInstance, analysis: AnalysisTasks = getAnalysisTasks(db), createWorker?: WorkspaceWorkerFactory): ProjectTasks {
  let tasks = services.get(db);
  if (tasks) return tasks;
  const projects = new ProjectRepository(db);
  const profiles = new ProfileRepository(db);
  const snapshots = new AnalysisRepository(db);
  tasks = new ProjectTasks(analysis, async (input, signal) => {
    const stat = await fs.lstat(input.rootPath);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`项目目录不可用或为链接：${input.rootPath}`);
    if (signal.aborted) throw new Error('已停止导入');
    const existing = projects.findByRootPath(input.rootPath);
    if (existing) {
      return { project: existing, needsAnalysis: !snapshots.findLatestByProjectId(existing.id) && profiles.findByProjectId(existing.id).length === 0 };
    }
    const project = projects.create({ ...input, name: input.name || path.basename(input.rootPath) });
    return { project, needsAnalysis: true };
  }, () => getAppSettings(db).maxScanFiles, (state) => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed() && !window.webContents.isDestroyed()) window.webContents.send(IpcChannels.PROJECTS_ON_TASK_PROGRESS, state);
    }
  }, createWorker);
  services.set(db, tasks);
  return tasks;
}
