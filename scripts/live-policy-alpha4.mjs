import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';

export const candidate='0.2.0-alpha4.1';
export const adapter='enkhjile-srw-e2e-adapter';
export const core='enkhjile-srw-e2e-core';
export const coreChecksum='df6606e5d05d921b61973da900fe12f2885704d908f7da112273edd784333b71';
export const repository='enkhjile/semantic-release-workspace-e2e-cargo';
const frozen='1452d281faec526927ef9c2587c5f6e2359c14a3';
const oldScope='01a83be8da2d6863354a8d404388e5433ccf10fff85f46e8dc47bda54bc36ebf';
const sharedNotes='refs/notes/semantic-release-0-workspace';
export const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
export const git=(cwd,...args)=>execFileSync('git',args,{cwd,encoding:'utf8'}).trim();
const fetchRef=(cwd,ref)=>git(cwd,'fetch','--no-tags','origin',`+${ref}:${ref}`);
export async function inventory(cwd,source) {
  const result=[];
  for(const name of [core,adapter]) {
    const response=await fetch(`https://crates.io/api/v1/crates/${name}`,{headers:{'user-agent':'semantic-release-workspace acceptance'}});
    assert.equal(response.status,200);
    const data=await response.json();
    const versions=data.versions.map(x=>x.num).sort();
    assert.deepEqual(versions,name===core?['0.1.0','0.2.0-alpha.1']:versions.includes(candidate)?['0.1.0',candidate]:['0.1.0']);
    result.push({name,versions,releases:data.versions});
  }
  const oldCore=result[0].releases.find(x=>x.num==='0.2.0-alpha.1');
  assert.equal(oldCore.checksum,coreChecksum);
  assert.deepEqual(oldCore.trustpub_data,{provider:'github',repository,run_id:'40265063955',sha:frozen});
  const accepted=result[1].releases.find(x=>x.num===candidate);
  let ownership=null;
  if(accepted) {
    assert.equal(accepted.trustpub_data?.provider,'github');
    assert.equal(accepted.trustpub_data.repository,repository);
    assert.equal(accepted.trustpub_data.sha,source);
    assert.match(accepted.trustpub_data.run_id,/^\d+$/);
    const ref=`refs/notes/workspace-release-branches/${sha256('alpha4-live')}`;
    fetchRef(cwd,ref);
    const anchor=git(cwd,'rev-list','--max-parents=0','HEAD');
    const journal=JSON.parse(git(cwd,'notes',`--ref=${ref}`,'show',anchor));
    assert.equal(journal.head,source);
    assert.equal(journal.branch,'alpha4-live');
    assert.equal(journal.planning.plan.packages.length,1);
    assert.equal(journal.planning.plan.packages[0].id,'cargo:'+adapter);
    assert.equal(journal.planning.plan.packages[0].nextVersion,candidate);
    assert.equal(journal.execution.packages.length,1);
    const entry=journal.execution.packages[0];
    assert.equal(entry.id,'cargo:'+adapter);
    assert.equal(entry.intent,true);
    assert.equal(entry.artifact.sha256,accepted.checksum);
    assert.ok(entry.artifact.ref.includes('/'+source+'/'));
    fetchRef(cwd,entry.artifact.ref);
    assert.equal(git(cwd,'rev-parse',entry.artifact.ref),entry.artifact.commit);
    assert.equal(git(cwd,'rev-parse',entry.artifact.commit+'^'),journal.execution.prepared);
    assert.equal(git(cwd,'rev-parse',journal.execution.prepared+'^'),source);
    const bytes=execFileSync('git',['show',entry.artifact.ref+':artifact'],{cwd});
    assert.equal(sha256(bytes),accepted.checksum);
    const metadata=JSON.parse(git(cwd,'show',entry.artifact.ref+':metadata.json'));
    assert.equal(metadata.name,adapter);assert.equal(metadata.vers,candidate);
    ownership={journalStatus:journal.status,artifactRef:entry.artifact.ref,artifactCommit:entry.artifact.commit,prepared:journal.execution.prepared,sha256:accepted.checksum,acceptedProvenance:accepted.trustpub_data};
  }
  return {packages:result,accepted:accepted??null,ownership,acceptedVersionCount:accepted?4:3};
}

export function protectedState(cwd) {
  const refs=Object.fromEntries(git(cwd,'ls-remote','origin').split('\n').map(x=>x.split(/\s+/).reverse()));
  const expected={
    'refs/heads/main':'1f45112c7780363a0edf2a24a8abbdffc8e48d9a',
    'refs/heads/alpha':'d55358a490e3006bbdd192b2dcc7076167254659',
    'refs/heads/alpha3-live':frozen,
    'refs/notes/workspace-release-branches/9d6a189af3b92ab98eb296efd0f7f7a14d8b006bdd2cf9ea620d454dc98ee859':'1e4bad05b9ab65d007723f771a2b1c2743c6bb54',
    [`refs/semantic-release-workspace/prepared/${oldScope}/${frozen}`]:'a82f215c9d7af06a5423ea46cd9fbca92c2c5d92',
    [`refs/semantic-release-workspace/artifacts/${oldScope}/${frozen}/f1337bd7722fc4850aba2f598cbfa338965784c9e906d963f19b824300c2cb6f`]:'5ad5f5601efbd4f413c2423102c7a3c01b234479',
    'refs/tags/cargo/enkhjile-srw-e2e-core@0.2.0-alpha.1':'a82f215c9d7af06a5423ea46cd9fbca92c2c5d92',
    'refs/tags/workspace-v1.0.0-alpha.1':frozen,
    'refs/tags/workspace-v1.0.0-alpha.2':frozen,
  };
  for(const [ref,oid]of Object.entries(expected))assert.equal(refs[ref],oid,ref+' must preserve frozen state');
  fetchRef(cwd,sharedNotes);
  const notes=Object.fromEntries(git(cwd,'notes',`--ref=${sharedNotes}`,'list').split('\n').filter(Boolean).map(line=>{const [blob,target]=line.split(' ');return [target,blob];}));
  const originalTip='49186f6635bd153597dd67b59bd36549f6e7a1f7';
  git(cwd,'merge-base','--is-ancestor',originalTip,refs[sharedNotes]);
  const oldEntries=git(cwd,'ls-tree','-r','--format=%(objectname) %(path)',originalTip).split('\n').filter(Boolean);
  for(const line of oldEntries){const [blob,path]=line.split(' '),target=path.replaceAll('/','');assert.equal(notes[target],blob,'original coordinator note bytes must stay exact');}
  return {frozenRefs:expected,sharedNotesTip:refs[sharedNotes],sharedNotes:notes,originalSharedNotesTip:originalTip,originalSharedEntriesUnchanged:oldEntries.length,originalSharedNotesCommitIsAncestor:true};
}

export function preserved(cwd,before,after) {
  assert.deepEqual(after.frozenRefs,before.frozenRefs);
  git(cwd,'merge-base','--is-ancestor',before.sharedNotesTip,after.sharedNotesTip);
  for(const [target,blob]of Object.entries(before.sharedNotes))assert.equal(after.sharedNotes[target],blob,'old coordinator note bytes must stay exact');
  return {frozenRefsUnchanged:Object.keys(before.frozenRefs).length,oldCoordinatorEntriesUnchanged:Object.keys(before.sharedNotes).length,oldNotesCommitIsAncestor:true};
}
