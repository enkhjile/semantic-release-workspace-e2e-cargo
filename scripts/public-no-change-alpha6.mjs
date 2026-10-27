import assert from 'node:assert/strict';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {join, resolve} from 'node:path';
const root=resolve(import.meta.dirname,'..'),out=join(root,'evidence/alpha6/public-no-change');
const scratch=join(root,'.scratch/alpha6-public');await mkdir(out,{recursive:true});await mkdir(scratch,{recursive:true});
const env={...process.env,CI:'true',GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_NOSYSTEM:'1',RUSTUP_TOOLCHAIN:'1.99.1',GIT_AUTHOR_NAME:'Cargo acceptance',GIT_AUTHOR_EMAIL:'cargo@example.invalid',GIT_COMMITTER_NAME:'Cargo acceptance',GIT_COMMITTER_EMAIL:'cargo@example.invalid'};
for(const key of Object.keys(env))if(/TOKEN|SECRET|PASSWORD|GITHUB|GITLAB|ACTIONS_ID|SIGSTORE|^CARGO_|^GIT_CONFIG_(?:COUNT|KEY_|VALUE_|PARAMETERS)/.test(key))delete env[key];
Object.assign(env,{GIT_CONFIG_COUNT:'2',GIT_CONFIG_KEY_0:'credential.helper',GIT_CONFIG_VALUE_0:'',GIT_CONFIG_KEY_1:'credential.helper',GIT_CONFIG_VALUE_1:'!gh auth git-credential'});
const run=(cmd,args,cwd=scratch)=>{const r=spawnSync(cmd,args,{cwd,env,encoding:'utf8'});assert.equal(r.status,0,r.stdout+r.stderr);return r.stdout;};
const sha=b=>createHash('sha256').update(b).digest('hex');
const inventory=async()=>{
  const result=[];
  for(const name of ['enkhjile-srw-e2e-core','enkhjile-srw-e2e-adapter']){
    const response=await fetch('https://crates.io/api/v1/crates/'+name,{headers:{'user-agent':'semantic-release-workspace-alpha6-read-only-acceptance'}});assert.equal(response.status,200);
    const body=await response.json();result.push({name,versions:body.versions.map(v=>({version:v.num,checksum:v.checksum,trustpub:v.trustpub_data??null})).sort((a,b)=>a.version.localeCompare(b.version))});
  }
  return result;
};
const cwd=join(scratch,'fresh-'+Date.now());run('git',['clone','--branch','alpha4-live','https://github.com/enkhjile/semantic-release-workspace-e2e-cargo.git',cwd]);
const source=run('git',['rev-parse','HEAD'],cwd).trim();const acceptedSource='0411b830cd2376aa2d7e410db441b7f2772131b7';run('git',['merge-base','--is-ancestor',acceptedSource,source],cwd);assert.equal(run('git',['diff',acceptedSource,'HEAD','--','Cargo.toml','Cargo.lock','crates','release.config.mjs','release.oidc.config.mjs'],cwd),'','public Cargo source and live config must exactly match accepted source');
const beforeCustom=run('git',['for-each-ref','--format=%(refname)','refs/notes','refs/semantic-release-workspace'],cwd);assert.equal(beforeCustom,'');
const files=async()=>Object.fromEntries(await Promise.all(run('git',['ls-files'],cwd).trim().split('\n').map(async p=>[p,sha(await readFile(join(cwd,p)))])));
const beforeFiles=await files(),beforeRefs=run('git',['ls-remote','origin'],cwd),beforeInventory=await inventory();
const lock=JSON.parse(await readFile(join(root,'package-lock.json'),'utf8')).packages['node_modules/semantic-release-workspace'];assert.equal(lock.version,'1.0.0-alpha.6');
const transport=join(scratch,'read-only-fetch.mjs'),calls=join(out,'plugin-http.jsonl');await writeFile(calls,'');
await writeFile(transport,`import {appendFileSync} from 'node:fs';\nconst native=globalThis.fetch;globalThis.fetch=(input,init={})=>{const method=String(init.method??input?.method??'GET').toUpperCase(),url=String(input?.url??input);appendFileSync(${JSON.stringify(calls)},JSON.stringify({method,url})+'\\n');if(!['GET','HEAD'].includes(method)||/oidc|trusted_publishing/.test(url))throw new Error('ALPHA6_READ_ONLY_OBSERVER_BLOCKED_NETWORK_MUTATION');return native(input,init);};\n`);
env.NODE_OPTIONS='--import='+transport;
const cli=join(root,'node_modules/semantic-release/bin/semantic-release.js');
const r=spawnSync(process.execPath,[cli,'--no-ci'],{cwd,env,encoding:'utf8'});await writeFile(join(out,'semantic-release.log'),r.stdout+r.stderr);assert.equal(r.status,0,r.stdout+r.stderr);
assert.equal(await readFile(calls,'utf8'),'','complete no-change must make zero plugin HTTP calls');
assert.equal(run('git',['ls-remote','origin'],cwd),beforeRefs);assert.deepEqual(await files(),beforeFiles);assert.equal(run('git',['status','--porcelain'],cwd),'');
const afterInventory=await inventory();assert.deepEqual(afterInventory,beforeInventory);
const retained=[];
for(const [name,version,expected]of [['enkhjile-srw-e2e-core','0.2.0-alpha.1','df6606e5d05d921b61973da900fe12f2885704d908f7da112273edd784333b71'],['enkhjile-srw-e2e-adapter','0.2.0-alpha4.1','1311771d8baa701893743065dd8831e9a3678383f1782e019c3348b1729217ec']]){
 const response=await fetch(`https://static.crates.io/crates/${name}/${name}-${version}.crate`);assert.equal(response.status,200);const bytes=Buffer.from(await response.arrayBuffer());assert.equal(sha(bytes),expected);await writeFile(join(out,`${name}-${version}.crate`),bytes);retained.push({name,version,sha256:expected,bytes:bytes.length});
}
delete env.NODE_OPTIONS;env.CARGO_HOME=join(scratch,'ordinary-cargo-home');await mkdir(env.CARGO_HOME);
const downstream=join(scratch,'downstream');await mkdir(join(downstream,'src'),{recursive:true});
await writeFile(join(downstream,'Cargo.toml'),'[package]\nname="alpha6-public-observer"\nversion="0.1.0"\nedition="2021"\n[workspace]\n[dependencies]\nenkhjile-srw-e2e-adapter="=0.2.0-alpha4.1"\n');
await writeFile(join(downstream,'src/main.rs'),'fn main(){assert_eq!(enkhjile_srw_e2e_adapter::value(),42);println!("42");}\n');
const native=spawnSync('cargo',['run','--quiet'],{cwd:downstream,env,encoding:'utf8'});await writeFile(join(out,'native-downstream.log'),native.stdout+native.stderr);assert.equal(native.status,0,native.stdout+native.stderr);assert.equal(native.stdout.trim(),'42');
await writeFile(join(out,'native-downstream-Cargo.lock'),await readFile(join(downstream,'Cargo.lock')));
await writeFile(join(out,'refs-before.txt'),beforeRefs);await writeFile(join(out,'refs-after.txt'),run('git',['ls-remote','origin'],cwd));
await writeFile(join(out,'inventory-before.json'),JSON.stringify(beforeInventory,null,2));await writeFile(join(out,'inventory-after.json'),JSON.stringify(afterInventory,null,2));
const proof={status:'PASS',sourceSha:source,acceptedSourceSha:acceptedSource,acceptedCargoSourceAndConfigUnchanged:true,toolingLock:lock,ordinaryFreshClone:true,customRefsBeforeCli:beforeCustom,customRefsAfterCli:run('git',['for-each-ref','--format=%(objectname) %(refname)','refs/notes','refs/semantic-release-workspace'],cwd),sourceFilesUnchanged:true,allRemoteRefsUnchanged:true,registryInventoryUnchanged:true,pluginHttpCalls:0,newUploads:0,newIdentity:0,publicArchives:retained,nativeDownstreamExit:native.status,nativeValue:42,publicationCredentialEnvironmentNames:Object.keys(env).filter(k=>/TOKEN|SECRET|PASSWORD|ACTIONS_ID|SIGSTORE/.test(k)),boundary:'Existing accepted public alpha4 history observed with installed public alpha6. No new public publication or OIDC provenance.'};
await writeFile(join(out,'verification.json'),JSON.stringify(proof,null,2));console.log(JSON.stringify({status:proof.status,sourceSha:source,newUploads:0,pluginHttpCalls:0,nativeValue:42}));
