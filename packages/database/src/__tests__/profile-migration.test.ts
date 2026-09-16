import { expect, it } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SCHEMA_SQL } from '../schema.js';
import { createDatabase, DATABASE_SCHEMA_VERSION } from '../db.js';
import { ProfileRepository } from '../repositories/profile-repository.js';
import { SessionRepository } from '../repositories/session-repository.js';

it('migrates v2 profiles and history, repairs duplicate defaults and reopens without losing records', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codehelm-profile-migration-'));
  if (path.dirname(path.resolve(root)) !== path.resolve(os.tmpdir()) || !path.basename(root).startsWith('codehelm-profile-migration-')) throw new Error('Unsafe cleanup path');
  const file = path.join(root, 'fixture.sqlite');
  let db = new Database(file);
  try {
    // Seed one committed legacy database, avoiding a disk flush per statement.
    db.transaction(() => {
      db.exec(SCHEMA_SQL.replace('  deleted_at TEXT,', '').replace('  profile_name TEXT,', '').replace('  profile_updated_at TEXT,', ''));
      db.pragma('user_version = 2');
      db.prepare('INSERT INTO projects(id,name,root_path,created_at,updated_at) VALUES (?,?,?,?,?)').run('project', 'Project', '/fixture', 'old', 'old');
      const profile = db.prepare('INSERT INTO run_profiles(id,project_id,name,is_default,created_at,updated_at) VALUES (?,?,?,?,?,?)');
      profile.run('a', 'project', 'Original A', 1, 'old', 'old'); profile.run('b', 'project', 'B', 1, 'old', 'old');
      db.prepare('INSERT INTO run_sessions(id,project_id,run_profile_id,status,started_at) VALUES (?,?,?,?,?)').run('run', 'project', 'a', 'STOPPED', 'old');
    })();
    db.close(); db = createDatabase(file);
    expect(db.pragma('user_version', { simple: true })).toBe(DATABASE_SCHEMA_VERSION);
    expect(new ProfileRepository(db).findByProjectId('project').filter(p => p.isDefault)).toHaveLength(1);
    expect(() => db.prepare('UPDATE run_profiles SET is_default=1 WHERE id=?').run('b')).toThrow('UNIQUE');
    new ProfileRepository(db).remove('a');
    expect(new SessionRepository(db).findById('run')?.profileName).toBe('Original A');
    expect(new ProfileRepository(db).findById('b')?.isDefault).toBe(true);
    expect(db.pragma('foreign_key_check')).toEqual([]);
    db.close(); db = createDatabase(file);
    expect(new ProfileRepository(db).findByProjectId('project').map(p => p.id)).toEqual(['b']);
    expect(new SessionRepository(db).findById('run')?.profileName).toBe('Original A');
  } finally {
    if (db.open) db.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
