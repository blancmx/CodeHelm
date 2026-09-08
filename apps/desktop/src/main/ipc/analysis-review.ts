import { createHmac, randomBytes } from 'node:crypto';
import { z } from 'zod';
import type { Database as DatabaseInstance } from 'better-sqlite3';
import { AnalysisRepository, ProjectRepository, ProfileRepository } from '@codehelm/database';
import type { ProjectModule } from '@codehelm/domain';
import { IpcChannels, type AnalysisReviewDto } from '@codehelm/contracts';
import type { RegisterIpcHandler } from './trusted-ipc.js';
import { prepareAutoDetectedProfile, AUTO_PROFILE_NAME } from './auto-profile.js';
import { getPersistentPortAllocator } from './persistent-port-allocator.js';

const summarize = (module?: ProjectModule) => module ? [
  `模块类型：${module.moduleType}`,
  `技术栈：${module.technologies.map(item => `${item.name}${item.versionRange ? ` ${item.versionRange}` : ''}`).sort().join('、') || '未识别'}`,
  `建议命令：${(module.suggestedCommands ?? []).map(item => `${item.executable} ${item.args.join(' ')}（${item.source}）`).sort().join('；') || '无'}`,
].join('\n') : '无此模块';

export function registerAnalysisReview(handle: RegisterIpcHandler, db: DatabaseInstance) {
  const snapshots = new AnalysisRepository(db), profiles = new ProfileRepository(db), projects = new ProjectRepository(db);
  const key = randomBytes(32);
  const pending = new Map<string, { token: string; expires: number; owner: number; fingerprint: string }>();
  const fingerprint = (id: string) => createHmac('sha256', key).update(JSON.stringify({ project: projects.findById(id),
    snapshot: snapshots.findLatestByProjectId(id), profiles: profiles.findByProjectId(id) })).digest('hex');
  handle(IpcChannels.ANALYSIS_REVIEW, (event, rawId: unknown): AnalysisReviewDto => {
    const id = z.string().uuid().parse(rawId);
    const current = snapshots.findLatestByProjectId(id);
    if (!current || current.status !== 'completed') throw new Error('尚无成功分析结果');
    const previous = snapshots.findPreviousByProjectId(id, current.id);
    const before = new Map(previous?.modules.map(item => [item.relativePath, item]) ?? []);
    const after = new Map(current.modules.map(item => [item.relativePath, item]));
    const changes = [...new Set([...before.keys(), ...after.keys()])].map(modulePath => ({ modulePath,
      before: summarize(before.get(modulePath)), after: summarize(after.get(modulePath)) })).filter(item => item.before !== item.after);
    const token = randomBytes(32).toString('hex');
    if (pending.size >= 100) pending.delete(pending.keys().next().value!);
    pending.set(id, { token, expires: Date.now() + 60_000, owner: event.sender.id, fingerprint: fingerprint(id) });
    return { token, snapshotId: current.id, previousAt: previous?.completedAt, currentAt: current.completedAt ?? current.startedAt,
      changes, canApply: profiles.findByProjectId(id).some(profile => profile.name === AUTO_PROFILE_NAME) };
  });
  handle(IpcChannels.ANALYSIS_APPLY, async (event, rawId: unknown, rawToken: unknown) => {
    const id = z.string().uuid().parse(rawId), token = z.string().length(64).parse(rawToken);
    const approval = pending.get(id);
    if (!approval || approval.owner !== event.sender.id || approval.token !== token || approval.expires <= Date.now() || approval.fingerprint !== fingerprint(id)) throw new Error('分析或配置已变化，或预览已过期，请重新查看差异');
    pending.delete(id);
    const snapshot = snapshots.findLatestByProjectId(id)!;
    const save = await prepareAutoDetectedProfile(profiles, id, snapshot, getPersistentPortAllocator(db));
    if (approval.expires <= Date.now() || event.sender.isDestroyed?.() || approval.fingerprint !== fingerprint(id)) throw new Error('配置已变化，请重新查看差异');
    save();
  });
}
