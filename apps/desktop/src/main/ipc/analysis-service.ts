import { BrowserWindow } from 'electron';
import type { Database as DatabaseInstance } from 'better-sqlite3';
import { AnalysisRepository, ProfileRepository, ProjectRepository } from '@codehelm/database';
import { IpcChannels } from '@codehelm/contracts';
import { AnalysisTasks, createNativeAnalysisBoundary, type AnalysisWorkerFactory } from './analysis-tasks.js';
import { prepareAutoDetectedProfile } from './auto-profile.js';
import { getPersistentPortAllocator } from './persistent-port-allocator.js';

const services = new WeakMap<DatabaseInstance, AnalysisTasks>();

export function getAnalysisTasks(db: DatabaseInstance, createWorker?: AnalysisWorkerFactory): AnalysisTasks {
  let tasks = services.get(db);
  if (tasks) return tasks;
  const snapshots = new AnalysisRepository(db);
  const projects = new ProjectRepository(db);
  const profiles = new ProfileRepository(db);
  const ports = getPersistentPortAllocator(db);
  tasks = new AnalysisTasks(async (snapshot, projectId, rootPath, signal) => {
    const saveProfile = await prepareAutoDetectedProfile(profiles, projectId, snapshot, ports);
    if (signal.aborted || projects.findById(projectId)?.rootPath !== rootPath) throw new Error('项目已关闭或路径已改变');
    snapshot.projectId = projectId;
    db.transaction(() => {
      saveProfile();
      snapshots.save(snapshot);
      db.prepare('UPDATE projects SET last_analyzed_at = ? WHERE id = ?').run(new Date().toISOString(), projectId);
    })();
  }, (state) => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed() && !window.webContents.isDestroyed()) window.webContents.send(IpcChannels.ANALYSIS_ON_PROGRESS, state);
    }
  }, createWorker, 120_000, createWorker ? (() => ({ ready: Promise.resolve(undefined), async close() {} })) : createNativeAnalysisBoundary);
  services.set(db, tasks);
  return tasks;
}
