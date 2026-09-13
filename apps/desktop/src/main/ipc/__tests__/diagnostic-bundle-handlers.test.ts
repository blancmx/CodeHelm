import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import Database from 'better-sqlite3';
import { ProfileRepository, ProjectRepository, SessionRepository, SCHEMA_SQL } from '@codehelm/database';
import { IpcChannels, type StoredLogPage } from '@codehelm/contracts';
import { registerDiagnosticBundleHandlers } from '../diagnostic-bundle-handlers.js';
import { createTrustedIpcRegistrar } from '../trusted-ipc.js';

const harness = vi.hoisted(() => ({ handlers: new Map<string, (...args: any[]) => any>(), save: vi.fn(), diagnose: vi.fn() }));
vi.mock('electron', () => ({
  ipcMain: { handle: (channel: string, listener: (...args: any[]) => any) => harness.handlers.set(channel, listener) },
  app: { getPath: () => 'C:\\Users\\bundle-private-user' },
  BrowserWindow: { fromWebContents: () => ({}) }, dialog: { showSaveDialog: harness.save },
  safeStorage: { isEncryptionAvailable: () => true, encryptString: (value: string) => Buffer.from(value), decryptString: (value: Buffer) => value.toString() },
}));
vi.mock('../profile-diagnostics.js', () => ({ diagnoseProfile: harness.diagnose }));
let db: Database.Database, root: string, event: any, selection: { runSessionId: string; from: string; to: string };
let readLogs: ReturnType<typeof vi.fn<(...args: any[]) => Promise<StoredLogPage>>>;
const invoke = (channel: string, ...args: unknown[]) => harness.handlers.get(channel)!(event, ...args);
beforeEach(() => {
  harness.handlers.clear(); harness.save.mockReset(); harness.diagnose.mockReset();
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'codehelm-bundle-'));
  db = new Database(':memory:'); db.exec(SCHEMA_SQL);
  const project = new ProjectRepository(db).create({ rootPath: root, name: 'private-project-name', tags: [] });
  const profile = new ProfileRepository(db).save({ projectId: project.id, name: 'private-profile-name', isDefault: true,
    failurePolicy: 'block_dependents', services: [{ id: 'service', runProfileId: '', name: 'private-service-name', type: 'tool', moduleRelativePath: '.',
      executable: 'node', args: ['inline-secret'], cwdRelative: '.', env: [{ key: 'VALUE', value: 'known-env-secret' }], dependsOn: [], enabled: true, source: 'manual' }] });
  selection = { runSessionId: randomUUID(), from: '2026-09-12T00:00:00Z', to: '2026-09-13T00:00:00Z' };
  new SessionRepository(db).save({ id: selection.runSessionId, projectId: project.id, runProfileId: profile.id, status: 'FAILED', startedAt: selection.from, services: [] });
  harness.diagnose.mockResolvedValue({ profileId: profile.id, projectId: project.id, checkedAt: selection.to, checks: [{ code: 'INPUT_MISSING', status: 'blocked', detail: 'private-diagnostic-detail' }] });
  readLogs = vi.fn(async () => ({ entries: [{ id: 'log', serviceSessionId: 's', serviceName: 'private-service-name', timestamp: selection.from, stream: 'stderr', message: `failure known-env-secret inline-secret ${root}` }],
    snapshotAt: selection.to, scannedBytes: 100, skippedRecords: 0, missingFiles: 0, truncatedEntries: 0, fileLimitReached: false, retentionDays: 14, retentionMb: 500, droppedEntries: 0 } as StoredLogPage));
  const frame = { url: 'http://localhost:15173/#/settings', detached: false };
  const sender = Object.assign(new EventEmitter(), { id: 1, mainFrame: frame, getURL: () => frame.url, isDestroyed: () => false });
  event = { sender, senderFrame: frame };
  const handle = createTrustedIpcRegistrar(() => ({ window: { webContents: sender, isDestroyed: () => false } as any, renderer: { kind: 'dev', origin: 'http://localhost:15173' } }));
  registerDiagnosticBundleHandlers(handle, db, readLogs);
});
afterEach(() => {
  vi.restoreAllMocks(); db.close();
  if (path.dirname(path.resolve(root)) !== path.resolve(os.tmpdir()) || !path.basename(root).startsWith('codehelm-bundle-')) throw new Error('Unsafe cleanup');
  fs.rmSync(root, { recursive: true, force: true });
});
it('writes only selected frozen preview entries, with no raw credentials, names or diagnostic details', async () => {
  const preview = await invoke(IpcChannels.DIAGNOSTIC_BUNDLE_PREVIEW, selection);
  const text = JSON.stringify(preview);
  for (const value of ['known-env-secret', 'inline-secret', 'private-project-name', 'private-diagnostic-detail', root]) expect(text).not.toContain(value);
  expect(readLogs).toHaveBeenCalledWith(event, selection);
  const destination = path.join(root, 'bundle.json'); harness.save.mockResolvedValue({ canceled: false, filePath: destination });
  readLogs.mockRejectedValue(new Error('Must not read again'));
  expect(await invoke(IpcChannels.DIAGNOSTIC_BUNDLE_EXPORT, { token: preview.token, selectedIds: ['application', 'session'] })).toBe(true);
  const saved = JSON.parse(fs.readFileSync(destination, 'utf8'));
  expect(saved.entries).toEqual(preview.entries.filter((entry: any) => ['application', 'session'].includes(entry.id)));
  expect(saved.manifest.excludedIds).toContain('log-1'); expect(readLogs).toHaveBeenCalledOnce();
  await expect(invoke(IpcChannels.DIAGNOSTIC_BUNDLE_EXPORT, { token: preview.token, selectedIds: ['session'] })).rejects.toThrow('过期');
});
it('does not write when the save dialog or the application preview is cancelled', async () => {
  const preview = await invoke(IpcChannels.DIAGNOSTIC_BUNDLE_PREVIEW, selection);
  const destination = path.join(root, 'cancelled.json');
  harness.save.mockResolvedValueOnce({ canceled: true, filePath: destination });
  expect(await invoke(IpcChannels.DIAGNOSTIC_BUNDLE_EXPORT, { token: preview.token, selectedIds: ['session'] })).toBe(false);
  expect(fs.existsSync(destination)).toBe(false);
  let resolve!: (value: unknown) => void;
  harness.save.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  const saving = invoke(IpcChannels.DIAGNOSTIC_BUNDLE_EXPORT, { token: preview.token, selectedIds: ['session'] });
  await invoke(IpcChannels.DIAGNOSTIC_BUNDLE_CANCEL);
  resolve({ canceled: false, filePath: destination });
  expect(await saving).toBe(false); expect(fs.existsSync(destination)).toBe(false);
});
it('rejects foreign callers, forged entries, expired tokens and navigation-invalidated previews', async () => {
  const preview = await invoke(IpcChannels.DIAGNOSTIC_BUNDLE_PREVIEW, selection);
  expect(() => harness.handlers.get(IpcChannels.DIAGNOSTIC_BUNDLE_EXPORT)!({ ...event, sender: { id: 2 } }, { token: preview.token, selectedIds: ['session'] })).toThrow();
  await expect(invoke(IpcChannels.DIAGNOSTIC_BUNDLE_EXPORT, { token: preview.token, selectedIds: ['forged'] })).rejects.toThrow('清单');
  const now = Date.now(); vi.spyOn(Date, 'now').mockReturnValue(now + 301000);
  await expect(invoke(IpcChannels.DIAGNOSTIC_BUNDLE_EXPORT, { token: preview.token, selectedIds: ['session'] })).rejects.toThrow('过期');
  vi.restoreAllMocks();
  const next = await invoke(IpcChannels.DIAGNOSTIC_BUNDLE_PREVIEW, selection);
  event.sender.emit('did-start-navigation');
  await expect(invoke(IpcChannels.DIAGNOSTIC_BUNDLE_EXPORT, { token: next.token, selectedIds: ['session'] })).rejects.toThrow('过期');
  expect(harness.save).not.toHaveBeenCalled();
});
it('drops a cancelled in-flight preview and reports unreadable log coverage without leaking paths', async () => {
  let resolve!: (value: StoredLogPage) => void;
  readLogs.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  const preparing = invoke(IpcChannels.DIAGNOSTIC_BUNDLE_PREVIEW, selection);
  await vi.waitFor(() => expect(resolve).toBeTypeOf('function'));
  await invoke(IpcChannels.DIAGNOSTIC_BUNDLE_CANCEL); resolve({ entries: [] } as any);
  await expect(preparing).rejects.toThrow('取消');
  readLogs.mockRejectedValueOnce(new Error('Access denied C:\\Users\\private-location'));
  const preview = await invoke(IpcChannels.DIAGNOSTIC_BUNDLE_PREVIEW, selection);
  expect(preview.warnings.some((warning: string) => warning.includes('缺失数量未知'))).toBe(true);
  expect(JSON.stringify(preview)).not.toContain('private-location');
});
