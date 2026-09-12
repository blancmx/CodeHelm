import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { ProfileRepository, ProjectRepository, SCHEMA_SQL } from '@codehelm/database';
import { IpcChannels } from '@codehelm/contracts';
import type { RunProfile } from '@codehelm/domain';
import { exportProfileTemplate, inspectProfileTemplate, registerProfileTransferHandlers } from '../profile-transfer.js';
import { decryptProfileSecrets } from '../profile-secrets.js';
import type { RegisterIpcHandler } from '../trusted-ipc.js';
vi.mock('electron', () => ({ safeStorage: { isEncryptionAvailable: () => true, encryptString: (v: string) => Buffer.from(v), decryptString: (v: Buffer) => v.toString() } }));
let root: string, db: Database.Database, projectId: string, original: RunProfile;
let handlers: Map<string, (...args: any[]) => any>;
const invoke = (channel: string, ...args: unknown[]) => handlers.get(channel)!({ sender: { id: 1 } }, ...args);
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'codehelm-transfer-'));
  db = new Database(':memory:'); db.pragma('foreign_keys = ON'); db.exec(SCHEMA_SQL);
  projectId = new ProjectRepository(db).create({ name: '目标项目', rootPath: root, tags: [] }).id;
  original = new ProfileRepository(db).save({ projectId, name: 'Original', isDefault: true, failurePolicy: 'block_dependents', userConfirmedAt: 'before', services: [
    { id: 'db', runProfileId: '', name: 'Database', type: 'auxiliary', moduleRelativePath: '.', executable: 'node', args: ['db.js', '--token=private-inline'], cwdRelative: '.', env: [{ key: 'TOKEN', value: 'private-secret', isSecret: true }], dependsOn: [], enabled: true, source: 'manual' },
    { id: 'api', runProfileId: '', name: 'API', type: 'backend', moduleRelativePath: '.', executable: 'node', args: ['api.js'], cwdRelative: '.', env: [], dependsOn: ['db'], enabled: true, source: 'manual', healthCheck: { type: 'http', httpPath: '/ready?token=private-http', port: 3000 } },
  ] });
  handlers = new Map(); registerProfileTransferHandlers(((channel, handler) => handlers.set(channel, handler)) as RegisterIpcHandler, db);
});
afterEach(() => {
  vi.useRealTimers(); db.close();
  const resolved = path.resolve(root), temp = path.resolve(os.tmpdir());
  if (path.dirname(resolved) !== temp || !path.basename(resolved).startsWith('codehelm-transfer-')) throw new Error('unsafe cleanup');
  fs.rmSync(resolved, { recursive: true, force: true });
});
function input() {
  return { projectId, name: 'Imported', text: exportProfileTemplate(original), values: {
    SERVICE_1_ARG_1: 'db.js', SERVICE_1_ARG_2: '--token=private-inline', SERVICE_1_ENV_1: 'private-secret',
    SERVICE_2_ARG_1: 'api.js', SERVICE_2_HTTP_PATH: '/ready?token=private-http',
  } };
}
it('exports no runtime values, machine roots, identities, history or execution approvals', () => {
  const text = exportProfileTemplate(original);
  for (const secret of ['private-inline', 'private-secret', 'private-http', root, original.id, projectId, 'userConfirmedAt', 'createdAt']) expect(text).not.toContain(secret);
  expect(inspectProfileTemplate(text).variables).toHaveLength(5);
});
it('round-trips service structure with explicit variables and independent IDs, keeping originals unchanged', async () => {
  const preview = await invoke(IpcChannels.PROFILES_PREVIEW_IMPORT, input());
  expect(JSON.stringify(preview)).not.toContain('private-');
  expect(new ProfileRepository(db).findByProjectId(projectId)).toHaveLength(1);
  const imported = await invoke(IpcChannels.PROFILES_IMPORT_TEMPLATE, preview.token);
  const stored = decryptProfileSecrets(new ProfileRepository(db).findById(imported.id)!);
  expect(stored.id).not.toBe(original.id); expect(stored.userConfirmedAt).toBeUndefined(); expect(stored.isDefault).toBe(false);
  expect(stored.services[1].dependsOn).toEqual([stored.services[0].id]);
  expect(stored.services[0].args).toEqual(original.services[0].args);
  expect(stored.services[1].healthCheck).toEqual(original.services[1].healthCheck);
  expect(stored.services[0].env[0].value).toBe('private-secret');
  expect(JSON.stringify(imported)).not.toContain('private-secret');
  expect(new ProfileRepository(db).findById(original.id)).toEqual(original);
  await expect(invoke(IpcChannels.PROFILES_IMPORT_TEMPLATE, preview.token)).rejects.toThrow('过期');
});
it('rejects unknown formats, oversized JSON, traversal and dependency corruption', () => {
  const template = inspectProfileTemplate(input().text).template;
  expect(() => inspectProfileTemplate(' '.repeat(262145))).toThrow();
  for (const mutate of [
    (t: any) => t.version = 2,
    (t: any) => t.userConfirmedAt = 'trusted',
    (t: any) => t.services[0].cwdRelative = '../outside',
    (t: any) => t.services[0].moduleRelativePath = 'C:/private',
    (t: any) => t.services[0].args = ['--file=C:\\private'],
    (t: any) => t.services[0].dependsOn = ['service_2'],
    (t: any) => t.services[1].dependsOn = ['missing'],
    (t: any) => t.services[1].id = 'service_1',
  ]) { const changed = structuredClone(template); mutate(changed); expect(() => inspectProfileTemplate(JSON.stringify(changed))).toThrow(); }
});
it('rejects missing variables, duplicate names, unavailable paths and foreign renderer tokens', async () => {
  await expect(invoke(IpcChannels.PROFILES_PREVIEW_IMPORT, { ...input(), values: {} })).rejects.toThrow('补齐');
  await expect(invoke(IpcChannels.PROFILES_PREVIEW_IMPORT, { ...input(), name: 'Original' })).rejects.toThrow('名称');
  const changed = inspectProfileTemplate(input().text).template; changed.services[0].cwdRelative = 'missing';
  await expect(invoke(IpcChannels.PROFILES_PREVIEW_IMPORT, { ...input(), text: JSON.stringify(changed) })).rejects.toThrow();
  const preview = await invoke(IpcChannels.PROFILES_PREVIEW_IMPORT, input());
  await expect(handlers.get(IpcChannels.PROFILES_IMPORT_TEMPLATE)!({ sender: { id: 2 } }, preview.token)).rejects.toThrow('过期');
  expect(new ProfileRepository(db).findByProjectId(projectId)).toHaveLength(1);
});
it('rechecks paths after variable substitution and rejects undeclared or recursive variables', async () => {
  for (const invalid of ['../outside.js', 'C:/private.js', '--file=C:/private.js', '{{ANOTHER}}']) {
    const changed = input(); changed.values.SERVICE_1_ARG_1 = invalid;
    await expect(invoke(IpcChannels.PROFILES_PREVIEW_IMPORT, changed)).rejects.toThrow();
  }
  await expect(invoke(IpcChannels.PROFILES_PREVIEW_IMPORT, { ...input(), values: { ...input().values, UNKNOWN: 'value' } })).rejects.toThrow('未声明');
  expect(new ProfileRepository(db).findByProjectId(projectId)).toHaveLength(1);
});
it('does not overwrite a name created after the preview', async () => {
  const preview = await invoke(IpcChannels.PROFILES_PREVIEW_IMPORT, input());
  const existing = new ProfileRepository(db).save({ projectId, name: 'Imported', isDefault: false, failurePolicy: 'continue', services: [] });
  await expect(invoke(IpcChannels.PROFILES_IMPORT_TEMPLATE, preview.token)).rejects.toThrow('名称');
  expect(new ProfileRepository(db).findById(existing.id)?.services).toEqual([]);
});
it('rejects directory junction escapes and rechecks directories after preview', async () => {
  fs.mkdirSync(path.join(root, 'local')); fs.symlinkSync(os.tmpdir(), path.join(root, 'outside'), 'junction');
  const changed = inspectProfileTemplate(input().text).template; changed.services[0].cwdRelative = 'outside';
  await expect(invoke(IpcChannels.PROFILES_PREVIEW_IMPORT, { ...input(), text: JSON.stringify(changed) })).rejects.toThrow('越界');
  changed.services[0].cwdRelative = 'local';
  const preview = await invoke(IpcChannels.PROFILES_PREVIEW_IMPORT, { ...input(), text: JSON.stringify(changed) });
  fs.renameSync(path.join(root, 'local'), path.join(root, 'moved'));
  await expect(invoke(IpcChannels.PROFILES_IMPORT_TEMPLATE, preview.token)).rejects.toThrow();
  expect(new ProfileRepository(db).findByProjectId(projectId)).toHaveLength(1);
});
it('expires previews without writing any configuration', async () => {
  const preview = await invoke(IpcChannels.PROFILES_PREVIEW_IMPORT, input());
  vi.useFakeTimers(); vi.setSystemTime(Date.now() + 300001);
  await expect(invoke(IpcChannels.PROFILES_IMPORT_TEMPLATE, preview.token)).rejects.toThrow('过期');
  expect(new ProfileRepository(db).findByProjectId(projectId)).toHaveLength(1);
});
