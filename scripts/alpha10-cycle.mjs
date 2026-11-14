import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync,spawnSync} from 'node:child_process';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {parsePlan} from './live-plan.mjs';
import {assertReadOnlyNetwork,networkSummary} from './network-policy.mjs';
const out=resolve('evidence/alpha10');mkdirSync(out,{recursive:true});
const save=(n,v)=>writeFileSync(`${out}/${n}.json`,JSON.stringify(v,null,2)+'\n');
const git=(...a)=>execFileSync('git',a,{encoding:'utf8'}).trim();
const intent=JSON.parse(readFileSync('alpha10-intent.json'));
const names=['enkhjile-srw-e2e-core','enkhjile-srw-e2e-adapter'];
const head=git('rev-parse','HEAD');
assert.equal(process.env.GITHUB_EVENT_NAME,'push');assert.equal(process.env.GITHUB_REF,'refs/heads/alpha');assert.equal(process.env.GITHUB_SHA,head);
assert.equal(JSON.parse(readFileSync('node_modules/semantic-release-workspace/package.json')).version,'1.0.0-alpha.10');
for(const k of ['CARGO_REGISTRY_TOKEN','CARGO_REGISTRIES_CRATES_IO_TOKEN','NPM_TOKEN','NODE_AUTH_TOKEN'])assert.ok(!process.env[k]);
const note='refs/notes/workspace-release-branches/'+createHash('sha256').update('alpha').digest('hex');
function journal(){const r=spawnSync('git',['notes','--ref='+note,'list'],{encoding:'utf8'});return r.stdout.trim().split('\n').filter(Boolean).map(l=>JSON.parse(git('cat-file','blob',l.split(' ')[0]))).find(j=>j.head===head);}
async function inventory(){const result={};for(const n of names){const r=await fetch('https://index.crates.io/en/kh/'+n);assert.equal(r.status,200);result[n]=Object.fromEntries((await r.text()).trim().split('\n').map(JSON.parse).map(v=>[v.vers,{checksum:v.cksum,yanked:v.yanked}]));}return result;}
const refs=()=>git('ls-remote','--refs','origin').split('\n').sort();
function run(label,dry=false,readonly=false){const audit=`${out}/${label}-http.jsonl`;writeFileSync(audit,'');const r=spawnSync('npm',['exec','--','semantic-release',...(dry?['--dry-run']:[])],{encoding:'utf8',maxBuffer:32*1024*1024,env:{...process.env,SRW_HTTP_AUDIT:audit,NODE_OPTIONS:'--import='+pathToFileURL(resolve('scripts/network-count.mjs')).href}});const log=r.stdout+r.stderr;writeFileSync(`${out}/${label}.log`,log);process.stdout.write(log);const calls=readFileSync(audit,'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);save(label+'-network',networkSummary(calls));if(readonly)assertReadOnlyNetwork(calls);return {code:r.status,log};}
const before={inventory:await inventory(),refs:refs(),status:git('status','--porcelain')};assert.equal(before.status,'');save('before',before);
const initial=JSON.parse(readFileSync('shared-public-baseline.json'));let count=0;for(const n of names)count+=Object.keys(before.inventory[n]).filter(v=>!(v in initial[n].versions)).length;
const extra=intent.expected.filter(p=>!(p.version in before.inventory[p.name])).length;assert.ok(count+extra<=12);save('budget',{alreadyUploaded:count,plannedNewUploads:extra,limit:12});
const frozen=journal();if(frozen)save('journal-before',frozen);
const dry=run('dry-run',true,true);assert.equal(dry.code,0);const plan=dry.log.includes('"schemaVersion": 1')?parsePlan(dry.log):frozen?.planning.plan;assert.ok(plan);save('plan',plan);
assert.deepEqual(plan.packages.filter(p=>p.nextVersion&&!p.private).map(p=>({name:p.name,version:p.nextVersion})).sort((a,b)=>a.name.localeCompare(b.name)),[...intent.expected].sort((a,b)=>a.name.localeCompare(b.name)));
assert.equal(plan.dependencyPolicy,'independent');assert.ok(plan.packages.every(p=>p.dependencyUpdates.length===0));
assert.deepEqual(await inventory(),before.inventory);assert.deepEqual(refs(),before.refs);assert.equal(git('status','--porcelain'),'');
const release=run('release');if(frozen?.execution?.packages.every(p=>p.published)){const network=JSON.parse(readFileSync(`${out}/release-network.json`));assert.equal(network.identities,0);assert.ok(network.calls.filter(c=>!['GET','HEAD','OPTIONS','READY'].includes(c.method)).every(c=>c.host==='api.github.com'));}
const j=journal();save('journal',j??null);
if(release.code!==0){assert.ok(intent.retry&&process.env.GITHUB_RUN_ATTEMPT==='1');assert.match(release.log,/EALPHA10FRESHRETRY/);assert.equal(j.status,'pending');assert.ok(j.execution.packages.every(p=>p.published));save('expected-failure',{source:head,status:'EXPECTED_POSTPUBLISH_FAILURE',frozen:j});process.exit(1);}
assert.equal(j.status,'complete');assert.equal(git('status','--porcelain'),'');
if(frozen){assert.deepEqual(j.planning,frozen.planning);assert.equal(j.execution.prepared,frozen.execution.prepared);for(const p of j.execution.packages)assert.deepEqual(p.artifact,frozen.execution.packages.find(x=>x.id===p.id).artifact);}
const preparedChangelog=git('show',j.execution.prepared+':CHANGELOG.md');assert.ok(preparedChangelog.includes('enkhjile-srw-e2e'));writeFileSync(`${out}/prepared-CHANGELOG.md`,preparedChangelog);
const proof=[];
for(const p of intent.expected){const record=j.execution.packages.find(x=>x.id==='cargo:'+p.name);const response=await fetch(`https://static.crates.io/crates/${p.name}/${p.name}-${p.version}.crate`);assert.equal(response.status,200);const bytes=Buffer.from(await response.arrayBuffer());assert.equal(createHash('sha256').update(bytes).digest('hex'),record.artifact.sha256);assert.deepEqual(bytes,execFileSync('git',['show',record.artifact.commit+':artifact']));const file=`${out}/${p.name}-${p.version}.crate`;writeFileSync(file,bytes);const manifest=execFileSync('tar',['-xOf',file,`${p.name}-${p.version}/Cargo.toml`],{encoding:'utf8'});writeFileSync(file+'.Cargo.toml',manifest);if(p.name.endsWith('adapter'))assert.ok(manifest.includes(`version = "${intent.adapterPin}"`));const meta=await fetch(`https://crates.io/api/v1/crates/${p.name}/${p.version}`,{headers:{'user-agent':'semantic-release-workspace Cargo acceptance'}});assert.equal(meta.status,200);const version=(await meta.json()).version;assert.equal(version.trustpub_data.provider,'github');assert.equal(version.trustpub_data.sha,head);assert.equal(version.trustpub_data.repository,process.env.GITHUB_REPOSITORY);proof.push({name:p.name,version:p.version,artifact:record.artifact,trustpub:version.trustpub_data});}
save('published',proof);
const gh=await fetch(`https://api.github.com/repos/${process.env.GITHUB_REPOSITORY}/releases/tags/${j.batchTag}`,{headers:{authorization:'Bearer '+process.env.GITHUB_TOKEN,accept:'application/vnd.github+json'}});assert.equal(gh.status,200);const aggregate=await gh.json();assert.equal(aggregate.prerelease,true);for(const p of intent.expected)assert.ok(aggregate.body.includes(p.name)&&aggregate.body.includes(p.version));save('github-release',{url:aggregate.html_url,tag:aggregate.tag_name,body:aggregate.body});
const released={inventory:await inventory(),refs:refs()};save('after-release',released);for(const n of names)for(const [v,row] of Object.entries(before.inventory[n]))assert.deepEqual(released.inventory[n][v],row);
const additions=names.flatMap(name=>Object.keys(released.inventory[name]).filter(version=>!(version in before.inventory[name])).map(version=>({name,version})));assert.deepEqual(additions.sort((a,b)=>a.name.localeCompare(b.name)),intent.expected.filter(p=>!(p.version in before.inventory[p.name])).sort((a,b)=>a.name.localeCompare(b.name)));
const noChange=run('no-change',false,true);assert.equal(noChange.code,0);assert.deepEqual(await inventory(),released.inventory);assert.deepEqual(refs(),released.refs);save('result',{status:'PASS',source:head,newUploads:extra,retry:!!frozen,rootChangelog:true,aggregateRelease:aggregate.html_url});
