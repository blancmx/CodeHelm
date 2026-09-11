import { expect, it } from 'vitest';
import type { ProjectSummaryDto } from '@codehelm/contracts';
import { matchesOrganization, compareLastRun, runOrganizationBatch } from '../project-organization.js';
const project: ProjectSummaryDto = {id:'a',name:'A',rootPath:'/a',tags:['work','web'],primaryLanguages:[],primaryFrameworks:[],moduleCount:0,serviceCount:0};
it('combines archive, favorite and all requested tags without losing archived records', () => {
  expect(matchesOrganization(project,'active',false,['web','work'])).toBe(true);
  expect(matchesOrganization(project,'active',false,['missing'])).toBe(false);
  expect(matchesOrganization({...project,archived:true},'active',false,[])).toBe(false);
  expect(matchesOrganization({...project,archived:true,favorite:true},'archived',true,['web'])).toBe(true);
  expect(matchesOrganization({...project,archived:true},'all',true,[])).toBe(false);
});
it('sorts actual recent runs newest first with never-run projects last and stable ties', () => {
  const values = [project,{...project,id:'b',lastRunAt:'2026-09-01'},{...project,id:'c',lastRunAt:'2026-09-11'}];
  expect(values.sort(compareLastRun).map(p=>p.id)).toEqual(['c','b','a']);
});
it('reports per-item failures and stops after the current acknowledged write without undoing it', async () => {
  const results: string[] = [], writes: number[] = [];
  let cancelled = false;
  await runOrganizationBatch([1,2,3,4],()=>cancelled,async item=>{
    if(item===1)throw new Error('read-only');
    writes.push(item);cancelled=true;return {};
  },(item,status)=>results.push(`${item}:${status}`));
  expect(writes).toEqual([2]);
  expect(results).toEqual(['1:失败：read-only','2:已完成','3:未执行（已取消）','4:未执行（已取消）']);
});
