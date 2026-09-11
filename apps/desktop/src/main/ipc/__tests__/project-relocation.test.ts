import { afterEach, beforeEach, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { SCHEMA_SQL, ProjectRepository, ProfileRepository, SessionRepository } from '@codehelm/database';
import { ProjectRelocation } from '../project-relocation.js';
import { createExecutionProfileFingerprint, ExecutionApprovalGuard } from '../execution-approval.js';

let db: Database.Database, root: string, oldPath: string, newPath: string, id: string, profileId: string;
let service: ProjectRelocation;
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'codehelm-relocation-'));
  oldPath = path.join(root, '原 项目'); newPath = path.join(root, '新 项目');
  await fs.mkdir(oldPath); await fs.mkdir(newPath);
  await fs.writeFile(path.join(newPath, 'package.json'), '{"name":"fixture"}');
  db = new Database(':memory:'); db.pragma('foreign_keys=ON'); db.exec(SCHEMA_SQL);
  id = new ProjectRepository(db).create({name:'fixture',rootPath:oldPath,tags:['work']}).id;
  profileId = new ProfileRepository(db).save({projectId:id,name:'manual',isDefault:true,failurePolicy:'block_dependents',userConfirmedAt:'2026-01-01',services:[{
    id:'service',runProfileId:'',name:'server',type:'backend',moduleRelativePath:'.',cwdRelative:'.',executable:'node',args:['server.js'],env:[{key:'TOKEN',value:'keep-secret',isSecret:true}],dependsOn:[],enabled:true,source:'manual',
  }]}).id;
  service = new ProjectRelocation(db);
});
afterEach(async () => {
  db?.close();
  if (path.dirname(path.resolve(root)) !== path.resolve(os.tmpdir()) || !path.basename(root).startsWith('codehelm-relocation-')) throw new Error('Unsafe fixture cleanup');
  await fs.rm(root,{recursive:true,force:true});
});
it('requires a reviewed preview, preserves historical path and manual configs, and invalidates execution fingerprints', async () => {
  const repo = new ProjectRepository(db), profiles = new ProfileRepository(db), history = new SessionRepository(db);
  const original = profiles.findById(profileId)!;
  const fingerprint = createExecutionProfileFingerprint(original, repo.findById(id)!.rootPath);
  history.save({id:'run',projectId:id,runProfileId:profileId,services:[],status:'STOPPED',startedAt:'2026-01-01'});
  const preview = await service.preview(id,newPath);
  expect(preview.manifests[0].path).toBe('package.json');
  expect(repo.findById(id)!.rootPath).toContain('原 项目');
  await fs.rename(oldPath,path.join(root,'old-source-retained'));
  await service.commit(id,preview.token);
  expect(repo.findById(id)!.rootPath).toContain('新 项目');
  const updated = profiles.findById(profileId)!;
  expect(updated.services).toEqual(original.services);
  expect(updated.userConfirmedAt).toBeUndefined();
  expect(createExecutionProfileFingerprint(updated,repo.findById(id)!.rootPath)).not.toBe(fingerprint);
  expect(history.findById('run')!.projectRootPath).toContain('原 项目');
  await expect(service.commit(id,preview.token)).rejects.toThrow('过期');
  repo.delete(id);
  expect(await fs.readFile(path.join(newPath,'package.json'),'utf8')).toContain('fixture');
});
it('rejects target collisions including Windows case differences without changing the source', async () => {
  new ProjectRepository(db).create({name:'other',rootPath:process.platform==='win32'?newPath.toUpperCase():newPath});
  await expect(service.preview(id,newPath)).rejects.toThrow('其他项目');
  expect(new ProjectRepository(db).findById(id)!.rootPath).toContain('原 项目');
});
it('rejects changed manifests and changed configurations after preview', async () => {
  let preview = await service.preview(id,newPath);
  await fs.writeFile(path.join(newPath,'package.json'),'{"name":"changed"}');
  await expect(service.commit(id,preview.token)).rejects.toThrow('变化');
  preview = await service.preview(id,newPath);
  db.prepare('UPDATE projects SET tags=? WHERE id=?').run('["changed"]',id);
  await expect(service.commit(id,preview.token)).rejects.toThrow('变化');
  expect(new ProjectRepository(db).findById(id)!.rootPath).toContain('原 项目');
});
it('rejects missing directories, relative paths and config escape', async () => {
  await expect(service.preview(id,'relative')).rejects.toThrow('绝对');
  await expect(service.preview(id,path.join(root,'missing'))).rejects.toThrow();
  db.prepare('UPDATE service_configs SET cwd_relative=?').run('../');
  await expect(service.preview(id,newPath)).rejects.toThrow('越界');
});
it('rejects directory junction roots and escaping configuration junctions', async () => {
  const link = path.join(root,'link'); await fs.symlink(newPath,link,'junction');
  await expect(service.preview(id,link)).rejects.toThrow('目录链接');
  await fs.symlink(oldPath,path.join(newPath,'outside'),'junction');
  db.prepare('UPDATE service_configs SET cwd_relative=?').run('outside');
  await expect(service.preview(id,newPath)).rejects.toThrow('越界');
});
it('checks live execution again at commit and does not stop it', async () => {
  let busy = false;
  service = new ProjectRelocation(db, () => { if(busy) throw new Error('running'); });
  const preview = await service.preview(id,newPath); busy = true;
  await expect(service.commit(id,preview.token)).rejects.toThrow('running');
  expect(new ProjectRepository(db).findById(id)!.rootPath).toContain('原 项目');
});
it('revokes both issued tokens and reusable approvals even when binding the same physical path', async () => {
  await service.commit(id,(await service.preview(id,newPath)).token);
  const approvals = new ExecutionApprovalGuard();
  const context = {profileId,mode:'start' as const,configurationFingerprint:'config',executionFingerprint:'execution'};
  const token = approvals.confirm(context);
  service = new ProjectRelocation(db,()=>{}, profile=>approvals.invalidate(profile));
  const preview = await service.preview(id,newPath);
  await service.commit(id,preview.token);
  expect(()=>approvals.consume(context,token)).toThrow();
  expect(()=>approvals.reuse(context)).toThrow();
});
