import { afterEach,beforeEach,expect,it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { openLogRoot,closeRoot } from '@codehelm/safe-fs';
import { LogRotator } from '@codehelm/runner';
import { readStoredLogPage } from '../stored-log-reader.js';
import { formatLoadedLogExport } from '../../../renderer/utils/log-export.js';
let directory:string,rootSessionId:string|undefined;
const run=crypto.randomUUID();
beforeEach(async()=>{directory=await fs.mkdtemp(path.join(os.tmpdir(),'codehelm-log-query-'));});
afterEach(async()=>{if(rootSessionId)closeRoot(rootSessionId);rootSessionId=undefined;
  if(path.dirname(directory)!==path.resolve(os.tmpdir())||!path.basename(directory).startsWith('codehelm-log-query-'))throw new Error('Unsafe fixture cleanup');
  await fs.rm(directory,{recursive:true,force:true});});
async function seed(count=450) {
  const writer=new LogRotator(directory);
  await writer.appendBatch('project',Array.from({length:count},(_,i)=>({id:`entry-${i}`,serviceSessionId:i%2?'web':'api',serviceName:i%2?'Web':'API',stream:i%2?'stdout' as const:'stderr' as const,
    message:`${i} already [REDACTED]`,timestamp:'2026-09-08T00:00:00.000Z'})),run);
  rootSessionId=openLogRoot(directory,4096);
  return writer;
}
it('reads stable bounded pages with no duplicates and exports only the filtered loaded page',async()=>{
  await seed();
  const input={directory,projectId:'project',rootSessionId:rootSessionId!,query:{runSessionId:run}};
  const first=await readStoredLogPage(input),second=await readStoredLogPage({...input,position:first.position}),third=await readStoredLogPage({...input,position:second.position});
  expect(first.entries).toHaveLength(200);expect(second.entries).toHaveLength(200);expect(third.entries).toHaveLength(50);expect(third.position).toBeUndefined();
  expect(new Set([...first.entries,...second.entries,...third.entries].map(e=>e.id)).size).toBe(450);
  const filtered=await readStoredLogPage({...input,query:{runSessionId:run,serviceSessionId:'api',stream:'stderr',keyword:'44',from:'2026-09-08T00:00:00.000Z'}});
  expect(filtered.entries.length).toBeGreaterThan(0);
  expect(filtered.entries.every(e=>e.serviceSessionId==='api'&&e.stream==='stderr'&&e.message.includes('44'))).toBe(true);
  const exported=formatLoadedLogExport(filtered.entries,{stream:'stderr'});
  expect(exported).toContain('不是完整会话日志');
  expect(exported.split('\n').filter(line=>line.startsWith('{')).map(line=>JSON.parse(line))).toEqual(filtered.entries);
  expect(exported).not.toContain('already secret-value');
});
it('reports files removed by rotation between pages rather than treating the result as complete',async()=>{
  const writer=await seed();
  const input={directory,projectId:'project',rootSessionId:rootSessionId!,query:{runSessionId:run}};
  const first=await readStoredLogPage(input);
  await writer.cleanup(0,0);
  const next=await readStoredLogPage({...input,position:first.position});
  expect(next.missingFiles).toBeGreaterThan(0);expect(next.entries).toEqual([]);
});
it('rejects malformed records and excludes other sessions and invalid project paths',async()=>{
  await fs.mkdir(path.join(directory,'project'));
  await fs.writeFile(path.join(directory,'project','invalid.log'),'not-json\n{"message":"private","runSessionId":"another-run"}\n');
  rootSessionId=openLogRoot(directory,4096);
  const result=await readStoredLogPage({directory,projectId:'project',rootSessionId,query:{runSessionId:run}});
  expect(result.skippedRecords).toBe(1);expect(result.entries).toEqual([]);
  await expect(readStoredLogPage({directory,projectId:'../outside',rootSessionId,query:{runSessionId:run}})).rejects.toThrow('无效');
});

it('bounds output bytes and keeps appended records out of an existing page snapshot',async()=>{
  const writer=new LogRotator(directory);
  await writer.appendBatch('project',Array.from({length:300},(_,i)=>({id:`large-${i}`,serviceSessionId:'api',serviceName:'API',stream:'stdout' as const,message:'x'.repeat(10_000),timestamp:'2026-09-08T00:00:00.000Z'})),run);
  rootSessionId=openLogRoot(directory,4096);
  const input={directory,projectId:'project',rootSessionId,query:{runSessionId:run}};
  const first=await readStoredLogPage(input);
  expect(Buffer.byteLength(JSON.stringify(first.entries))).toBeLessThan(1024*1024);
  await writer.appendBatch('project',[{id:'late-entry',serviceSessionId:'api',serviceName:'API',stream:'stdout',message:'late',timestamp:'2026-09-08T00:00:00.000Z'}],run);
  const ids=first.entries.map(e=>e.id);let position=first.position;
  while(position){const page=await readStoredLogPage({...input,position});ids.push(...page.entries.map(e=>e.id));position=page.position;}
  expect(ids).toHaveLength(300);expect(ids).not.toContain('late-entry');
});

it('reports an oversized file as unreadable within the file budget',async()=>{
  await fs.mkdir(path.join(directory,'project'));await fs.writeFile(path.join(directory,'project','oversized.log'),Buffer.alloc(16*1024*1024+1));
  rootSessionId=openLogRoot(directory,4096);
  const result=await readStoredLogPage({directory,projectId:'project',rootSessionId,query:{runSessionId:run}});
  expect(result.entries).toEqual([]);expect(result.missingFiles).toBe(1);expect(result.scannedBytes).toBe(0);
});

it('continues on another page before exceeding the total read budget',async()=>{
  await fs.mkdir(path.join(directory,'project'));
  const contents=Buffer.alloc(12*1024*1024,32);contents[contents.length-1]=10;
  for (let i=0;i<3;i++) await fs.writeFile(path.join(directory,'project',`${i}.log`),contents);
  rootSessionId=openLogRoot(directory,4096);
  const input={directory,projectId:'project',rootSessionId,query:{runSessionId:run}};
  const first=await readStoredLogPage(input);
  expect(first.scannedBytes).toBe(24*1024*1024);expect(first.position).toBeDefined();
  const next=await readStoredLogPage({...input,position:first.position});
  expect(next.scannedBytes).toBe(12*1024*1024);expect(next.position).toBeUndefined();
});
