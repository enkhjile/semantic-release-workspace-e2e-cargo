import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {parse} from 'smol-toml';

// Public CLI contract: core-only feat advances core to 1.1.0; the exact
// dependency coordinates the unchanged nested consumer to 1.0.1. These
// literal oracles are independent of the plugin's generated plan.
export async function runNested(h) {
 const {scenario,withFixture,ok,run,commit,release,success,snapshot,downstream,archivedPackage,root,evidence}=h;
 const nested='crates/outer/inner/nested';
 const inherited='version.workspace=true\nedition.workspace=true\nlicense.workspace=true\n';
 const privateCrate=(name,helper='')=>`[package]\nname="${name}"\n${inherited}publish=false\n${helper?`[dependencies]\nprivate-helper={path="${helper}",version="=1.0.0"}\n`:''}`;
 const files={
  'Cargo.toml':'[workspace]\nmembers=["crates/core","crates/outer","crates/outer/inner","crates/outer/inner/nested","crates/out","crates/private-helper","crates/other"]\nresolver="3"\n[workspace.package]\nversion="1.0.0"\nedition="2024"\nlicense="MIT"\n[workspace.dependencies]\nrenamed={package="fixture-core",path="crates/core",version="=1.0.0"}\n',
  'crates/core/Cargo.toml':`[package]\nname="fixture-core"\n${inherited}description="Nested core fixture"\npublish=["fixture"]\n`,
  'crates/core/src/lib.rs':'pub fn value()->u32{42}\n',
  [`${nested}/Cargo.toml`]:`[package]\nname="fixture-adapter"\n${inherited}description="Public nested fixture"\npublish=["fixture"]\n[dependencies]\nrenamed.workspace=true\n`,
  [`${nested}/src/lib.rs`]:'pub fn value()->u32{renamed::value()}\n',
  'crates/outer/Cargo.toml':privateCrate('private-outer','../private-helper'),
  'crates/outer/inner/Cargo.toml':privateCrate('private-inner','../../private-helper'),
  'crates/out/Cargo.toml':privateCrate('private-prefix','../private-helper'),
  'crates/private-helper/Cargo.toml':privateCrate('private-helper'),
  'crates/other/Cargo.toml':`[package]\nname="fixture-other"\n${inherited}description="Independent main package"\npublish=["fixture"]\n`,
  'crates/other/src/lib.rs':'pub fn value()->u32{42}\n',
 };
 for(const p of ['crates/outer','crates/outer/inner','crates/out','crates/private-helper'])files[p+'/src/lib.rs']='pub fn value()->u32{0}\n';
 const setup=async f=>{
  await ok('git',['commit','--amend','-m','chore: establish nested inherited Cargo workspace'],f.cwd);
  await ok('git',['push','--force-with-lease','origin','main'],f.cwd);
  const native=JSON.parse(await ok('cargo',['metadata','--format-version','1','--no-deps','--locked'],f.cwd,f.env));
  assert.deepEqual(native.packages.map(p=>p.name).sort(),['fixture-adapter','fixture-core','fixture-other','private-helper','private-inner','private-outer','private-prefix']);
  await ok('cargo',['test','--workspace','--all-features','--locked','--offline'],f.cwd,f.env);
  await writeFile(join(f.cwd,'crates/core/src/lib.rs'),'pub fn value()->u32{42}\n// core capability\n');
  await commit(f,'feat(core): add a core capability');
  return native.packages.map(p=>p.name).sort();
 };
 const unchanged=async(f,before)=>assert.deepEqual(await snapshot(f),{...before,refs:await ok('git',['ls-remote','origin'],f.cwd)});
 const refs=async f=>(await ok('git',['--git-dir',f.remote,'for-each-ref','--format=%(objectname) %(refname)','refs/semantic-release-workspace/artifacts'],root)).trim().split('\n').filter(Boolean);
 const packages=async f=>(await readFile(f.cargoLog,'utf8')).split('\n').filter(x=>x.startsWith('package '));
 const journal=async(f,label)=>{const listing=(await ok('git',['--git-dir',f.remote,'notes','--ref=refs/notes/semantic-release-workspace','list'],root)).trim().split('\n').filter(Boolean);assert.equal(listing.length,1);const value=JSON.parse(await ok('git',['--git-dir',f.remote,'notes','--ref=refs/notes/semantic-release-workspace','show',listing[0].split(' ')[1]],root));await writeFile(join(evidence,label+'-journal.json'),JSON.stringify(value,null,2));return value;};
 const proof=async(f,label,want,before)=>{
  const archives=[];
  for(const [name,version] of want){
   const a=await archivedPackage(f,name,version,label+'-'+name);
   const entry=f.server.state().cargo[name][version];
   const response=await fetch(`${f.server.url}/cargo/api/v1/crates/${name}/${version}/download`);assert.equal(response.status,200);
   const downloaded=Buffer.from(await response.arrayBuffer());assert.equal(createHash('sha256').update(downloaded).digest('hex'),a.sha256);assert.equal(a.sha256,entry.cksum);
   const manifest=JSON.parse(JSON.stringify(parse(a.normalizedManifest)));
   assert.equal(manifest.package.name,name);assert.equal(manifest.package.version,version);assert.equal(manifest.package.edition,'2024');assert.equal(manifest.package.license,'MIT');
   if(name==='fixture-adapter')assert.deepEqual(manifest.dependencies,{renamed:{package:'fixture-core',version:'='+want.find(x=>x[0]==='fixture-core')[1],'registry-index':`sparse+${f.server.url}/cargo/index/`}});
   assert.equal((await ok('git',['rev-parse',`cargo/${name}@${version}^`],f.cwd)).trim(),before.head.trim());
   archives.push({name,version,sha256:a.sha256,ref:a.ref,manifest});
  }
  const adapter=want.find(x=>x[0]==='fixture-adapter');if(adapter){const d=join(f.d,'consume-'+label);await mkdir(d);await downstream({...f,d},adapter[1]);}
  assert.ok(!(await ok('git',['tag'],f.cwd)).includes('cargo/private-'));
  assert.ok(!f.server.state().requests.some(x=>/private-(?:outer|inner|prefix|helper)/.test(x.path)));
  await unchanged(f,before);return archives;
 };
 for(const failure of ['none','registry-rejection','native-package-failure'])await scenario('alpha7-nested-'+failure,()=>withFixture('alpha7-nested-'+failure,files,{},async f=>{
  const nativeMembers=await setup(f),before=await snapshot(f);
  await success(f,'alpha7-nested-'+failure+'-dry',['--dry-run']);assert.deepEqual(await snapshot(f),before);assert.equal(f.server.state().requests.length,0);assert.equal((await packages(f)).length,0);
  let firstExit=0,retained=[],firstPackages=0,pending;
  if(failure==='registry-rejection')f.server.control('reject-second');
  if(failure==='native-package-failure'){
   const cargo=(await ok('rustup',['which','cargo'],root)).trim(),marker=join(f.d,'fail-once');await writeFile(marker,'');
   const q=v=>"'"+v.replaceAll("'","'\"'\"'")+"'";
   await writeFile(join(f.d,'tools/cargo'),`#!/bin/sh\nprintf '%s\\n' "$*" >> ${q(f.cargoLog)}\nif [ "$1" = package ] && [ "\${PWD##*/crates/outer/inner/}" = nested ] && [ -f ${q(marker)} ]; then\nrm ${q(marker)}\nprintf '%s\\n' ALPHA7_CONTROLLED_NESTED_PACKAGE_FAILURE >> ${q(f.nativeStderr)}\nexit 1\nfi\nexec ${q(cargo)} "$@" 2>> ${q(f.nativeStderr)}\n`);
  }
  if(failure!=='none'){
   const first=await release(f,'alpha7-nested-'+failure+'-first');firstExit=first.code;assert.notEqual(first.code,0,first.out);assert.deepEqual(f.server.state().uploads,['cargo:fixture-core@1.1.0']);await unchanged(f,before);
   if(failure==='native-package-failure')assert.match(await readFile(f.nativeStderr,'utf8'),/ALPHA7_CONTROLLED_NESTED_PACKAGE_FAILURE/);
   retained=await refs(f);assert.equal(retained.length,failure==='registry-rejection'?2:1);firstPackages=(await packages(f)).length;assert.equal(firstPackages,2);
   pending=await journal(f,'alpha7-nested-'+failure+'-pending');assert.equal(pending.status,'pending');assert.equal(pending.execution.packages[0].published,true);assert.ok(pending.execution.packages[0].artifact);assert.equal(Boolean(pending.execution.packages[1].artifact),failure==='registry-rejection');
   const clone=join(f.d,'network-fresh');await ok('git',['clone','--no-local','--branch','main','file://'+f.remote,clone],root);f.cwd=clone;
   assert.equal(await ok('git',['for-each-ref','--format=%(refname)','refs/notes','refs/semantic-release-workspace'],clone),'');f.server.control('');
  }
  const retryBefore=await snapshot(f);await success(f,'alpha7-nested-'+failure+'-publish');
  assert.deepEqual(f.server.state().uploads,['cargo:fixture-core@1.1.0','cargo:fixture-adapter@1.0.1']);
  const archives=await proof(f,'alpha7-nested-'+failure,[['fixture-core','1.1.0'],['fixture-adapter','1.0.1']],retryBefore);
  const completed=await refs(f);for(const line of retained)assert.ok(completed.includes(line),'retained native bytes/ref must be reused');
  const complete=await journal(f,'alpha7-nested-'+failure+'-complete');assert.equal(complete.status,'complete');for(let i=0;i<complete.execution.packages.length;i++){const entry=complete.execution.packages[i];if(pending?.execution.packages[i].artifact)assert.deepEqual(entry.artifact,pending.execution.packages[i].artifact);assert.equal(entry.artifact.sha256,archives.find(a=>entry.id==='cargo:'+a.name).sha256);}
  assert.equal((await packages(f)).length,failure==='native-package-failure'?3:2);
  assert.deepEqual((await ok('git',['tag','--list','cargo/*'],f.cwd)).trim().split('\n').sort(),['cargo/fixture-adapter@1.0.1','cargo/fixture-core@1.1.0']);
  const settled=await snapshot(f),state=JSON.stringify(f.server.state()),calls=await packages(f);await success(f,'alpha7-nested-'+failure+'-no-change');assert.deepEqual(await snapshot(f),settled);assert.equal(JSON.stringify(f.server.state()),state);assert.deepEqual(await packages(f),calls);
  return {nativeMembers,coreOnlyLiteralFeat:true,firstExit,expectedFirstFailure:failure!=='none',freshNetworkClone:failure!=='none',retainedBeforeRetry:retained,retainedAfterRetry:completed,firstPackageCalls:firstPackages,totalPackageCalls:calls.length,archives,uploads:f.server.state().uploads,downstreamExit:0,sourceAndLockRestored:true,privatePrefixRequests:0,noChangeRequests:0};
 }));

 await scenario('alpha7-nested-diverged-cycle',()=>withFixture('alpha7-nested-diverged-cycle',files,{},async f=>{
  await setup(f);const phases=[],merges=[],inventory=[];
  const exact={stable:[['fixture-core','1.1.0'],['fixture-adapter','1.0.1']],alpha1:[['fixture-core','1.2.0-alpha.1'],['fixture-adapter','1.0.2-alpha.1']],alpha2:[['fixture-core','1.2.0-alpha.2'],['fixture-adapter','1.0.2-alpha.2']],mainOther:[['fixture-other','1.1.0']],promote:[['fixture-core','1.2.0'],['fixture-adapter','1.0.2']],hotfix:[['fixture-core','1.2.1'],['fixture-adapter','1.0.3']],next1:[['fixture-core','1.3.0-alpha.1'],['fixture-adapter','1.0.4-alpha.1']],next2:[['fixture-core','1.3.0-alpha.2'],['fixture-adapter','1.0.4-alpha.2']]};
  const phase=async label=>{const before=await snapshot(f);await success(f,'alpha7-nested-cycle-'+label);inventory.push(...exact[label].map(([n,v])=>`cargo:${n}@${v}`));assert.deepEqual(f.server.state().uploads,inventory);const archives=await proof(f,'alpha7-nested-cycle-'+label,exact[label],before);phases.push({label,source:before.head.trim(),expected:exact[label],archives});};
  const edit=async(name,message,label)=>{await writeFile(join(f.cwd,`crates/${name}/src/lib.rs`),`pub fn value()->u32{42}\n// ${label}\n`);await commit(f,message);};
  const merge=async(target,source,message)=>{await ok('git',['checkout',target],f.cwd);const first=(await ok('git',['rev-parse','HEAD'],f.cwd)).trim(),second=(await ok('git',['rev-parse',source],f.cwd)).trim();assert.equal((await run('git',['merge-base','--is-ancestor',first,second],f.cwd)).code,1);assert.equal((await run('git',['merge-base','--is-ancestor',second,first],f.cwd)).code,1);await ok('git',['merge','--no-ff',source,'-m',message],f.cwd);await ok('git',['push','origin',target],f.cwd);const parents=(await ok('git',['show','-s','--format=%P','HEAD'],f.cwd)).trim().split(' ');assert.deepEqual(parents,[first,second]);merges.push({target,source,first,second,parents,neitherTipWasAncestor:true});};
  await phase('stable');await ok('git',['checkout','-b','alpha'],f.cwd);await ok('git',['push','-u','origin','alpha'],f.cwd);
  await edit('core','feat: extend nested core on alpha','alpha-feature');await phase('alpha1');await edit('core','fix: refine nested core on alpha','alpha-fix');await phase('alpha2');
  await ok('git',['checkout','main'],f.cwd);await edit('other','feat: advance independent main crate','main-independent');await phase('mainOther');await merge('main','alpha','chore: merge alpha');await phase('promote');await edit('core','fix: correct stable nested core','main-hotfix');await phase('hotfix');
  await ok('git',['checkout','alpha'],f.cwd);await writeFile(join(f.cwd,'alpha-chore.txt'),'independent alpha work\n');await commit(f,'chore: keep alpha independently active');await merge('alpha','main','chore: backmerge main');
  const before=await snapshot(f),state=JSON.stringify(f.server.state());await success(f,'alpha7-nested-cycle-backmerge-no-duplicate');assert.deepEqual(await snapshot(f),before);assert.equal(JSON.stringify(f.server.state()),state);
  await edit('core','feat: extend nested core after backmerge','next-feature');await phase('next1');await edit('core','fix: refine nested core after backmerge','next-fix');await phase('next2');
  return {phases,merges,expectedUploads:inventory,actualUploads:f.server.state().uploads,backmergeOnlyUploads:0,nativePackageCalls:(await packages(f)).length,sourceAndLockRestored:true};
 }));
}
