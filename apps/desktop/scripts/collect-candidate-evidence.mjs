import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const root=process.cwd();
const candidate=path.resolve(process.argv[2]??'test-results/v02-006-package');
const output=path.resolve(process.argv[3]??'test-results/v02-006-evidence.json');
const desktopRequire=createRequire(path.join(root,'apps/desktop/package.json'));
const packageVersion=name=>JSON.parse(fs.readFileSync(desktopRequire.resolve(`${name}/package.json`),'utf8')).version;
const digest=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const git=(...args)=>execFileSync('git',['-c',`safe.directory=${root.replaceAll('\\','/')}`,...args],{cwd:root,encoding:'utf8'}).trim();
async function hashFile(file){
  const hash=crypto.createHash('sha256');
  for await(const chunk of fs.createReadStream(file))hash.update(chunk);
  return hash.digest('hex');
}
const sourceFiles=git('ls-files','-co','--exclude-standard','-z').split('\0').filter(Boolean).filter(file=>
  /^(apps\/desktop\/(src|scripts|resources)|packages\/[^/]+\/(src|test)|e2e\/|\.github\/)|(^|\/)(package\.json|pnpm-lock\.yaml|.*config\.[^/]+|electron-builder\.yml)$/.test(file)
).filter(file=>fs.existsSync(file)&&fs.statSync(file).isFile());
const sourceInventory=[...new Set(sourceFiles)].sort().map(file=>({path:file,sha256:digest(fs.readFileSync(file))}));
const artifacts=[];
async function walk(directory){
  for(const entry of fs.readdirSync(directory,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){
    const absolute=path.join(directory,entry.name);
    if(entry.isDirectory()&&entry.name==='logs')continue;
    if(entry.isSymbolicLink())throw new Error(`Unexpected linked candidate artifact: ${absolute}`);
    if(entry.isDirectory())await walk(absolute);
    else if(entry.isFile())artifacts.push({path:path.relative(candidate,absolute).replaceAll('\\','/'),bytes:fs.statSync(absolute).size,sha256:await hashFile(absolute)});
  }
}
await walk(candidate);
const resultFile=path.join(root,'test-results/packaged-e2e-results.json');
let tests={status:'not-recorded'};
if(fs.existsSync(resultFile)){
  const report=JSON.parse(fs.readFileSync(resultFile,'utf8'));
  tests={status:report.stats.unexpected||report.stats.flaky?'failed-or-flaky':'recorded',stats:report.stats,sha256:await hashFile(resultFile)};
}
const evidence={formatVersion:1,generatedAt:new Date().toISOString(),productVersion:JSON.parse(fs.readFileSync('apps/desktop/package.json','utf8')).version,
  git:{head:git('rev-parse','HEAD'),branch:git('branch','--show-current'),dirty:!!git('status','--porcelain'),sourceDigest:digest(JSON.stringify(sourceInventory)),sourceInventory},
  environment:{platform:process.platform,arch:process.arch,os:os.release(),cpu:os.cpus()[0]?.model,totalMemoryBytes:os.totalmem(),node:process.version,
    configuredPackageManager:JSON.parse(fs.readFileSync('package.json','utf8')).packageManager,electron:packageVersion('electron'),electronBuilder:packageVersion('electron-builder')},
  lockfileSha256:await hashFile('pnpm-lock.yaml'),candidateDirectory:candidate,excludedRuntimeDirectories:['logs'],artifacts,tests,
  releaseReady:false,limitations:['Local working-tree candidate; not a published release.','Installer clean-system, upgrade and rollback matrix requires separate evidence.','Test report and file hashes record observed files; build provenance requires a frozen commit and CI run.']};
fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify(evidence,null,2)+'\n');
console.log(`Candidate evidence written: ${output}; ${artifacts.length} files; releaseReady=false`);
