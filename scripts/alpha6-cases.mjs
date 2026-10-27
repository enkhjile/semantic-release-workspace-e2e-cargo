import assert from 'node:assert/strict';
import {mkdir, readFile, writeFile, rm} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {parse} from 'smol-toml';

// These checks exercise the installed public package through semantic-release.
// Each expectation is independently derived from native Cargo or fixed versions.
export async function runAlpha6(h) {
  const {scenario, withFixture, graph, pkg, ok, run, put, commit, config,
    release, success, snapshot, downstream, archivedPackage, root, evidence} = h;
  const unchanged = async (f, before) => {
    assert.deepEqual(await snapshot(f), {...before, refs:await ok('git',['ls-remote','origin'],f.cwd)});
  };
  const normalized = async (f, name, version, label) => {
    const archive=await archivedPackage(f,name,version,label);
    return {...archive, parsed:JSON.parse(JSON.stringify(parse(archive.normalizedManifest)))};
  };

  // Catch treating native-omitted versionless dev edges as public runtime edges,
  // including private changed/unchanged helpers and dangling feature references.
  for (const mode of ['direct','target','inherited','features','legacy-features']) {
    for (const changed of (['direct','target','inherited'].includes(mode)?[false,true]:[true])) {
      const label=`alpha6-dev-${mode}-${changed?'changed':'unchanged'}`;
      await scenario(label,()=>withFixture(label,{
        'Cargo.toml':'[workspace]\nmembers=["crates/*"]\nresolver="2"\n'+(mode==='inherited'?'[workspace.dependencies]\nhelper={package="fixture-private",path="crates/helper"}\n':''),
        'crates/helper/Cargo.toml':pkg('fixture-private','publish=[]\n[features]\nextra=[]\n'),
        'crates/helper/src/lib.rs':'pub fn value()->u32{42}\n',
        'crates/adapter/Cargo.toml':pkg('fixture-adapter',`\n${mode==='target'?"[target.'cfg(unix)'.dev-dependencies]":'[dev-dependencies]'}\n${mode==='inherited'?'helper.workspace=true':'helper={package="fixture-private",path="../helper"}'}\n`+(mode==='legacy-features'?'[dev_dependencies]\nhelper={package="fixture-private",version="=1.0.0"}\n':'')+(['features','legacy-features'].includes(mode)?'[features]\nlocal=[]\ntest-extra=["helper/extra","local"]\n':'')),
        'crates/adapter/src/lib.rs':'pub fn value()->u32{42}\n#[test]fn private_helper(){assert_eq!(helper::value(),42);}\n',
      },{},async f=>{
        if(!changed){await ok('git',['commit','--amend','-m','chore: set up private helper workspace'],f.cwd);await ok('git',['push','--force-with-lease','origin','main'],f.cwd);await writeFile(join(f.cwd,'crates/adapter/src/lib.rs'),'pub fn value()->u32{42}\n#[test]fn private_helper(){assert_eq!(helper::value(),42);}\n// changed public adapter only\n');await commit(f,'feat: introduce public adapter behavior');}
        await ok('cargo',['metadata','--format-version','1','--no-deps'],f.cwd,f.env);
        await ok('cargo',['test','--workspace','--all-features','--locked'],f.cwd,f.env);
        const nativeTarget=join(f.d,'native-baseline');
        await ok('cargo',['package','--offline','--registry','fixture','-p','fixture-adapter','--target-dir',nativeTarget],f.cwd,f.env);
        const native=await ok('tar',['-xOf',join(nativeTarget,'package/fixture-adapter-1.0.0.crate'),'fixture-adapter-1.0.0/Cargo.toml'],root);
        assert.ok(!native.includes('fixture-private'));
        if(['features','legacy-features'].includes(mode))assert.deepEqual(JSON.parse(JSON.stringify(parse(native).features)),{local:[],'test-extra':['local']});
        const before=await snapshot(f),requestCount=f.server.state().requests.length;
        await success(f,label+'-dry',['--dry-run']);
        assert.deepEqual(await snapshot(f),before);
        assert.equal(f.server.state().requests.length,requestCount);
        await success(f,label);
        assert.deepEqual(f.server.state().uploads,['cargo:fixture-adapter@1.1.0']);
        const archive=await normalized(f,'fixture-adapter','1.1.0',label);
        assert.ok(!archive.normalizedManifest.includes('fixture-private'));
        assert.deepEqual(f.server.state().cargo['fixture-adapter']['1.1.0'].metadata.deps,[]);
        if(['features','legacy-features'].includes(mode))assert.deepEqual(archive.parsed.features,{local:[],'test-extra':['local']});
        assert.ok(!f.server.state().requests.some(x=>x.path.includes('fixture-private')));
        assert.ok(!(await ok('git',['tag'],f.cwd)).includes('fixture-private'));
        await downstream(f);await unchanged(f,before);
        const noChange=await snapshot(f),calls=f.server.state().requests.length;
        await success(f,label+'-no-change');
        assert.deepEqual(await snapshot(f),noChange);assert.equal(f.server.state().requests.length,calls);
        return {nativeBaseline:true,nativeManifest:native,archiveSha256:archive.sha256,uploads:f.server.state().uploads,privateHelperChanged:changed,sourceRestored:true,noChangeHttp:0};
      }));
    }
  }

  // Catch over-pruning shared runtime and explicit versioned development edges.
  for(const mode of ['shared-runtime','versioned-dev'])await scenario('alpha6-dev-retained-'+mode,()=>{
    const files=graph('shared');
    if(mode==='shared-runtime')files['Cargo.toml']=files['Cargo.toml'].replace(',version="1.0.0"','');
    files['crates/core/Cargo.toml']+='[features]\nextra=[]\n';
    if(mode==='shared-runtime')files['crates/adapter/Cargo.toml']+='[dev-dependencies]\nfixture-core.workspace=true\n[features]\nlocal=[]\ntest-extra=["fixture-core/extra","local"]\n';
    else files['crates/adapter/Cargo.toml']=pkg('fixture-adapter','[dev-dependencies]\nhelper={package="fixture-core",path="../core",version="=1.0.0"}\n[features]\nlocal=[]\ntest-extra=["helper/extra","local"]\n');
    if(mode==='versioned-dev')files['crates/adapter/src/lib.rs']='pub fn value()->u32{42}\n#[test]fn versioned_helper(){assert_eq!(helper::value(),42);}\n';
    return withFixture('alpha6-dev-retained-'+mode,files,{},async f=>{
      await ok('cargo',['test','--workspace','--all-features','--locked'],f.cwd,f.env);
      const before=await snapshot(f);await success(f,'alpha6-dev-retained-'+mode);
      assert.deepEqual(f.server.state().uploads,['cargo:fixture-core@1.1.0','cargo:fixture-adapter@1.1.0']);
      const archive=await normalized(f,'fixture-adapter','1.1.0','alpha6-dev-retained-'+mode);
      if(mode==='shared-runtime'){
        assert.equal(archive.parsed.dependencies['fixture-core'].version,'1.1.0');
        assert.ok(!archive.parsed['dev-dependencies']?.['fixture-core']);
        assert.deepEqual(archive.parsed.features,{local:[],'test-extra':['fixture-core/extra','local']});
      }else{
        assert.equal(archive.parsed['dev-dependencies'].helper.version,'=1.1.0');
        assert.deepEqual(archive.parsed.features,{local:[],'test-extra':['helper/extra','local']});
      }
      await downstream(f);await unchanged(f,before);
      return {uploads:f.server.state().uploads,normalizedManifest:archive.normalizedManifest,sourceRestored:true};
    });
  });

  // Catch stale prerelease baselines after stable promotion/backmerge. Runtime
  // and build dependents coordinate; a development-only dependent stays stable.
  for(const kind of ['runtime','build','dev'])await scenario('alpha6-cycle-'+kind,()=>{const files=graph(kind);files['crates/adapter/Cargo.toml']=files['crates/adapter/Cargo.toml'].replace('version="1.0.0"}', 'version="=1.0.0"}');return withFixture('alpha6-cycle-'+kind,files,{},async f=>{
    const inventory=[];
    const phase=async(label,want)=>{
      const before=await snapshot(f);await success(f,'alpha6-cycle-'+kind+'-'+label);
      inventory.push(...want);assert.deepEqual(f.server.state().uploads,inventory);
      for(const entry of want){const [,name,version]=entry.match(/^cargo:(.*)@(.*)$/);const archive=await normalized(f,name,version,`alpha6-cycle-${kind}-${label}-${name}`);assert.equal(archive.parsed.package.version,version);assert.equal((await ok('git',['rev-parse',`cargo/${name}@${version}^`],f.cwd)).trim(),before.head.trim());if(name==='fixture-adapter'){const table=kind==='runtime'?'dependencies':kind==='build'?'build-dependencies':'dev-dependencies';assert.equal(archive.parsed[table]['fixture-core'].version,'='+want[0].split('@')[1]);}}
      const consumerRoot=join(f.d,'consumer-'+label);await mkdir(consumerRoot);await downstream({...f,d:consumerRoot},want.find(x=>x.startsWith('cargo:fixture-adapter@'))?.split('@')[1]??'1.1.0');
      await unchanged(f,before);
    };
    await phase('stable',['cargo:fixture-core@1.1.0','cargo:fixture-adapter@1.1.0']);
    await ok('git',['checkout','-b','alpha'],f.cwd);await ok('git',['push','-u','origin','alpha'],f.cwd);
    const edit=async(msg,label)=>{await writeFile(join(f.cwd,'crates/core/src/lib.rs'),`pub fn value()->u32{42}\n// ${label}\n`);await commit(f,msg);};
    await edit('feat: extend core before promotion','before-promotion');
    await phase('alpha',['cargo:fixture-core@1.2.0-alpha.1',...(kind==='dev'?[]:['cargo:fixture-adapter@1.1.1-alpha.1'])]);
    await ok('git',['checkout','main'],f.cwd);await ok('git',['merge','--no-ff','alpha','-m','chore: promote alpha'],f.cwd);await ok('git',['push','origin','main'],f.cwd);
    await phase('promote',['cargo:fixture-core@1.2.0',...(kind==='dev'?[]:['cargo:fixture-adapter@1.1.1'])]);
    await ok('git',['checkout','alpha'],f.cwd);await ok('git',['merge','--ff-only','main'],f.cwd);await ok('git',['push','origin','alpha'],f.cwd);
    await edit('fix: correct core after backmerge','after-backmerge-1');
    const dryBefore=await snapshot(f),req=f.server.state().requests.length;
    await success(f,'alpha6-cycle-'+kind+'-dry',['--dry-run']);assert.deepEqual(await snapshot(f),dryBefore);assert.equal(f.server.state().requests.length,req);
    await phase('next1',['cargo:fixture-core@1.2.1-alpha.1',...(kind==='dev'?[]:['cargo:fixture-adapter@1.1.2-alpha.1'])]);
    await edit('fix: refine core after backmerge','after-backmerge-2');
    await phase('next2',['cargo:fixture-core@1.2.1-alpha.2',...(kind==='dev'?[]:['cargo:fixture-adapter@1.1.2-alpha.2'])]);
    const before=await snapshot(f),requests=f.server.state().requests.length;
    await success(f,'alpha6-cycle-'+kind+'-no-change');assert.deepEqual(await snapshot(f),before);assert.equal(f.server.state().requests.length,requests);
    await downstream(f,kind==='dev'?'1.1.0':'1.1.2-alpha.2');
    return {uploads:inventory,noChangeHttp:0,phases:['stable','alpha','promote','backmerge','next.1','next.2']};
  });});

  // A network-style ordinary clone starts without custom refs or prepared
  // parents; recovery must fetch retained state before checking ancestry.
  for(const control of ['reject','reject-second','once-drop-unreadable'])await scenario('alpha6-network-recovery-'+control,()=>withFixture('alpha6-network-'+control,graph(),{},async f=>{
    f.server.control(control);const initial=await release(f,'alpha6-network-'+control+'-first');assert.notEqual(initial.code,0,initial.out);
    const beforeUploads=[...f.server.state().uploads],firstPacks=(await readFile(f.cargoLog,'utf8')).split('\n').filter(x=>x.startsWith('package '));
    const artifactRefs=(await ok('git',['--git-dir',f.remote,'for-each-ref','--format=%(objectname) %(refname)','refs/semantic-release-workspace/artifacts'],root)).trim();
    const cwd=join(f.d,'network-fresh');await ok('git',['clone','--no-local','f'+'ile://'+f.remote,cwd],root);f.cwd=cwd;
    assert.equal(await ok('git',['for-each-ref','--format=%(refname)','refs/semantic-release-workspace','refs/notes'],cwd),'');
    f.server.control('');await success(f,'alpha6-network-'+control+'-retry');
    assert.deepEqual(f.server.state().uploads,['cargo:fixture-core@1.1.0','cargo:fixture-adapter@1.1.0']);
    assert.deepEqual(f.server.state().uploads.slice(0,beforeUploads.length),beforeUploads);
    const packs=(await readFile(f.cargoLog,'utf8')).split('\n').filter(x=>x.startsWith('package '));
    assert.equal(packs.length,2);assert.deepEqual(packs.slice(0,firstPacks.length),firstPacks);
    const refsAfter=(await ok('git',['--git-dir',f.remote,'for-each-ref','--format=%(objectname) %(refname)','refs/semantic-release-workspace/artifacts'],root)).trim();
    for(const line of artifactRefs.split('\n').filter(Boolean))assert.ok(refsAfter.split('\n').includes(line));
    await downstream(f);assert.equal(await ok('git',['status','--porcelain'],cwd),'');
    return {initialExit:initial.code,networkStyleClone:true,initialPackageCalls:firstPacks.length,totalPackageCalls:2,retainedArtifactRefs:artifactRefs,uploads:f.server.state().uploads};
  }));

  // Cargo identity history follows the crate across directories; a committed
  // changelog override replaces the inherited history at the new location.
  for(const override of [false,true])await scenario('alpha6-changelog-relocation-'+override,()=>withFixture('alpha6-changelog-'+override,{'Cargo.toml':'[workspace]\nmembers=["crates/*"]\nresolver="2"\n','crates/adapter/Cargo.toml':pkg('fixture-adapter'),'crates/adapter/src/lib.rs':'pub fn value()->u32{42}\n'},{},async f=>{
    await success(f,'alpha6-changelog-'+override+'-initial');
    await mkdir(join(f.cwd,'apps'));await ok('git',['mv','crates/adapter','apps/adapter'],f.cwd);
    await writeFile(join(f.cwd,'Cargo.toml'),'[workspace]\nmembers=["apps/*"]\nresolver="2"\n');
    const source='# Changelog\n\nCommitted source history override.\n';
    if(override)await writeFile(join(f.cwd,'apps/adapter/CHANGELOG.md'),source);
    await ok('cargo',['generate-lockfile'],f.cwd,f.env);await commit(f,'fix: relocate public adapter');
    const clone=join(f.d,'relocation-fresh');await ok('git',['clone','--no-local','file://'+f.remote,clone],root);f.cwd=clone;
    const before=await snapshot(f);await success(f,'alpha6-changelog-'+override+'-moved');
    const archive=await archivedPackage(f,'fixture-adapter','1.1.1','alpha6-changelog-'+override);
    const text=await ok('tar',['-xOf',archive.path,'fixture-adapter-1.1.1/CHANGELOG.md'],root);
    assert.match(text,/relocate public adapter/);assert.equal(text.split('cargo:fixture-adapter@1.1.1').length-1,1);
    if(override){assert.match(text,/Committed source history override/);assert.ok(!text.includes('cargo:fixture-adapter@1.1.0'));assert.equal(await readFile(join(f.cwd,'apps/adapter/CHANGELOG.md'),'utf8'),source);}
    else{assert.equal(text.split('cargo:fixture-adapter@1.1.0').length-1,1);assert.match(text,/establish real Cargo graph/);}
    await unchanged(f,before);await downstream(f,'1.1.1');
    return {override,uploads:f.server.state().uploads,changelog:text,sourceRestored:true};
  }));

  const promotionConfig=async f=>{
    await writeFile(join(f.cwd,'fault-plugin.cjs'),`exports.generateNotes=(_,context)=>{if(process.env.CARGO_FAIL_NOTES==='1')throw new Error('ALPHA6_CONTROLLED_GENERATE_NOTES_FAILURE');};exports.addChannel=(_,context)=>{console.log('ALPHA6_PUBLIC_CHANNEL_NOTES:'+context.nextRelease?.notes);};\n`);
    await writeFile(join(f.cwd,'release.config.mjs'),`export default {repositoryUrl:${JSON.stringify(f.remote)},branches:process.env.CARGO_FUTURE==='1'?[{name:'1.x',channel:'future'},'main','next']:['main','next'],tagFormat:'workspace-v\u0024{version}',plugins:[['semantic-release-workspace',{publish:process.env.CARGO_PLAN_ONLY!=='1',changelog:true,cargo:{registry:'fixture',trustedPublishing:false},...(process.env.CARGO_FUTURE==='1'?{releaseRules:[{release:'patch'}]}:{})}],'./fault-plugin.cjs']};\n`);
    await commit(f,'chore: configure controlled promotion faults');
  };
  const branch=async(f,name)=>{await ok('git',['checkout','-b',name],f.cwd);await ok('git',['push','-u','origin',name],f.cwd);};
  const edit=async(f,name,msg,label)=>{await writeFile(join(f.cwd,`crates/${name}/src/lib.rs`),`pub fn value()->u32{42}\n// ${label}\n`);await commit(f,msg);};
  const merge=async f=>{await ok('git',['checkout','main'],f.cwd);await ok('git',['merge','--no-edit','next'],f.cwd);await ok('git',['push','origin','main'],f.cwd);};
  const noteRef='refs/notes/workspace-release-channels/'+createHash('sha256').update('main').digest('hex');
  const promotionNote=async f=>{
    const listing=(await ok('git',['--git-dir',f.remote,'notes','--ref='+noteRef,'list'],root)).trim().split('\n').filter(Boolean);
    assert.equal(listing.length,1);
    return JSON.parse(await ok('git',['--git-dir',f.remote,'notes','--ref='+noteRef,'show',listing[0].split(' ')[1]],root));
  };
  // Planning-only tags are not proof of public bytes. Reject before upstream
  // core writes its addChannel note, for both dry-run and real promotion.
  await scenario('alpha6-planning-only-promotion-rejects',()=>withFixture('alpha6-plan-promotion',{'Cargo.toml':'[workspace]\nmembers=["crates/*"]\nresolver="2"\n','crates/adapter/Cargo.toml':pkg('fixture-adapter'),'crates/adapter/src/lib.rs':'pub fn value()->u32{42}\n'},{},async f=>{
    await promotionConfig(f);const planEnv={CARGO_PLAN_ONLY:'1'};
    await success(f,'alpha6-plan-stable',[],planEnv);await branch(f,'next');
    await edit(f,'adapter','feat: new next API\n\nBREAKING CHANGE: new adapter API','next-major');
    await success(f,'alpha6-plan-next',[],planEnv);await merge(f);
    const before=await snapshot(f),requests=f.server.state().requests.length;
    for(const dry of [true,false]){const r=await release(f,'alpha6-plan-reject-'+dry,dry?['--dry-run']:[]);assert.notEqual(r.code,0,r.out);assert.match(r.out,/EWORKSPACEJOURNAL/);assert.deepEqual(await snapshot(f),before);assert.equal(f.server.state().requests.length,requests);}
    await success(f,'alpha6-plan-only-allowed',[],planEnv);
    assert.equal(f.server.state().uploads.length,0);
    return {dryAndRealRejectedBeforeChannelNote:true,refsUnchanged:true,uploads:0};
  }));

  // Freeze the selected newer stable ancestor, then publish a still newer
  // ancestor release before retry. Cargo has no dist-tag mutation; the public
  // observable contract is selected notes, retained artifacts and zero uploads.
  await scenario('alpha6-promotion-frozen-newer-ancestor-generateNotes',()=>{
    const files=graph();files['crates/adapter/Cargo.toml']=pkg('fixture-adapter');files['crates/adapter/src/lib.rs']='pub fn value()->u32{42}\n';
    return withFixture('alpha6-frozen-promotion',files,{},async f=>{
      await promotionConfig(f);await success(f,'alpha6-frozen-initial');await branch(f,'next');
      await edit(f,'adapter','feat: new adapter API\n\nBREAKING CHANGE: next adapter API','next-major');await success(f,'alpha6-frozen-next');
      await ok('git',['checkout','main'],f.cwd);await edit(f,'core','feat: improve stable core','main-minor');await success(f,'alpha6-frozen-newer-stable');
      await edit(f,'core','chore: prepare future core behavior','future-base');const futureBase=(await ok('git',['rev-parse','HEAD'],f.cwd)).trim();
      await merge(f);const before=await snapshot(f),uploads=[...f.server.state().uploads],req=f.server.state().requests.length;
      const dry=await success(f,'alpha6-frozen-dry',['--dry-run']);
      // Upstream's addChannel dry-run does not print returned notes. Observe
      // them at the public plugin boundary through a separate CLI hook below.
      assert.deepEqual(await snapshot(f),before);assert.deepEqual(f.server.state().uploads,uploads);assert.ok(f.server.state().requests.slice(req).every(x=>x.method==='GET'&&!/oidc|trusted_publishing/.test(x.path)));
      const failure=await release(f,'alpha6-frozen-notes-failure',[],{CARGO_FAIL_NOTES:'1'});assert.notEqual(failure.code,0,failure.out);assert.match(failure.out,/ALPHA6_CONTROLLED_GENERATE_NOTES_FAILURE/);
      const pending=await promotionNote(f);assert.equal(pending.status,'pending');
      assert.deepEqual(pending.versions.map(x=>({id:x.id,version:x.version})),[{id:'cargo:fixture-adapter',version:'2.0.0'},{id:'cargo:fixture-core',version:'1.2.0'}]);
      await ok('git',['checkout',futureBase],f.cwd);await branch(f,'1.x');await success(f,'alpha6-frozen-future',[],{CARGO_FUTURE:'1'});
      assert.ok(f.server.state().uploads.includes('cargo:fixture-core@1.2.1'));
      const finalUploads=[...f.server.state().uploads],packs=(await readFile(f.cargoLog,'utf8')).split('\n').filter(x=>x.startsWith('package '));
      const cwd=join(f.d,'promotion-network-fresh');await ok('git',['clone','--no-local','--branch','main','file://'+f.remote,cwd],root);f.cwd=cwd;
      assert.equal(await ok('git',['for-each-ref','--format=%(refname)','refs/semantic-release-workspace','refs/notes'],cwd),'');
      const retry=await success(f,'alpha6-frozen-fresh-retry');assert.match(retry.out,/cargo:fixture-core@1\.2\.0/);assert.ok(!retry.out.includes('## cargo:fixture-core@1.2.1'));
      assert.deepEqual(f.server.state().uploads,finalUploads);assert.deepEqual((await readFile(f.cargoLog,'utf8')).split('\n').filter(x=>x.startsWith('package ')),packs);
      const complete=await promotionNote(f);assert.equal(complete.status,'complete');assert.deepEqual(complete.versions,pending.versions);assert.equal(await ok('git',['status','--porcelain'],cwd),'');
      await writeFile(join(evidence,'alpha6-frozen-selection.json'),JSON.stringify({pending,complete,finalUploads,futureBase},null,2));
      return {selectedVersions:pending.versions,uploads:finalUploads,retryUploads:0,retryPackageCalls:0,freshNetworkClone:true};
    });
  });
}
