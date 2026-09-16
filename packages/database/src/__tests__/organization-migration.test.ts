import { expect, it } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SCHEMA_SQL } from '../schema.js';
import { createDatabase, DATABASE_SCHEMA_VERSION } from '../db.js';
import { ProjectRepository } from '../repositories/project-repository.js';
import { SessionRepository } from '../repositories/session-repository.js';
it('upgrades a v3 database without losing tags/history and persists organization after restart', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(),'codehelm-organization-'));
  if(path.dirname(path.resolve(root))!==path.resolve(os.tmpdir())||!path.basename(root).startsWith('codehelm-organization-'))throw new Error('Unsafe cleanup');
  const file = path.join(root,'fixture.sqlite');
  let db = new Database(file);
  try {
    // Seed one committed legacy database, avoiding a disk flush per statement.
    db.transaction(() => {
      db.exec(SCHEMA_SQL.replace('  favorite INTEGER NOT NULL DEFAULT 0,','').replace('  archived INTEGER NOT NULL DEFAULT 0,','').replace('  project_root_path TEXT,',''));
      db.pragma('user_version=3');
      db.prepare('INSERT INTO projects(id,name,root_path,tags,created_at,updated_at) VALUES (?,?,?,?,?,?)').run('p','P','/original','["work"]','old','old');
      db.prepare('INSERT INTO run_profiles(id,project_id,name,created_at,updated_at) VALUES (?,?,?,?,?)').run('profile','p','manual','old','old');
      db.prepare('INSERT INTO run_sessions(id,project_id,run_profile_id,status,started_at) VALUES (?,?,?,?,?)').run('run','p','profile','STOPPED','old');
    })();
    db.close(); db=createDatabase(file);
    expect(db.pragma('user_version',{simple:true})).toBe(DATABASE_SCHEMA_VERSION);
    expect(new ProjectRepository(db).findById('p')).toMatchObject({favorite:false,archived:false,tags:['work']});
    expect(new SessionRepository(db).findById('run')!.projectRootPath).toBe('/original');
    db.prepare('UPDATE projects SET favorite=1,archived=1 WHERE id=?').run('p');
    db.close(); db=createDatabase(file);
    expect(new ProjectRepository(db).list()[0]).toMatchObject({favorite:true,archived:true,tags:['work']});
    expect(db.pragma('foreign_key_check')).toEqual([]);
  } finally {
    if(db.open)db.close();
    fs.rmSync(root,{recursive:true,force:true});
  }
});
