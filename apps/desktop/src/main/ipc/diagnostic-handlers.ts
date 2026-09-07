import type { Database as DatabaseInstance } from 'better-sqlite3';
import { ProfileRepository, ProjectRepository } from '@codehelm/database';
import { DiagnoseProfileInputSchema, IpcChannels, ProfileDiagnosticsDtoSchema } from '@codehelm/contracts';
import type { RegisterIpcHandler } from './trusted-ipc.js';
import { decryptProfileSecrets } from './profile-secrets.js';
import { diagnoseProfile } from './profile-diagnostics.js';

export function registerDiagnosticHandlers(handle: RegisterIpcHandler, db: DatabaseInstance) {
  const profiles = new ProfileRepository(db);
  const projects = new ProjectRepository(db);
  handle(IpcChannels.RUNNER_DIAGNOSE, async (_event, rawInput: unknown) => {
    const parsed = DiagnoseProfileInputSchema.safeParse(rawInput);
    if (!parsed.success) throw new Error('诊断请求无效，请重新选择启动方案。');
    const profile = profiles.findById(parsed.data.profileId);
    if (!profile) throw new Error('启动方案不存在，请刷新项目后重试。');
    const project = projects.findById(profile.projectId);
    if (!project) throw new Error('启动方案对应的项目不存在。');
    try {
      // Read only: do not call protectStoredProfile/save or migrate legacy rows.
      const report = await diagnoseProfile(project.rootPath, decryptProfileSecrets(profile));
      if (JSON.stringify(profiles.findById(profile.id)) !== JSON.stringify(profile)
        || projects.findById(profile.projectId)?.rootPath !== project.rootPath) {
        throw new Error('Diagnostic inputs changed');
      }
      return ProfileDiagnosticsDtoSchema.parse(report);
    } catch {
      // Never send raw filesystem, environment, or decryption errors over IPC.
      throw new Error('环境检查未完成：可能超时、检查繁忙、方案已变化或秘密变量无法读取。请刷新后重试，必要时重新设置秘密变量。');
    }
  });
}
