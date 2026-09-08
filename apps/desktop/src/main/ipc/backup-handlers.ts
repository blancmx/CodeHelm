import { dialog,shell } from 'electron';
import { CODEHELM_APP_VERSION } from '../app-version.js';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Database } from 'better-sqlite3';
import { BackupManager,createVerifiedDatabaseBackup,type DatabaseBackupPolicy } from '@codehelm/database';
import { BackupPolicySchema,IpcChannels } from '@codehelm/contracts';
import type { RegisterIpcHandler } from './trusted-ipc.js';
import { decryptSecretValue } from './profile-secrets.js';
import { getAppSettings } from './app-settings.js';

export function readBackupPolicy(directory:string) {
  const file=path.join(directory,'.policy.json');
  return BackupPolicySchema.parse(fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):{});
}
export function databaseBackupPolicy(directory:string):Partial<DatabaseBackupPolicy> {
  const policy=readBackupPolicy(directory);
  return {maxBackups:policy.maxBackups,maxTotalBytes:policy.maxTotalMb*1024*1024};
}
export function registerBackupHandlers(handle:RegisterIpcHandler,db:Database,directory:string, lifecycle:{
  pausePeriodic:()=>Promise<void>;resumePeriodic:()=>void;quiesce:()=>Promise<void>;
}) {
  const manager=new BackupManager(directory,CODEHELM_APP_VERSION);
  let busy=false,restoreStarted=false,notice:string|undefined;
  let active:Promise<unknown>|undefined;
  function exclusive<T>(operation:()=>Promise<T>):Promise<T> {
    if(busy||restoreStarted) return Promise.reject(new Error('备份操作正在进行或恢复已结束，请关闭应用后重新打开。'));
    busy=true;
    const promise=(async()=>{
      try {await lifecycle.pausePeriodic();return await operation();}
      finally {busy=false;if(!restoreStarted)lifecycle.resumePeriodic();}
    })();
    active=promise;return promise;
  }
  handle(IpcChannels.BACKUPS_LIST,()=>exclusive(async()=>({entries:await manager.list(),policy:readBackupPolicy(directory),directory,notice})));
  handle(IpcChannels.BACKUPS_CREATE,()=>exclusive(async()=>{
    const result=await createVerifiedDatabaseBackup({source:db,sourcePath:db.name,backupDirectory:directory,reason:'manual',appVersion:CODEHELM_APP_VERSION,policy:databaseBackupPolicy(directory)});
    notice=result.maintenance.limitsSatisfied?'备份完成并校验通过。':'备份已校验；明确保留的备份或安全下限使当前保留量超过策略上限。';
  }));
  handle(IpcChannels.BACKUPS_PIN,(_event,id,pinned)=>exclusive(async()=>{
    if(typeof id!=='string'||typeof pinned!=='boolean')throw new Error('无效备份参数');
    manager.pin(id,pinned);
  }));
  handle(IpcChannels.BACKUPS_POLICY,(_event,raw)=>exclusive(async()=>{
    const policy=BackupPolicySchema.parse(raw),file=path.join(directory,'.policy.json'),temp=`${file}.${randomUUID()}.tmp`;
    fs.writeFileSync(temp,JSON.stringify(policy),{flag:'wx'});fs.renameSync(temp,file);
    notice='策略已保存，将在下一次成功备份后清理；明确保留及恢复前备份不会自动删除。';
  }));
  handle(IpcChannels.BACKUPS_PREPARE,(_event,id)=>exclusive(async()=>{
    if(typeof id!=='string')throw new Error('无效备份参数');
    return manager.prepare(id,value=>{decryptSecretValue(value);},candidate=>{getAppSettings(candidate);});
  }));
  handle(IpcChannels.BACKUPS_RESTORE,(_event,token)=>exclusive(async()=>{
    if(typeof token!=='string')throw new Error('无效恢复参数');
    const preview=manager.preview(token);
    const confirmation=await dialog.showMessageBox({type:'warning',title:'恢复 CodeHelm 管理数据',
      message:'确认用此备份替换当前管理数据？',
      detail:`备份：${preview.backupId}\n时间：${preview.createdAt}\n项目：${preview.counts.projects}；方案：${preview.counts.run_profiles}\n\n将停止本应用任务与受管进程，替换项目记录、方案、设置和运行历史。备份之后新增的管理数据将丢失；项目源码、依赖和日志不回滚。\n无法解密的 ${preview.unreadableSecrets} 个敏感值将清空并标为必填，请恢复后重新输入。\n原数据先保全；操作后必须关闭应用并重新打开。`,
      buttons:['取消','停止任务并恢复'],defaultId:0,cancelId:0,noLink:true});
    if(confirmation.response!==1)return {restored:false};
    restoreStarted=true;
    try {
      await lifecycle.quiesce();
      const preservedDirectory=await manager.restore(token,db,databaseBackupPolicy(directory));
      return {restored:true,preservedDirectory};
    } catch(error) {throw new Error(`恢复未完成，请关闭应用后重新打开。请保留原库、候选和已有保全备份。${error instanceof Error?error.message:''}`,{cause:error});}
  }));
  handle(IpcChannels.BACKUPS_OPEN,async()=>{const error=await shell.openPath(directory);if(error)throw new Error('无法打开备份目录。');});
  return {async waitForIdle(){await active?.catch(()=>undefined);}};
}
