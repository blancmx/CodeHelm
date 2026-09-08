import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { SCHEMA_SQL, ProfileRepository, ProjectRepository, SessionRepository } from '@codehelm/database';
import { IpcChannels, type RunProfileDto } from '@codehelm/contracts';
import { registerProfileHandlers } from '../profile-handlers.js';
import { decryptProfileSecrets } from '../profile-secrets.js';
import type { RegisterIpcHandler } from '../trusted-ipc.js';
vi.mock('electron', () => ({ safeStorage: { isEncryptionAvailable: () => true, encryptString: (v: string) => Buffer.from(v), decryptString: (v: Buffer) => v.toString() } }));
let db: Database.Database, projectId: string, profile: RunProfileDto;
let handlers: Map<string, (...args: any[]) => any>;
let busy = false;
const invoke = (channel: string, ...args: unknown[]) => handlers.get(channel)!({}, ...args);
beforeEach(async () => {
  db = new Database(':memory:'); db.pragma('foreign_keys = ON'); db.exec(SCHEMA_SQL);
  projectId = new ProjectRepository(db).create({ name: 'fixture', rootPath: '/fixture', tags: [] }).id;
  handlers = new Map(); busy = false;
  registerProfileHandlers(((channel, handler) => handlers.set(channel, handler)) as RegisterIpcHandler, db, () => { if (busy) throw new Error('busy'); });
  profile = await invoke(IpcChannels.PROFILES_SAVE, { projectId, name: 'Original', isDefault: true, failurePolicy: 'block_dependents', services: [
    { id: 'db', runProfileId: '', name: 'Database', type: 'auxiliary', moduleRelativePath: '.', executable: 'node', args: ['db.js'], cwdRelative: '.', env: [{ key: 'TOKEN', value: 'secret-value', isSecret: true, required: true }], dependsOn: [], enabled: true, source: 'manual' },
    { id: 'api', runProfileId: '', name: 'API', type: 'backend', moduleRelativePath: '.', executable: 'node', args: ['api.js'], cwdRelative: '.', env: [], dependsOn: ['db'], enabled: true, source: 'manual' },
  ] });
});
afterEach(() => db.close());
describe('run profile management', () => {
  it('copies independent service identities and dependencies without exposing secrets or approvals', async () => {
    const copied: RunProfileDto = await invoke(IpcChannels.PROFILES_COPY, profile.id, 'Copy');
    expect(copied.id).not.toBe(profile.id);
    expect(copied.isDefault).toBe(false);
    expect(copied.userConfirmedAt).toBeUndefined();
    expect(copied.services[1].dependsOn).toEqual([copied.services[0].id]);
    expect(copied.services.every(s => s.runProfileId === copied.id && !['db', 'api'].includes(s.id))).toBe(true);
    expect(JSON.stringify(copied)).not.toContain('secret-value');
    const repo = new ProfileRepository(db);
    expect(decryptProfileSecrets(repo.findById(copied.id)!).services[0].env[0].value).toBe('secret-value');
    copied.services[0].args = ['other.js'];
    await invoke(IpcChannels.PROFILES_SAVE, copied);
    expect(repo.findById(profile.id)!.services[0].args).toEqual(['db.js']);
    expect(decryptProfileSecrets(repo.findById(copied.id)!).services[0].env[0].value).toBe('secret-value');
  });
  it('keeps one default and retains historical names across rename and deletion', async () => {
    const copied = await invoke(IpcChannels.PROFILES_COPY, profile.id, 'Copy');
    const third = await invoke(IpcChannels.PROFILES_COPY, profile.id, 'Third');
    await invoke(IpcChannels.PROFILES_SAVE, { ...copied, isDefault: true });
    await invoke(IpcChannels.PROFILES_SAVE, { ...third, isDefault: true });
    expect(new ProfileRepository(db).findByProjectId(projectId).filter(p => p.isDefault).map(p => p.id)).toEqual([third.id]);
    const history = new SessionRepository(db), runId = crypto.randomUUID();
    history.save({ id: runId, projectId, runProfileId: profile.id, profileName: profile.name, profileUpdatedAt: profile.updatedAt, status: 'STOPPED', services: [], startedAt: new Date().toISOString() });
    await invoke(IpcChannels.PROFILES_SAVE, { ...profile, name: 'Renamed' });
    await invoke(IpcChannels.PROFILES_REMOVE, profile.id);
    expect(history.findById(runId)?.profileName).toBe('Original');
    expect(await invoke(IpcChannels.PROFILES_GET, profile.id)).toBeNull();
    await expect(invoke(IpcChannels.PROFILES_SAVE, profile)).rejects.toThrow('已删除');
    await invoke(IpcChannels.PROFILES_REMOVE, third.id);
    expect(new ProfileRepository(db).findByProjectId(projectId)[0].isDefault).toBe(true);
  });
  it('rejects missing, disabled and cyclic dependencies atomically', async () => {
    for (const kind of ['missing', 'disabled', 'cycle', 'duplicate']) {
      const input = structuredClone(profile);
      if (kind === 'missing') input.services[1].dependsOn = ['unknown'];
      if (kind === 'disabled') input.services[0].enabled = false;
      if (kind === 'cycle') input.services[0].dependsOn = ['api'];
      if (kind === 'duplicate') input.services[1].id = 'db';
      await expect(invoke(IpcChannels.PROFILES_SAVE, input)).rejects.toThrow();
      expect((await invoke(IpcChannels.PROFILES_GET, profile.id)).services).toEqual(profile.services);
    }
  });
  it('blocks pending executions, live sessions and unresolved process ownership', async () => {
    busy = true;
    await expect(invoke(IpcChannels.PROFILES_REMOVE, profile.id)).rejects.toThrow('busy');
    busy = false;
    const history = new SessionRepository(db), runId = crypto.randomUUID();
    history.save({ id: runId, projectId, runProfileId: profile.id, status: 'RUNNING', startedAt: new Date().toISOString(), services: [] });
    await expect(invoke(IpcChannels.PROFILES_REMOVE, profile.id)).rejects.toThrow('活动');
    history.save({ id: runId, projectId, runProfileId: profile.id, status: 'INTERRUPTED', startedAt: new Date().toISOString(), services: [
      { id: 'orphan', runSessionId: runId, serviceConfigId: 'db', serviceName: 'DB', serviceType: 'auxiliary', status: 'ORPHANED' },
    ] });
    await expect(invoke(IpcChannels.PROFILES_REMOVE, profile.id)).rejects.toThrow('待核验');
  });
});
