import Database from 'better-sqlite3';
import type { Database as DatabaseInstance } from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createDatabase, DATABASE_SCHEMA_VERSION } from './db.js';
import { createVerifiedDatabaseBackup, hashFile, verifyDatabase, type DatabaseBackupPolicy } from './startup-protection.js';

export interface BackupSummary {
  id: string; createdAt: string; bytes: number; appVersion: string; schemaVersion: number;
  reason: string; pinned: boolean; status: 'verified' | 'unavailable'; error?: string;
}
export interface RestorePreview {
  token: string; backupId: string; createdAt: string; schemaVersion: number;
  targetSchemaVersion: number; counts: Record<string, number>; unreadableSecrets: number;
}
interface PreparedRestore { preview: RestorePreview; file: string; hash: string; expires: number }

function regularFile(file: string): void {
  const stat=fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink!==1) throw new Error('备份必须是独立普通文件。');
}
function backupPaths(root: string,id: string) {
  if (!/^[\da-z-]{1,100}$/i.test(id) || id.startsWith('.')) throw new Error('无效备份标识。');
  const directory=path.join(root,id),stat=fs.lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('无效备份目录。');
  const file=path.join(directory,'codehelm.sqlite'),manifest=path.join(directory,'manifest.json');
  regularFile(file);regularFile(manifest);
  if(fs.statSync(manifest).size>1024*1024) throw new Error('备份清单过大。');
  return {directory,file,manifest};
}
async function inspect(root:string,id:string) {
  const paths=backupPaths(root,id),meta=JSON.parse(fs.readFileSync(paths.manifest,'utf8'));
  if(meta.formatVersion!==1 || meta.status!=='verified' || meta.databaseFile!=='codehelm.sqlite'
    || meta.bytes!==fs.statSync(paths.file).size || meta.sha256!==await hashFile(paths.file)) throw new Error('备份校验失败或备份未完成。');
  const source=new Database(paths.file,{readonly:true,fileMustExist:true});
  try {
    const counts=verifyDatabase(source),version=source.pragma('user_version',{simple:true}) as number;
    if(version!==meta.schemaVersion) throw new Error('备份 schema 与清单不一致。');
    return {paths,meta,counts,version};
  } finally {source.close();}
}

/** All callers serialize this manager with periodic backup activity. */
export class BackupManager {
  private prepared:PreparedRestore|undefined;
  constructor(readonly root:string,readonly appVersion:string) {fs.mkdirSync(root,{recursive:true});}

  async list():Promise<BackupSummary[]> {
    const result:BackupSummary[]=[];
    for(const id of fs.readdirSync(this.root).filter(name=>!name.startsWith('.')).sort().reverse().slice(0,200)) {
      try {
        const {meta,version}=await inspect(this.root,id);
        result.push({id,createdAt:meta.createdAt,bytes:meta.bytes,appVersion:meta.appVersion??'未知（旧版备份）',schemaVersion:version,
          reason:meta.reason,pinned:meta.pinned===true||meta.reason==='before-restore',status:'verified'});
      } catch(error) {result.push({id,createdAt:'',bytes:0,appVersion:'未知',schemaVersion:0,reason:'unknown',pinned:false,status:'unavailable',error:error instanceof Error?error.message:'无法校验'});}
    }
    return result;
  }

  pin(id:string,pinned:boolean):void {
    const {manifest}=backupPaths(this.root,id),meta=JSON.parse(fs.readFileSync(manifest,'utf8'));
    if(meta.reason==='before-restore' && !pinned) throw new Error('恢复前保全备份不能解除保留。');
    const temporary=`${manifest}.${randomUUID()}.tmp`;
    fs.writeFileSync(temporary,JSON.stringify({...meta,pinned},null,2),{flag:'wx'});
    fs.renameSync(temporary,manifest);
  }

  async prepare(id:string,checkSecret:(value:string)=>void=()=>{},validateData:(db:DatabaseInstance)=>void=()=>{}):Promise<RestorePreview> {
    this.prepared=undefined;
    const {paths,meta,version}=await inspect(this.root,id);
    const token=randomUUID(),directory=path.join(this.root,`.restore-${token}`),file=path.join(directory,'candidate.sqlite');
    fs.mkdirSync(directory);
    // Published backups are standalone; copy exclusively, then rehash before migration.
    fs.copyFileSync(paths.file,file,fs.constants.COPYFILE_EXCL);
    if(await hashFile(file)!==meta.sha256) throw new Error('备份在预检期间发生变化。');
    const candidate=createDatabase(file,{fileMustExist:true});
    let counts:Record<string,number>,unreadableSecrets=0;
    try {
      counts=verifyDatabase(candidate);
      validateData(candidate);
      for(const row of candidate.prepare('SELECT id,env_json FROM service_configs').all() as {id:string;env_json:string}[]) {
        const env=JSON.parse(row.env_json);
        for(const entry of env) if(entry.isSecret) {
          try {checkSecret(entry.value);} catch {unreadableSecrets++;entry.value='';entry.required=true;}
        }
        candidate.prepare('UPDATE service_configs SET env_json=? WHERE id=?').run(JSON.stringify(env),row.id);
      }
      candidate.pragma('wal_checkpoint(TRUNCATE)');candidate.pragma('journal_mode=DELETE');
    } finally {candidate.close();}
    const preview={token,backupId:id,createdAt:meta.createdAt,schemaVersion:version,targetSchemaVersion:DATABASE_SCHEMA_VERSION,counts,unreadableSecrets};
    this.prepared={preview,file,hash:await hashFile(file),expires:Date.now()+5*60_000};
    return preview;
  }

  preview(token:string):RestorePreview {
    if(!this.prepared || this.prepared.preview.token!==token || this.prepared.expires<Date.now()) throw new Error('恢复预检已过期，请重新预检。');
    return this.prepared.preview;
  }

  async restore(token:string,db:DatabaseInstance,policy:Partial<DatabaseBackupPolicy>={},getAvailableBytes?:(directory:string)=>Promise<bigint>):Promise<string> {
    this.preview(token);
    const prepared=this.prepared!;this.prepared=undefined;
    if(await hashFile(prepared.file)!==prepared.hash) throw new Error('恢复候选已改变。');
    const receipt=path.join(path.dirname(prepared.file),'result.json');
    const report=(status:string,error?:string)=>fs.writeFileSync(receipt,JSON.stringify({status,backupId:prepared.preview.backupId,at:new Date().toISOString(),error},null,2));
    report('preparing');
    let attached=false;
    try {
      // DELETE mode plus EXCLUSIVE rejects other readers as well as writers.
      db.pragma('busy_timeout=1000');
      if(db.pragma('journal_mode=DELETE',{simple:true})!=='delete') throw new Error('无法取得数据库独占访问。');
      const version=db.pragma('data_version',{simple:true});
      const preserved=await createVerifiedDatabaseBackup({source:db,sourcePath:db.name,backupDirectory:this.root,reason:'before-restore',appVersion:this.appVersion,policy,getAvailableBytes});
      if(await hashFile(prepared.file)!==prepared.hash) throw new Error('恢复候选在保全期间发生变化。');
      db.prepare('ATTACH DATABASE ? AS restore_candidate').run(prepared.file);attached=true;
      db.pragma('foreign_keys=OFF');
      db.transaction(()=>{
        if(db.pragma('data_version',{simple:true})!==version) throw new Error('保全期间有外部数据库写入，已取消恢复。');
        const tables=(db.prepare("SELECT name FROM main.sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as {name:string}[]);
        const quote=(name:string)=>`"${name.replaceAll('"','""')}"`;
        for(const {name} of tables) db.exec(`DELETE FROM main.${quote(name)}`);
        for(const {name} of tables) {
          const columns=(db.prepare(`PRAGMA main.table_info(${quote(name)})`).all() as {name:string}[]).map(c=>quote(c.name)).join(',');
          db.exec(`INSERT INTO main.${quote(name)} (${columns}) SELECT ${columns} FROM restore_candidate.${quote(name)}`);
        }
        // Historical approvals never authorize a new process after restoration.
        db.exec('UPDATE run_profiles SET user_confirmed_at=NULL');
        verifyDatabase(db);
      }).exclusive();
      // A diagnostic write failure after COMMIT must not be reported as rollback.
      try {report('restored');} catch { /* The retained candidate and pre-restore backup remain available. */ }
      return path.dirname(preserved.databasePath);
    } catch(error) {report('failed',error instanceof Error?error.message:'恢复失败');throw error;}
    finally {
      try {if(attached) db.exec('DETACH DATABASE restore_candidate');}
      finally {
        db.pragma('foreign_keys=ON');
        try {db.pragma('journal_mode=WAL');} catch { /* DELETE mode remains durable; startup sets WAL after restart. */ }
      }
    }
  }
}
