import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SCHEMA_SQL, ProjectRepository } from '@codehelm/database';
import type { DiscoveredProjectDto } from '@codehelm/contracts';
import { WorkspaceHistory } from '../workspace-history.js';
let db: Database.Database;
beforeEach(() => { db = new Database(':memory:'); db.exec(SCHEMA_SQL); });
afterEach(() => db.close());
const candidate = { relativePath: 'app', rootPath: '/workspace/app' } as DiscoveredProjectDto;
const input = { rootPath: '/workspace', maxDepth: 2, remember: true };
const inventory = (hash: string, issues: string[] = []) => ({ files: { 'app/package.json': hash }, directories: ['.', 'app'], issues });
describe('saved workspace baselines', () => {
  it('associates physically imported projects through a saved workspace alias after reopen and rescan', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codehelm-history-alias-'));
    if (path.dirname(root) !== path.resolve(os.tmpdir()) || !path.basename(root).startsWith('codehelm-history-alias-')) throw new Error('Unsafe fixture');
    try {
      const workspace = path.join(root,'workspace'), alias = path.join(root,'alias');
      fs.mkdirSync(path.join(workspace,'app'),{recursive:true});
      fs.symlinkSync(workspace,alias,'junction');
      const history = new WorkspaceHistory(db), scan = {...input,rootPath:alias};
      history.save(scan,inventory('one'),[candidate]);
      const project = new ProjectRepository(db).create({name:'app',rootPath:fs.realpathSync.native(path.join(workspace,'app'))});
      expect(new WorkspaceHistory(db).list()[0].entries[0]).toMatchObject({projectId:project.id,status:'managed'});
      history.save(scan,inventory('two'),[candidate]);
      expect(history.list()[0].entries[0]).toMatchObject({projectId:project.id,status:'changed'});
    } finally { fs.rmSync(root,{recursive:true,force:true}); }
  });
  it('keeps content changes visible across rescans until analysis is refreshed', () => {
    const project = new ProjectRepository(db).create({ name: 'app', rootPath: candidate.rootPath, tags: [] });
    const history = new WorkspaceHistory(db);
    history.save(input, inventory('before'), [candidate]);
    expect(history.list()[0].entries[0]).toMatchObject({ status: 'managed', projectId: project.id });
    history.save(input, inventory('after'), [candidate]);
    expect(history.list()[0].entries[0]).toMatchObject({ status: 'changed', changedFiles: ['app/package.json'] });
    history.save(input, inventory('after'), [candidate]);
    expect(history.list()[0].entries[0].status).toBe('changed');
    history.save(input, inventory('after', ['app/package.json']), [candidate]);
    expect(history.list()[0].entries[0].status).toBe('unknown');
    history.save(input, inventory('after'), [candidate]);
    expect(history.list()[0].entries[0].status).toBe('changed');
    db.prepare('UPDATE projects SET last_analyzed_at = ? WHERE id = ?').run('2099-01-01T00:00:00.000Z', project.id);
    history.save(input, inventory('after'), [candidate]);
    expect(history.list()[0].entries[0].status).toBe('managed');
    expect(JSON.stringify(history.list())).not.toMatch(/baseline|pendingChanges/);
  });
  it('retains a complete baseline through partial results and saves ignore rules', () => {
    const history = new WorkspaceHistory(db);
    history.save({ ...input, ignoredPaths: ['app'] }, inventory('one'), [candidate]);
    const successful = history.list()[0].lastSuccessAt;
    history.save(input, inventory('two', ['app/package.json']), [candidate]);
    expect(history.list()[0]).toMatchObject({ lastSuccessAt: successful, ignoredPaths: ['app'], entries: [{ status: 'unknown' }] });
    history.save(input, inventory('two'), [candidate]);
    expect(history.list()[0].entries[0].changedFiles).toEqual(['app/package.json']);
    expect(new WorkspaceHistory(db).list()).toEqual(history.list());
  });
  it('starts a fresh comparison when exclusion rules change', () => {
    const history = new WorkspaceHistory(db);
    history.save(input, inventory('one'), [candidate]);
    history.save({ ...input, excludeDirs: ['archive'] }, inventory('two'), [candidate]);
    expect(history.list()[0].entries[0].changedFiles).toEqual([]);
    history.save({ ...input, excludeDirs: ['archive'] }, inventory('three'), [candidate]);
    expect(history.list()[0].entries[0].changedFiles).toEqual(['app/package.json']);
  });
});
