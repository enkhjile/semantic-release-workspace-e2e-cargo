import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {parse} from 'smol-toml';

export async function runSettingsCycles(h){
 const {scenario,withFixture,graph,pkg,ok,run,commit,success,snapshot,downstream,archivedPackage,root}=h;
 // Catch stale baselines and duplicate covered releases in genuinely diverged
 // histories. Each tuple is a hand-derived literal [core,adapter,other] oracle.
 const exact={stable:['1.1.0','1.1.0','1.1.0'],alpha1:['1.2.0-alpha.1','1.1.1-alpha.1',null],alpha2:['1.2.0-alpha.2','1.1.1-alpha.2',null],mainOther:[null,null,'1.2.0'],promote:['1.2.0','1.1.1',null],hotfix:['1.2.1','1.1.2',null],next1:['1.3.0-alpha.1','1.1.3-alpha.1',null],next2:['1.3.0-alpha.2','1.1.3-alpha.2',null]};
 // A proposed path-only requirement is a Cargo caret requirement. Its next
 // prerelease patch remains compatible, so only core advances to alpha.2.
 const local={stable:['1.1.0','1.1.0','1.1.0'],alpha1:['2.0.0-alpha.1','1.1.1-alpha.1',null],alpha2:['2.0.0-alpha.2',null,null],mainOther:[null,null,'1.2.0'],promote:['2.0.0','1.1.1',null],hotfix:['2.0.1',null,null],next1:['3.0.0-alpha.1','1.1.2-alpha.1',null],next2:['3.0.0-alpha.2',null,null]};
 for(const mode of ['runtime','build','dev','inherited','renamed','optional','target','pathonly-runtime','pathonly-build'])await scenario('settings-diverged-cycle-'+mode,()=>{
  const pathonly=mode.startsWith('pathonly'),kind=mode==='inherited'?'shared':mode.includes('build')?'build':pathonly?'runtime':mode;
  const files=graph(kind);for(const key of Object.keys(files))if(key.endsWith('Cargo.toml'))files[key]=files[key].replaceAll(',version="1.0.0"',pathonly?'':',version="=1.0.0"');
  if(mode==='inherited'){files['Cargo.toml']+='[workspace.package]\nversion="1.0.0"\nedition="2021"\nlicense="MIT"\n';for(const name of ['core','adapter'])files[`crates/${name}/Cargo.toml`]=files[`crates/${name}/Cargo.toml`].replace('version="1.0.0"\nedition="2021"\nlicense="MIT"','version.workspace=true\nedition.workspace=true\nlicense.workspace=true');}
  files['crates/other/Cargo.toml']=pkg('fixture-other');files['crates/other/src/lib.rs']='pub fn value()->u32{42}\n';
  return withFixture('settings-diverged-cycle-'+mode,files,{},async f=>{
   const phases=[],merges=[],inventory=[];let adapter='1.1.0';
   const phase=async label=>{const want=[...(pathonly?local:exact)[label]];if(kind==='dev'&&label!=='stable')want[1]=null;if(want[1])adapter=want[1];const before=await snapshot(f);await success(f,'settings-cycle-'+mode+'-'+label);const added=want.flatMap((version,i)=>version?[`cargo:${['fixture-core','fixture-adapter','fixture-other'][i]}@${version}`]:[]);inventory.push(...added);assert.deepEqual(f.server.state().uploads,inventory);const archives=[];for(let i=0;i<want.length;i++){const version=want[i];if(!version)continue;const name=['fixture-core','fixture-adapter','fixture-other'][i];const a=await archivedPackage(f,name,version,`settings-cycle-${mode}-${label}-${name}`);assert.equal(a.sha256,f.server.state().cargo[name][version].cksum);const manifest=JSON.parse(JSON.stringify(parse(a.normalizedManifest)));assert.equal(manifest.package.version,version);assert.equal((await ok('git',['rev-parse',`cargo/${name}@${version}^`],f.cwd)).trim(),before.head.trim());if(name==='fixture-adapter'){const table=kind==='build'?'build-dependencies':kind==='dev'?'dev-dependencies':'dependencies';const dependency=manifest[table][kind==='renamed'?'renamed':'fixture-core'];assert.equal(dependency.version,(pathonly?'':'=')+want[0]);}assert.match(await ok('tar',['-xOf',a.path,`${name}-${version}/CHANGELOG.md`],root),new RegExp(version.replaceAll('.','\\.')));archives.push({name,version,sha256:a.sha256,ref:a.ref,manifest});}const d=join(f.d,'consumer-'+label);await mkdir(d);await downstream({...f,d},adapter);assert.deepEqual(await snapshot(f),{...before,refs:await ok('git',['ls-remote','origin'],f.cwd)});assert.equal((await readFile(f.cargoLog,'utf8')).split('\n').filter(x=>x.startsWith('package ')).length,inventory.length);phases.push({label,source:before.head.trim(),literalCommit:(await ok('git',['show','-s','--format=%B','HEAD'],f.cwd)).trim(),expectedVersions:want,actualUploads:added,archives,downstreamExit:0});};
   const edit=async(name,message,label)=>{await writeFile(join(f.cwd,`crates/${name}/src/lib.rs`),`pub fn value()->u32{42}\n// ${label}\n`);await commit(f,message);};
   const merge=async(target,source,message)=>{await ok('git',['checkout',target],f.cwd);const first=(await ok('git',['rev-parse','HEAD'],f.cwd)).trim(),second=(await ok('git',['rev-parse',source],f.cwd)).trim();assert.equal((await run('git',['merge-base','--is-ancestor',first,second],f.cwd)).code,1);assert.equal((await run('git',['merge-base','--is-ancestor',second,first],f.cwd)).code,1);await ok('git',['merge','--no-ff',source,'-m',message],f.cwd);await ok('git',['push','origin',target],f.cwd);const parents=(await ok('git',['show','-s','--format=%P','HEAD'],f.cwd)).trim().split(' ');assert.deepEqual(parents,[first,second]);merges.push({message,target,source,first,second,parents,neitherTipWasAncestor:true,merge:(await ok('git',['rev-parse','HEAD'],f.cwd)).trim()});};
   await ok('cargo',['test','--workspace','--all-features','--locked'],f.cwd,f.env);await phase('stable');await ok('git',['checkout','-b','alpha'],f.cwd);await ok('git',['push','-u','origin','alpha'],f.cwd);
   await edit('core',pathonly?'feat: extend core before promotion\n\nBREAKING CHANGE: introduce incompatible core API':'feat: extend core before promotion','alpha-feature');await phase('alpha1');
   await edit('core','fix: correct core before promotion','alpha-fix');await phase('alpha2');
   await ok('git',['checkout','main'],f.cwd);await edit('other','feat: advance independent main package','main-independent');await phase('mainOther');
   await merge('main','alpha','chore: merge alpha');await phase('promote');
   await edit('core','fix: correct stable core after promotion','main-hotfix');await phase('hotfix');
   await ok('git',['checkout','alpha'],f.cwd);await writeFile(join(f.cwd,'unowned-alpha.txt'),'independent unreleased alpha chore\n');await commit(f,'chore: keep alpha independently active');
   await merge('alpha','main','chore: backmerge main');const before=await snapshot(f),requests=f.server.state().requests.length;await success(f,'settings-cycle-'+mode+'-backmerge-no-duplicate');assert.deepEqual(f.server.state().uploads,inventory);assert.deepEqual(await snapshot(f),before);assert.equal(f.server.state().requests.length,requests);
   await edit('core',pathonly?'feat: extend core after backmerge\n\nBREAKING CHANGE: introduce the next incompatible API':'feat: extend core after backmerge','next-feature');await phase('next1');
   await edit('core','fix: refine core after backmerge','next-fix');await phase('next2');
   const clone=join(f.d,'network-fresh');await ok('git',['clone','--no-local','--branch','alpha','file://'+f.remote,clone],root);f.cwd=clone;assert.equal(await ok('git',['for-each-ref','--format=%(refname)','refs/notes','refs/semantic-release-workspace'],clone),'');const fresh=await snapshot(f),calls=f.server.state().requests.length;await success(f,'settings-cycle-'+mode+'-fresh-no-change');assert.deepEqual(await snapshot(f),fresh);assert.equal(f.server.state().requests.length,calls);assert.deepEqual(f.server.state().uploads,inventory);
   return {phases,merges,expectedUploads:inventory,actualUploads:f.server.state().uploads,backmergeOnlyUploads:0,freshCloneNoChangeRequests:0};
  });
 });
}
