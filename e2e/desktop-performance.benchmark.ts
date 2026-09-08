import { test,expect,_electron as electron,type ElectronApplication,type Page } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';

const root=process.cwd(),desktop=path.join(root,'apps/desktop');
const executable=process.env.CODEHELM_E2E_EXECUTABLE||path.join(root,'test-results/v02-006-package/win-unpacked/CodeHelm.exe');
const requireDesktop=createRequire(path.join(desktop,'package.json'));
const percentile=(values:number[],fraction:number)=>[...values].sort((a,b)=>a-b)[Math.ceil(values.length*fraction)-1];
const median=(values:number[])=>{const sorted=[...values].sort((a,b)=>a-b),middle=Math.floor(sorted.length/2);return sorted.length%2?sorted[middle]:(sorted[middle-1]+sorted[middle])/2;};

async function removeFixture(fixture:string){
  if(path.dirname(fixture)!==path.resolve(os.tmpdir())||!path.basename(fixture).startsWith('codehelm-benchmark-'))throw new Error('Unsafe fixture cleanup');
  await fs.rm(fixture,{recursive:true,force:true});
}

// eslint-disable-next-line no-empty-pattern
test('records 1000-project search, repeated diagnostics and ten warm starts',async({},testInfo)=>{
  const fixture=await fs.mkdtemp(path.join(os.tmpdir(),'codehelm-benchmark-'));
  let app:ElectronApplication|undefined,page:Page;
  const userData=path.join(fixture,'user-data'),projectPath=path.join(fixture,'project');
  await fs.mkdir(userData);await fs.mkdir(projectPath);
  await fs.writeFile(path.join(projectPath,'package.json'),JSON.stringify({name:'benchmark-fixture',private:true,scripts:{start:'node service.cjs'}}));
  await fs.writeFile(path.join(projectPath,'service.cjs'),"throw new Error('Diagnostics must not execute this script');");
  const DB=requireDesktop('better-sqlite3');
  const db=new DB(path.join(userData,'codehelm.sqlite'));
  const ids=Array.from({length:1000},()=>crypto.randomUUID());
  db.exec(await fs.readFile(path.join(root,'e2e/fixtures/v010-schema.sql'),'utf8'));
  const insert=db.prepare('INSERT INTO projects(id,name,root_path,created_at,updated_at) VALUES (?,?,?,?,?)');
  db.transaction(()=>ids.forEach((id,i)=>insert.run(id,`BenchmarkProject-${String(i).padStart(4,'0')}`,i===0?projectPath:path.join(fixture,`project-${i}`),'2026-09-01','2026-09-01')))();db.close();
  const environment:Record<string,string>=Object.fromEntries(Object.entries({...process.env,CODEHELM_USER_DATA_DIR:userData}).filter((entry):entry is [string,string]=>typeof entry[1]==='string'));
  delete environment.ELECTRON_RUN_AS_NODE;delete environment.VITE_DEV_SERVER_URL;
  const starts:number[]=[],filters:number[]=[],diagnostics:number[]=[];
  async function launch(){
    const started=performance.now();
    app=await electron.launch({executablePath:executable,args:[],cwd:desktop,env:environment});
    page=await app.firstWindow();await page.waitForLoadState('domcontentloaded');
    await expect(page.getByRole('heading',{name:'项目总览',exact:true})).toBeVisible();
    expect((await page.evaluate(()=>window.codehelm.projects.list())).length).toBe(1000);
    return performance.now()-started;
  }
  try {
    await launch(); // Warm-up and one-time schema migration are excluded from timing.
    for(let i=0;i<10;i++){await app!.close();app=undefined;starts.push(await launch());}
    await page!.getByRole('button',{name:'搜索项目',exact:true}).click();
    const input=page!.getByPlaceholder('搜索工程名称、本地路径、框架或语言画像...');
    await expect(input).toBeVisible();
    for(let i=0;i<30;i++){
      const name=`BenchmarkProject-${String(i*31).padStart(4,'0')}`;
      await input.evaluate(el=>{el.addEventListener('input',()=>performance.mark('benchmark-input'),{once:true,capture:true});});
      await input.fill(name);
      await expect(page!.locator('.search-modal-card').getByText(name,{exact:true})).toBeVisible();
      filters.push(await page!.evaluate(()=>new Promise<number>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>{
        resolve(performance.now()-performance.getEntriesByName('benchmark-input').at(-1)!.startTime);
      })))));
    }
    await page!.screenshot({path:testInfo.outputPath('1000-project-search.png'),animations:'disabled'});
    await input.press('Escape');
    const profile=await page!.evaluate(({projectId,node})=>window.codehelm.profiles.save({projectId,name:'诊断性能样本',isDefault:true,failurePolicy:'block_dependents',services:[{
      id:'benchmark-service',runProfileId:'',name:'Node fixture',type:'tool',moduleRelativePath:'.',executable:node,args:['service.cjs'],cwdRelative:'.',env:[],dependsOn:[],enabled:true,source:'manual',
    }]}),{projectId:ids[0],node:process.execPath});
    for(let i=0;i<30;i++){
      const started=performance.now();const report=await page!.evaluate(id=>window.codehelm.runner.diagnose(id),profile.id);diagnostics.push(performance.now()-started);
      expect(report.checks.length).toBeGreaterThan(0);expect(report.checks.filter(check=>check.status==='blocked')).toEqual([]);
    }
    expect((await page!.evaluate(()=>window.codehelm.runner.getState())).activeSessions).toHaveLength(0);
    const report={kind:'local-packaged-benchmark',executable,executableSha256:createHash('sha256').update(await fs.readFile(executable)).digest('hex'),
      environment:{os:os.release(),cpu:os.cpus()[0].model,memoryBytes:os.totalmem()},sampleProjects:1000,
      warmStarts:{samplesMs:starts,medianMs:median(starts),p95Ms:percentile(starts,0.95)},
      search:{samplesMs:filters,p95Ms:percentile(filters,0.95),targetMs:200},
      diagnostics:{samplesMs:diagnostics,p95Ms:percentile(diagnostics,0.95),targetMs:5000},
      limitations:['Warm process restarts only; OS cache not cleared.','No v0.1 binary comparison.','Search is the quick-search dialog with 1000 real persisted projects.','Diagnostic sample is one local Node profile, not a mixed environment matrix.','Existing development app may be running on this workstation.']};
    await fs.writeFile(testInfo.outputPath('benchmark.json'),JSON.stringify(report,null,2));
    expect(report.search.p95Ms).toBeLessThanOrEqual(200);expect(report.diagnostics.p95Ms).toBeLessThanOrEqual(5000);
  } finally {
    await app?.close();
    await removeFixture(fixture);
  }
});
