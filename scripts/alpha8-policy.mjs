import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {parse} from 'smol-toml';

export async function runPolicy(h) {
 const {scenario,withFixture,graph,ok,commit,success,snapshot,downstream,archivedPackage}=h;
 for(const policy of ['omitted','false','true']) await scenario('alpha8-policy-'+policy,()=>withFixture('alpha8-policy-'+policy,graph(),{synchronizeDependents:policy==='omitted'?undefined:policy==='true'},async f=>{
  const sourceConfig=await readFile(join(f.cwd,'release.config.mjs'),'utf8');
  if(policy==='omitted')assert.ok(!sourceConfig.includes('synchronizeDependents'));
  await success(f,'alpha8-policy-'+policy+'-baseline');
  const before=await snapshot(f),baseline=await archivedPackage(f,'fixture-adapter','1.1.0','alpha8-policy-'+policy+'-baseline-adapter');
  const originalRequirement=parse(baseline.normalizedManifest).dependencies['fixture-core'].version;
  await writeFile(join(f.cwd,'crates/core/src/lib.rs'),'pub fn value()->u32{42}\n// incompatible new core API\n');
  await commit(f,'feat(core): extend core API\n\nBREAKING CHANGE: independently advance core major');
  const changed=await snapshot(f),requests=f.server.state().requests.length,calls=(await readFile(f.cargoLog,'utf8')).split('\n').filter(x=>x.startsWith('package ')).length;
  await success(f,'alpha8-policy-'+policy+'-dry',['--dry-run']);
  assert.deepEqual(await snapshot(f),changed);assert.equal(f.server.state().requests.length,requests);
  assert.equal((await readFile(f.cargoLog,'utf8')).split('\n').filter(x=>x.startsWith('package ')).length,calls);
  await success(f,'alpha8-policy-'+policy+'-core');
  const expected=['cargo:fixture-core@1.1.0','cargo:fixture-adapter@1.1.0','cargo:fixture-core@2.0.0',...(policy==='true'?['cargo:fixture-adapter@1.1.1']:[])];
  assert.deepEqual(f.server.state().uploads,expected);assert.deepEqual(await snapshot(f),{...changed,refs:await ok('git',['ls-remote','origin'],f.cwd)});
  if(policy!=='true'){
   assert.equal(await ok('git',['tag','--list','cargo/fixture-adapter@1.1.1'],f.cwd),'');
   await writeFile(join(f.cwd,'crates/adapter/src/lib.rs'),'pub fn value()->u32{fixture_core::value()}\n// independent adapter fix\n');
   await commit(f,'fix(adapter): refine adapter independently');
   await success(f,'alpha8-policy-'+policy+'-adapter');
   expected.push('cargo:fixture-adapter@1.1.1');assert.deepEqual(f.server.state().uploads,expected);
  }
  const archive=await archivedPackage(f,'fixture-adapter','1.1.1','alpha8-policy-'+policy+'-adapter');
  const requirement=parse(archive.normalizedManifest).dependencies['fixture-core'].version;
  assert.equal(requirement,policy==='true'?'2.0.0':originalRequirement);
  await downstream(f,'1.1.1');
  const settled=await snapshot(f),state=JSON.stringify(f.server.state()),native=await readFile(f.cargoLog,'utf8');
  await success(f,'alpha8-policy-'+policy+'-no-change');assert.deepEqual(await snapshot(f),settled);assert.equal(JSON.stringify(f.server.state()),state);assert.equal(await readFile(f.cargoLog,'utf8'),native);
  return {policy,defaultOptionAbsent:policy==='omitted',baselineHead:before.head.trim(),uploads:expected,coreVersion:'2.0.0',adapterVersion:'1.1.1',adapterRequirement:requirement,originalPublishedRequirement:originalRequirement,nativeDownstreamExit:0,dryRequests:0,dryNativePackages:0,noChangeRequests:0,sourceRestored:true};
 }));
}
