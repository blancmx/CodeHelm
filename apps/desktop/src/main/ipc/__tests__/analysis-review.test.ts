import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { SCHEMA_SQL, AnalysisRepository, ProfileRepository, ProjectRepository } from '@codehelm/database';
import type { AnalysisSnapshot } from '@codehelm/domain';
import { IpcChannels, type AnalysisReviewDto } from '@codehelm/contracts';
import { registerAnalysisReview } from '../analysis-review.js';
import { upsertAutoDetectedProfile } from '../auto-profile.js';
import type { RegisterIpcHandler } from '../trusted-ipc.js';
vi.mock('electron', () => ({ safeStorage: { isEncryptionAvailable: () => true, encryptString: (value: string) => Buffer.from(value), decryptString: (value: Buffer) => value.toString() } }));
vi.mock('../persistent-port-allocator.js', () => ({ getPersistentPortAllocator: () => undefined }));
let db: Database.Database;
let id: string;
let handlers: Map<string, (...args: any[]) => any>;
const event = { sender: { id: 1 } };
function snapshot(command: string, time: string): AnalysisSnapshot {
  return { id: crypto.randomUUID(), projectId: id, analyzerVersion: 'test', status: 'completed', primaryLanguage: 'JavaScript', languages: [], startedAt: time,
    modules: [{ id: crypto.randomUUID(), snapshotId: '', name: 'app', relativePath: '.', moduleType: 'tool', technologies: [], suggestedCommands: [{ name: 'dev', executable: 'node', args: [command], type: 'tool', confidence: 1, source: 'manifest' }] }] };
}
beforeEach(async () => {
  db = new Database(':memory:'); db.exec(SCHEMA_SQL);
  id = new ProjectRepository(db).create({ name: 'fixture', rootPath: '/project', tags: [] }).id;
  const first = snapshot('old.js', '2026-09-07T00:00:00Z');
  new AnalysisRepository(db).save(first);
  await upsertAutoDetectedProfile(new ProfileRepository(db), id, first);
  new AnalysisRepository(db).save(snapshot('new.js', '2026-09-08T00:00:00Z'));
  handlers = new Map();
  registerAnalysisReview(((channel, handler) => handlers.set(channel, handler)) as RegisterIpcHandler, db);
});
afterEach(() => { db.close(); vi.restoreAllMocks(); });
const review = () => handlers.get(IpcChannels.ANALYSIS_REVIEW)!(event, id) as AnalysisReviewDto;
const apply = (token: string, sender = event) => handlers.get(IpcChannels.ANALYSIS_APPLY)!(sender, id, token) as Promise<void>;
describe('explicit analysis application', () => {
  it('previews changes without writes then applies once, preserving environment values', async () => {
    const profiles = new ProfileRepository(db);
    const profile = profiles.findByProjectId(id)[0];
    profile.services[0].env = [{ key: 'TOKEN', value: 'PRIVATE_VALUE', required: true }];
    profiles.save(profile);
    const before = JSON.stringify(profiles.findByProjectId(id));
    const result = review();
    expect(result.changes[0]).toMatchObject({ before: expect.stringContaining('old.js'), after: expect.stringContaining('new.js') });
    expect(JSON.stringify(result)).not.toContain('PRIVATE_VALUE');
    expect(JSON.stringify(profiles.findByProjectId(id))).toBe(before);
    await apply(result.token);
    expect(profiles.findByProjectId(id)[0].services[0]).toMatchObject({ args: ['new.js'], env: [{ key: 'TOKEN', value: 'PRIVATE_VALUE', required: true }] });
    await expect(apply(result.token)).rejects.toThrow('重新查看');
  });
  it('rejects a different window and concurrent edits', async () => {
    const result = review();
    await expect(apply(result.token, { sender: { id: 2 } })).rejects.toThrow('重新查看');
    db.prepare('UPDATE run_profiles SET name = ? WHERE project_id = ?').run('Edited', id);
    await expect(apply(result.token)).rejects.toThrow('重新查看');
  });
  it('expires previews and preserves manually edited commands', async () => {
    const profiles = new ProfileRepository(db), profile = profiles.findByProjectId(id)[0];
    profile.services[0].source = 'manual'; profile.services[0].args = ['manual.js']; profiles.save(profile);
    const result = review();
    const now = Date.now(); vi.spyOn(Date, 'now').mockReturnValue(now + 61_000);
    await expect(apply(result.token)).rejects.toThrow('重新查看');
    vi.restoreAllMocks();
    await apply(review().token);
    expect(profiles.findByProjectId(id)[0].services[0].args).toEqual(['manual.js']);
  });
});
