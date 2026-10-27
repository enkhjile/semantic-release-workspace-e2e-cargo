import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {parsePlan} from './live-plan.mjs';

export function assertPlan(plan,intent){
  const selected=plan.packages.filter(p=>!p.private).map(p=>({name:p.name,nextVersion:p.nextVersion})).sort((a,b)=>a.name.localeCompare(b.name));
  assert.deepEqual(selected,[...intent.packages].sort((a,b)=>a.name.localeCompare(b.name)),'Public versions must match the literal reviewed intent');
  assert.equal(plan.release?.branch,intent.branch,'Release branch must match intent');
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const intent=JSON.parse(readFileSync('alpha6-live-intent.json'));
  const root=JSON.parse(readFileSync('package.json'));
  assert.equal(root.devDependencies['semantic-release-workspace'],'1.0.0-alpha.6');
  assert.equal(intent.mode,'preview-only');
  const git=(...args)=>execFileSync('git',args,{encoding:'utf8'});
  assert.equal(git('branch','--show-current').trim(),intent.branch);
  for(const name of ['NPM_TOKEN','NODE_AUTH_TOKEN','CARGO_REGISTRY_TOKEN','CARGO_REGISTRIES_CRATES_IO_TOKEN'])assert.ok(!process.env[name],name+' must be absent');
  if(process.env.GITHUB_ACTIONS==='true')assert.equal(git('rev-parse','HEAD').trim(),process.env.GITHUB_SHA);
  mkdirSync('evidence/alpha6-preview',{recursive:true});
  async function inventory(){
    const result={};
    for(const {name} of intent.packages){
      const url=intent.manager==='cargo'?'https://crates.io/api/v1/crates/'+name:'https://registry.npmjs.org/'+encodeURIComponent(name);
      const response=await fetch(url,{headers:{'user-agent':'semantic-release-workspace-acceptance (https://github.com/enkhjile/semantic-release-workspace)'}});
      assert.equal(response.status,200,url);
      const data=await response.json();
      result[name]=intent.manager==='cargo'?data.versions.map(v=>({version:v.num,checksum:v.checksum,yanked:v.yanked})).sort((a,b)=>a.version.localeCompare(b.version)):{tags:data['dist-tags'],versions:Object.fromEntries(Object.entries(data.versions).map(([v,p])=>[v,p.dist.integrity]))};
    }
    return result;
  }
  async function snapshot(){return{head:git('rev-parse','HEAD').trim(),status:git('status','--porcelain'),refs:git('ls-remote','--refs','origin').trim().split('\n').sort(),source:git('ls-files','-z').split('\0').filter(Boolean).map(path=>({path,sha256:createHash('sha256').update(readFileSync(path)).digest('hex')})),inventory:await inventory()};}
  const before=await snapshot();assert.equal(before.status,'','Commit the exact preview source before running');
  writeFileSync('evidence/alpha6-preview/before.json',JSON.stringify(before,null,2)+'\n');
  const command=intent.manager==='cargo'?'npm':intent.manager;
  const args=command==='npm'?['exec','--','semantic-release','--dry-run']:['exec','semantic-release','--dry-run'];
  const audit=resolve('evidence/alpha6-preview/http.jsonl');writeFileSync(audit,'');
  const child=spawnSync(command,args,{encoding:'utf8',maxBuffer:16*1024*1024,env:{...process.env,NPM_CONFIG_AUDIT:'false',NPM_CONFIG_FUND:'false',NODE_OPTIONS:[process.env.NODE_OPTIONS,'--import='+pathToFileURL(resolve('scripts/network-count.mjs')).href].filter(Boolean).join(' '),SRW_HTTP_AUDIT:audit}});
  const log=(child.stdout??'')+(child.stderr??'');writeFileSync('evidence/alpha6-preview/dry-run.log',log);process.stdout.write(log);
  const after=await snapshot();writeFileSync('evidence/alpha6-preview/after.json',JSON.stringify(after,null,2)+'\n');
  assert.deepEqual(after,before,'Dry-run changed source, remote refs or public inventory');
  const calls=readFileSync(audit,'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
  assert.ok(calls.some(c=>c.transport==='observer'),'HTTP observer must initialize');
  for(const c of calls.filter(c=>c.transport!=='observer')){assert.ok(['GET','HEAD','OPTIONS'].includes(c.method),JSON.stringify(c));assert.ok(!/actions\.githubusercontent|token\.actions|sigstore|fulcio|rekor/.test(c.host),JSON.stringify(c));}
  assert.equal(child.status,0,'Real semantic-release dry-run failed');
  const plan=parsePlan(log);assertPlan(plan,intent);
  const result={status:'PASS',mode:'preview-only',intent,head:before.head,plan,command:[command,...args],node:process.version,nodeExecutable:process.execPath,registryChanges:0,remoteRefChanges:0,identityRequests:0};
  writeFileSync('evidence/alpha6-preview/result.json',JSON.stringify(result,null,2)+'\n');
  console.log(JSON.stringify(result,null,2));
}
