import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import { app, BrowserWindow, dialog } from 'electron';
import type { Database } from 'better-sqlite3';
import { SessionRepository, ProfileRepository, ProjectRepository } from '@codehelm/database';
import { DiagnosticBundleInputSchema, DiagnosticBundleExportSchema, DIAGNOSTIC_BUNDLE_MAX_BYTES,
  IpcChannels, RunSessionDtoSchema, type DiagnosticBundlePreview, type StoredLogPage, type ProfileDiagnosticsDto } from '@codehelm/contracts';
import { CODEHELM_APP_VERSION } from '../app-version.js';
import { decryptProfileSecrets } from './profile-secrets.js';
import { diagnoseProfile } from './profile-diagnostics.js';
import { buildDiagnosticBundle, createBundleRedactor, serializeBundle } from './diagnostic-bundle.js';
import type { RegisterIpcHandler } from './trusted-ipc.js';

export function registerDiagnosticBundleHandlers(handle: RegisterIpcHandler, db: Database,
  readLogs: (event: Electron.IpcMainInvokeEvent, input: unknown) => Promise<StoredLogPage>) {
  const previews = new Map<number, DiagnosticBundlePreview>();
  const pending = new Map<number, { cancelled: boolean }>();
  const owners = new WeakSet<Electron.WebContents>();
  const sessions = new SessionRepository(db), profiles = new ProfileRepository(db), projects = new ProjectRepository(db);
  const cancel = (owner: number) => { previews.delete(owner); const task = pending.get(owner); if (task) task.cancelled = true; };
  handle(IpcChannels.DIAGNOSTIC_BUNDLE_CANCEL, event => cancel(event.sender.id));
  handle(IpcChannels.DIAGNOSTIC_BUNDLE_PREVIEW, async (event, raw) => {
    const input = DiagnosticBundleInputSchema.parse(raw), owner = event.sender.id;
    if (pending.has(owner) || pending.size >= 2) throw new Error('诊断包正在处理，请稍后重试。');
    for (const [id, preview] of previews) if (Date.parse(preview.expiresAt) < Date.now()) previews.delete(id);
    if (previews.size >= 10) previews.delete(previews.keys().next().value!);
    previews.delete(owner);
    const task = { cancelled: false }; pending.set(owner, task);
    if (!owners.has(event.sender)) {
      owners.add(event.sender);
      event.sender.once('destroyed', () => cancel(owner));
      event.sender.on('did-start-navigation', () => cancel(owner));
    }
    try {
      const stored = sessions.findById(input.runSessionId, 200);
      if (!stored) throw new Error('Session missing');
      const run = RunSessionDtoSchema.parse(stored);
      const profile = profiles.findById(run.runProfileId), project = projects.findById(run.projectId);
      const warnings: string[] = [];
      let report: ProfileDiagnosticsDto | undefined;
      let redact: ((text: string) => string) | undefined;
      if (profile && project && profile.projectId === run.projectId) {
        try {
          const plain = decryptProfileSecrets(profile);
          redact = createBundleRedactor([...plain.services.flatMap(service => [...service.args, ...service.env.map(entry => entry.value)]),
            ...Object.values(process.env).filter((value): value is string => !!value)],
            [project.rootPath, run.projectRootPath ?? '', app.getPath('home'), app.getPath('userData')]);
          try { report = await diagnoseProfile(project.rootPath, plain); } catch { /* Explicitly reported as unavailable below. */ }
          if (JSON.stringify(profiles.findById(profile.id)) !== JSON.stringify(profile)
            || projects.findById(project.id)?.rootPath !== project.rootPath) { report = undefined; redact = undefined; }
        } catch { warnings.push('当前方案秘密值不可读取或替换表超出预算。'); }
      }
      if (task.cancelled) throw new Error('Cancelled');
      let logs: StoredLogPage | undefined;
      try { logs = await readLogs(event, { runSessionId: input.runSessionId, from: input.from, to: input.to }); }
      catch { /* Do not expose raw filesystem error paths. */ }
      if (task.cancelled || event.sender.isDestroyed()) throw new Error('Cancelled');
      const preview = { ...buildDiagnosticBundle({ selection: input, run, version: CODEHELM_APP_VERSION, report, logs, redact, warnings }),
        token: randomUUID(), expiresAt: new Date(Date.now() + 300_000).toISOString() };
      previews.set(owner, preview);
      return preview;
    } catch {
      throw new Error('诊断包预览未完成：请求已取消、会话不可用或内容超过上限。请重新选择范围。');
    } finally { pending.delete(owner); }
  });
  handle(IpcChannels.DIAGNOSTIC_BUNDLE_EXPORT, async (event, raw) => {
    const input = DiagnosticBundleExportSchema.parse(raw), owner = event.sender.id;
    const preview = previews.get(owner);
    if (!preview || preview.token !== input.token || Date.parse(preview.expiresAt) < Date.now()) throw new Error('预览已过期，请重新生成。');
    if (pending.has(owner)) throw new Error('诊断包正在处理，请稍后重试。');
    const selected = new Set(input.selectedIds);
    if (selected.size !== input.selectedIds.length || [...selected].some(id => !preview.entries.some(entry => entry.id === id))) throw new Error('导出清单无效。');
    const text = serializeBundle(preview.entries.filter(entry => selected.has(entry.id)), preview.warnings,
      preview.entries.filter(entry => !selected.has(entry.id)).map(entry => entry.id));
    if (Buffer.byteLength(text, 'utf8') > DIAGNOSTIC_BUNDLE_MAX_BYTES) throw new Error('诊断包超过 1 MiB，请减少条目。');
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) throw new Error('应用窗口不可用。');
    const task = { cancelled: false }; pending.set(owner, task);
    try {
      const result = await dialog.showSaveDialog(window, { title: '保存已预览的脱敏诊断包', defaultPath: 'codehelm-diagnostic-bundle.json',
        filters: [{ name: 'JSON 诊断包', extensions: ['json'] }] });
      if (result.canceled || !result.filePath || task.cancelled || event.sender.isDestroyed()) return false;
      // Only main-process preview bytes are written; renderer-supplied text and paths are never accepted.
      await fs.writeFile(result.filePath, text, 'utf8');
      previews.delete(owner);
      return true;
    } catch { throw new Error('诊断包保存失败，请检查目标目录权限后重试。'); }
    finally { pending.delete(owner); }
  });
}
