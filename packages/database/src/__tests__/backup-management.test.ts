import { afterEach,beforeEach,expect,it,vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { createDatabase, DATABASE_SCHEMA_VERSION } from '../db.js';
import { BackupManager } from '../backup-management.js';
import { createVerifiedDatabaseBackup,hashFile } from '../startup-protection.js';
let root:string,db:Database.Database,manager:BackupManager;
beforeEach(()=>{
  root=fs.mkdtempSync(path.join(os.tmpdir(),'codehelm-restore-test-'));
  db=createDatabase(path.join(root,'main.sqlite'));manager=new BackupManager(path.join(root,'backups'),'0.2-test');
  db.prepare("INSERT INTO projects(id,name,root_path,created_at,updated_at) VALUES ('p','original','C:/fixture','date','date')").run();
  db.prepare("INSERT INTO app_settings VALUES ('global','original')").run();
});
afterEach(()=>{vi.restoreAllMocks();if(db.open)db.close();
  if(path.dirname(root)!==path.resolve(os.tmpdir())||!path.basename(root).startsWith('codehelm-restore-test-'))throw new Error('Unsafe fixture cleanup');
  fs.rmSync(root,{recursive:true,force:true});});
async function backup(){return createVerifiedDatabaseBackup({source:db,sourcePath:db.name,backupDirectory:manager.root,reason:'manual',appVersion:'0.2-test'});}
it('restores management data atomically and preserves the replaced data in a pinned backup',async()=>{
  db.exec("INSERT INTO run_profiles(id,project_id,name,created_at,updated_at) VALUES ('profile','p','original-profile','date','date');INSERT INTO run_sessions(id,project_id,run_profile_id,status,started_at,stopped_at) VALUES ('run','p','profile','FAILED','start','stop');INSERT INTO service_sessions(id,run_session_id,service_config_id,service_name,service_type,status,exit_code,error_message) VALUES ('service','run','config','original-service','tool','FAILED',7,'original failure')");
  const expectedHistory=db.prepare('SELECT * FROM service_sessions').all();
  const saved=await backup(),id=path.basename(path.dirname(saved.databasePath));
  db.exec("UPDATE projects SET name='new';UPDATE app_settings SET value='new';UPDATE service_sessions SET error_message='changed'");
  const preview=await manager.prepare(id);expect(preview.counts.projects).toBe(1);
  const preserved=await manager.restore(preview.token,db);
  expect(db.prepare('SELECT name FROM projects').get()).toEqual({name:'original'});
  expect(db.prepare('SELECT value FROM app_settings').get()).toEqual({value:'original'});
  expect(db.prepare('SELECT * FROM service_sessions').all()).toEqual(expectedHistory);
  expect(db.prepare('SELECT name FROM run_profiles').get()).toEqual({name:'original-profile'});
  const original=new Database(path.join(preserved,'codehelm.sqlite'),{readonly:true});
  expect(original.prepare('SELECT name FROM projects').get()).toEqual({name:'new'});original.close();
  expect((await manager.list()).find(item=>item.reason==='before-restore')?.pinned).toBe(true);
  await expect(manager.restore(preview.token,db)).rejects.toThrow('过期');
  const filename=db.name;db.close();db=createDatabase(filename);expect(db.prepare('SELECT name FROM projects').get()).toEqual({name:'original'});
});
it('rejects corrupt, changed, future-schema and migration-failing candidates without changing the source',async()=>{
  const saved=await backup(),id=path.basename(path.dirname(saved.databasePath));
  fs.appendFileSync(saved.databasePath,'corrupt');await expect(manager.prepare(id)).rejects.toThrow('校验');
  const next=await backup(),nextId=path.basename(path.dirname(next.databasePath));
  const candidate=new Database(next.databasePath);candidate.pragma('user_version=999');candidate.close();
  const meta=JSON.parse(fs.readFileSync(next.manifestPath,'utf8'));meta.schemaVersion=999;meta.sha256=await hashFile(next.databasePath);fs.writeFileSync(next.manifestPath,JSON.stringify(meta));
  await expect(manager.prepare(nextId)).rejects.toThrow('版本高于');
  const migration=await backup(),migrationId=path.basename(path.dirname(migration.databasePath));
  const broken=new Database(migration.databasePath);broken.exec('DROP INDEX idx_profiles_default;ALTER TABLE run_profiles RENAME COLUMN is_default TO wrong_column');broken.pragma('user_version=2');broken.close();
  const brokenMeta=JSON.parse(fs.readFileSync(migration.manifestPath,'utf8'));brokenMeta.schemaVersion=2;brokenMeta.bytes=fs.statSync(migration.databasePath).size;brokenMeta.sha256=await hashFile(migration.databasePath);fs.writeFileSync(migration.manifestPath,JSON.stringify(brokenMeta));
  await expect(manager.prepare(migrationId)).rejects.toThrow();
  expect(db.prepare('SELECT name FROM projects').get()).toEqual({name:'original'});
});
it('rejects insufficient space and a locked database while retaining the current data',async()=>{
  const saved=await backup(),id=path.basename(path.dirname(saved.databasePath));
  let preview=await manager.prepare(id);
  await expect(manager.restore(preview.token,db,{},async()=>0n)).rejects.toThrow('空间不足');
  preview=await manager.prepare(id);
  const other=new Database(db.name);other.exec('BEGIN IMMEDIATE');
  try {await expect(manager.restore(preview.token,db)).rejects.toThrow();}
  finally {other.exec('ROLLBACK');other.close();}
  expect(db.prepare('SELECT name FROM projects').get()).toEqual({name:'original'});
});
it('rolls back a restore insertion failure and remains readable after reopening',async()=>{
  const saved=await backup();db.exec("UPDATE projects SET name='keep';CREATE TRIGGER fail_restore BEFORE INSERT ON projects BEGIN SELECT RAISE(ABORT,'injected restore failure'); END");
  const preview=await manager.prepare(path.basename(path.dirname(saved.databasePath)));
  await expect(manager.restore(preview.token,db)).rejects.toThrow('injected');
  const filename=db.name;db.close();db=createDatabase(filename);
  expect(db.prepare('SELECT name FROM projects').get()).toEqual({name:'keep'});
  const receipt=path.join(manager.root,`.restore-${preview.token}`,'result.json');expect(JSON.parse(fs.readFileSync(receipt,'utf8')).status).toBe('failed');
});
it('does not publish an interrupted backup or prune pinned recovery points',async()=>{
  const saved=await backup();manager.pin(path.basename(path.dirname(saved.databasePath)),true);
  const sourceBackup=db.backup.bind(db);vi.spyOn(db,'backup').mockRejectedValueOnce(new Error('interrupted'));
  await expect(backup()).rejects.toThrow('interrupted');
  expect((await manager.list()).length).toBe(1);expect(fs.readdirSync(manager.root).some(id=>id.startsWith('.pending-'))).toBe(true);
  vi.mocked(db.backup).mockImplementation(sourceBackup);
  for(let i=0;i<4;i++)await createVerifiedDatabaseBackup({source:db,sourcePath:db.name,backupDirectory:manager.root,reason:'manual',policy:{maxBackups:3,minRetainedBackups:1,maxTotalBytes:1}});
  expect(fs.existsSync(saved.databasePath)).toBe(true);
});

it('preflights an older schema and clears unreadable secrets only in the candidate',async()=>{
  db.exec("INSERT INTO run_profiles(id,project_id,name,created_at,updated_at) VALUES ('profile','p','profile','date','date')");
  db.prepare("INSERT INTO service_configs(id,run_profile_id,name,type,module_relative_path,executable,cwd_relative,env_json) VALUES ('svc','profile','svc','tool','.','node','.',?)")
    .run(JSON.stringify([{key:'TOKEN',value:'foreign-machine-value',isSecret:true}]));
  const saved=await backup(),id=path.basename(path.dirname(saved.databasePath));
  const old=new Database(saved.databasePath);old.pragma('user_version=2');old.close();
  const meta=JSON.parse(fs.readFileSync(saved.manifestPath,'utf8'));meta.schemaVersion=2;meta.sha256=await hashFile(saved.databasePath);fs.writeFileSync(saved.manifestPath,JSON.stringify(meta));
  const preview=await manager.prepare(id,()=>{throw new Error('cannot decrypt');});
  expect(preview).toMatchObject({schemaVersion:2,targetSchemaVersion:DATABASE_SCHEMA_VERSION,unreadableSecrets:1});
  expect((db.prepare('SELECT env_json FROM service_configs').get() as {env_json:string}).env_json).toContain('foreign-machine-value');
  await manager.restore(preview.token,db);
  expect(JSON.parse((db.prepare('SELECT env_json FROM service_configs').get() as {env_json:string}).env_json)).toEqual([{key:'TOKEN',value:'',isSecret:true,required:true}]);
});

it('rejects external writes arriving while the current database is being preserved',async()=>{
  const saved=await backup(),preview=await manager.prepare(path.basename(path.dirname(saved.databasePath)));
  const original=db.backup.bind(db);
  vi.spyOn(db,'backup').mockImplementation(async(...args)=>{
    const result=await original(...args);
    const other=new Database(db.name);other.exec("UPDATE projects SET name='external-write'");other.close();
    return result;
  });
  await expect(manager.restore(preview.token,db)).rejects.toThrow('外部数据库写入');
  expect(db.prepare('SELECT name FROM projects').get()).toEqual({name:'external-write'});
});

it('rolls back an interrupted SQLite replacement on the next open instead of creating an empty library',()=>{
  const filename=db.name;db.close();
  const moduleFile=createRequire(import.meta.url).resolve('better-sqlite3');
  execFileSync(process.execPath,['-e',"const DB=require(process.argv[1]);const db=new DB(process.argv[2]);db.pragma('journal_mode=DELETE');db.exec('BEGIN EXCLUSIVE; DELETE FROM projects');process.exit(0)",moduleFile,filename]);
  db=createDatabase(filename,{fileMustExist:true});
  expect(db.prepare('SELECT name FROM projects').get()).toEqual({name:'original'});
});
