import { z } from 'zod';
import type { Database as DatabaseInstance } from 'better-sqlite3';
import { ProjectRepository } from '@codehelm/database';
import { IpcChannels, type GitSummaryDto } from '@codehelm/contracts';
import type { RegisterIpcHandler } from './trusted-ipc.js';
import { readGitSummary } from './git-summary.js';

export function registerGitSummaryHandlers(handle: RegisterIpcHandler, db: DatabaseInstance) {
  const projects = new ProjectRepository(db);
  const active = new Set<number>();
  handle(IpcChannels.PROJECTS_GIT_SUMMARY, async (event, rawId): Promise<GitSummaryDto> => {
    const id = z.string().uuid().parse(rawId);
    const project = projects.findById(id);
    if (!project) throw new Error('项目不存在。');
    if (active.has(event.sender.id) || active.size >= 2) return { status: 'unknown', checkedAt: new Date().toISOString(), message: '已有 Git 查询进行中，请稍后刷新。' };
    active.add(event.sender.id);
    const controller = new AbortController();
    const abort = () => controller.abort();
    event.sender.once('destroyed', abort); event.sender.on('did-start-navigation', abort);
    try {
      const result = await readGitSummary(project.rootPath, { signal: controller.signal });
      if (projects.findById(id)?.rootPath !== project.rootPath) return { status: 'unknown', checkedAt: result.checkedAt, message: '项目路径已变化，请重新刷新。' };
      return result;
    } finally {
      active.delete(event.sender.id);
      event.sender.removeListener('destroyed', abort); event.sender.removeListener('did-start-navigation', abort);
    }
  });
}
