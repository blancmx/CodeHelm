import { BrowserWindow, dialog } from 'electron';
import type { Database as DatabaseInstance } from 'better-sqlite3';
import { ProfileRepository, ProjectRepository } from '@codehelm/database';
import { IpcChannels, RuntimeProbeInputSchema } from '@codehelm/contracts';
import type { RegisterIpcHandler } from './trusted-ipc.js';
import { probeConfirmedRuntime, runtimeArguments } from './runtime-probe.js';
import { matchRuntimeToProfile } from './runtime-version-match.js';
import { rememberRuntimeEvidence } from './runtime-evidence.js';
import { decryptProfileSecrets } from './profile-secrets.js';

export function registerRuntimeProbeHandlers(handle: RegisterIpcHandler, db: DatabaseInstance) {
  const profiles = new ProfileRepository(db);
  const projects = new ProjectRepository(db);
  let busy = false;
  handle(IpcChannels.RUNNER_PROBE_RUNTIME, async (event, input: unknown) => {
    const parsed = RuntimeProbeInputSchema.safeParse(input);
    if (!parsed.success) throw new Error('版本检查请求无效。');
    const owner = BrowserWindow.fromWebContents(event.sender);
    const profile = profiles.findById(parsed.data.profileId);
    const project = profile && projects.findById(profile.projectId);
    if (!owner || !profile || !project || busy) throw new Error('版本检查不可用或已有检查进行中。');
    busy = true;
    const controller = new AbortController();
    const abort = () => controller.abort();
    const unchanged = () => {
      controller.signal.throwIfAborted();
      if (JSON.stringify(profiles.findById(profile.id)) !== JSON.stringify(profile)
        || projects.findById(project.id)?.rootPath !== project.rootPath) throw new Error('Changed profile');
    };
    owner.once('closed', abort);
    event.sender.on('did-start-navigation', abort);
    event.sender.once('render-process-gone', abort);
    try {
      const { family } = parsed.data;
      const selection = await dialog.showOpenDialog(owner, {
        title: `选择可信的 ${family}.exe`, properties: ['openFile'], filters: [{ name: '运行时程序', extensions: ['exe'] }],
      });
      unchanged();
      if (selection.canceled || !selection.filePaths[0]) return null;
      const result = await probeConfirmedRuntime(selection.filePaths[0], family, project.rootPath, controller.signal, async review => {
        unchanged();
        const answer = await dialog.showMessageBox(owner, {
          type: 'warning', title: '确认单次版本检查', message: `执行 ${family} 版本检查？`,
          detail: `程序：${review.path}\n参数：${runtimeArguments[family].join(' ')}\nSHA-256：${review.sha256}\n\n仅选择你信任的本机程序。文件名和摘要不能证明程序安全。将在临时目录中执行，最长 3 秒，不携带项目环境变量。此确认仅用于本次检查，不授权项目启动。检查后仅匹配显式运行时路径及支持的 Node/Python/Java 服务清单版本声明。`,
          buttons: ['取消', '检查版本'], defaultId: 0, cancelId: 0, noLink: true,
        });
        unchanged();
        return answer.response === 1;
      });
      unchanged();
      if (result) result.services = await matchRuntimeToProfile(project.rootPath, profile, result, controller.signal);
      unchanged();
      if (result) rememberRuntimeEvidence(project.rootPath, decryptProfileSecrets(profile), result);
      return result;
    } catch {
      throw new Error('版本检查未完成：请选择项目目录外可信的对应运行时 exe 文件；检查超时、文件或方案变化时请重试。');
    } finally {
      busy = false;
      owner.removeListener('closed', abort);
      event.sender.removeListener('did-start-navigation', abort);
      event.sender.removeListener('render-process-gone', abort);
    }
  });
}
