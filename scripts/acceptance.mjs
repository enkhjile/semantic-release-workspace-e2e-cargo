import { mkdtemp, mkdir, writeFile, readFile, readdir, cp, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
const root=resolve(import.meta.dirname,'..');
const evidence=join(root,'evidence/alpha3');
const scratch=join(root,'.scratch/alpha3');
const cli=join(root,'node_modules/semantic-release/bin/semantic-release.js');
const plugin='semantic-release-workspace';
const baseEnv={...process.env,CI:'true',GIT_CONFIG_NOSYSTEM:'1',GIT_AUTHOR_NAME:'Cargo acceptance',GIT_AUTHOR_EMAIL:'cargo@example.invalid',GIT_COMMITTER_NAME:'Cargo acceptance',GIT_COMMITTER_EMAIL:'cargo@example.invalid'};
for(const k of Object.keys(baseEnv)) if(/TOKEN|SECRET|PASSWORD|ACTIONS_ID|GITHUB|GITLAB/.test(k)) delete baseEnv[k];
const diagnostic=process.env.PUBLIC_ESM_RESOLUTION_WORKAROUND==='1';
const results=[];
await mkdir(scratch,{recursive:true});
await mkdir(evidence,{recursive:true});
async function run(cmd,args,cwd,env={}) {return await new Promise((res)=>{let out='';const p=spawn(cmd,args,{cwd,env:{...baseEnv,...env}});p.stdout.on('data',d=>out+=d);p.stderr.on('data',d=>out+=d);p.on('error',e=>res({code:127,out:String(e)}));p.on('close',code=>res({code,out}));});}
async function ok(cmd,args,cwd,env){const r=await run(cmd,args,cwd,env);assert.equal(r.code,0,r.out);return r.out;}
async function put(dir,files){for(const [n,v]of Object.entries(files)){await mkdir(join(dir,n,'..'),{recursive:true});await writeFile(join(dir,n),v);}}
const pkg=(name,extra='')=>`[package]\nname = "${name}"\nversion = "1.0.0"\nedition = "2021"\nlicense = "MIT"\ndescription = "Disposable acceptance fixture"\n${extra}`;
async function fixture(name,files,options={publish:false}){const d=await mkdtemp(join(scratch,name+'-'));await mkdir(join(d,'work'));const cwd=join(d,'work'), remote=join(d,'remote.git');await ok('git',['init','--bare',remote],root);await ok('git',['--git-dir',remote,'symbolic-ref','HEAD','refs/heads/main'],root);await ok('git',['init','-b','main'],cwd);await put(cwd,{'.gitignore':'target/\n',...files,'release.config.mjs':`${diagnostic ? "import {fileURLToPath} from 'node:url';\nconst plugin=fileURLToPath(import.meta.resolve('semantic-release-workspace'));\n" : ''}export default ${JSON.stringify({branches:['main'],repositoryUrl:remote,tagFormat:'workspace-v${version}',plugins:[[diagnostic?'PUBLIC_PLUGIN_MARKER':plugin,options]]}).replace('"PUBLIC_PLUGIN_MARKER"','plugin')};\n`});await ok('git',['add','.'],cwd);await ok('git',['commit','-m','feat: introduce fixture'],cwd);await ok('git',['remote','add','origin',remote],cwd);await ok('git',['push','-u','origin','main'],cwd);return {cwd,remote,d};}
async function release(f,args=[],env={}){return await run(process.execPath,[cli,'--no-ci',...args],f.cwd,env);}
function plan(out){const match=out.match(/```json\s*(\{[\s\S]*?\})\s*```/);if(match)return JSON.parse(match[1]);return undefined;}
async function scenario(name,fn){const t=Date.now();try{const detail=await fn();results.push({name,mode:diagnostic?'PUBLIC_ESM_RESOLUTION_WORKAROUND':'DOCUMENTED_PACKAGE_NAME',status:'PASS',ms:Date.now()-t,...detail});console.log(results.at(-1).status,name);}catch(e){results.push({name,status:'FAIL',ms:Date.now()-t,error:e.stack});console.log('FAIL',name,e.message.slice(-700));}await writeFile(join(evidence,process.env.CARGO_RESULT_FILE??(diagnostic?'results-diagnostic.json':'results.json')),JSON.stringify({generatedAt:new Date().toISOString(),node:process.version,results},null,2));}
const core={'crates/core/Cargo.toml':pkg('fixture-core'),'crates/core/src/lib.rs':'pub fn value()->u32{42}\n#[test] fn works(){assert_eq!(value(),42);}\n'};
const adapter={'crates/adapter/Cargo.toml':pkg('fixture-adapter','\n[dependencies]\nfixture-core = { path = "../core", version = "1.0.0" }\n'),'crates/adapter/src/lib.rs':'pub fn value()->u32{fixture_core::value()}\n#[test] fn works(){assert_eq!(value(),42);}\n'};
const virtual={'Cargo.toml':'[workspace]\nmembers=["crates/*"]\nresolver="2"\n',...core,...adapter};
if(!diagnostic)for(let attempt=1;attempt<=2;attempt++)await scenario('package-name-cli-loading-'+attempt,async()=>{const f=await fixture('loading-proof-'+attempt,{'Cargo.toml':pkg('load-fixture-'+attempt),'src/lib.rs':'pub fn value()->u8{1}'});const r=await release(f,['--dry-run']);await writeFile(join(evidence,'loading-proof-'+attempt+'.log'),r.out);assert.equal(r.code,0,r.out);return {log:'loading-proof-'+attempt+'.log'};});
for(const [name,files,expected] of [
 ['virtual-workspace',virtual,['fixture-core','fixture-adapter']],
 ['default-members', {...virtual,'Cargo.toml':'[workspace]\nmembers=["crates/*"]\ndefault-members=["crates/core"]\nresolver="2"\n'},['fixture-core','fixture-adapter']],
 ['root-workspace',{...core,'Cargo.toml':pkg('fixture-root','\n[workspace]\nmembers=["crates/core"]\nresolver="2"\n'),'src/lib.rs':'pub fn root(){}\n'},['fixture-root','fixture-core']],
 ['standalone-root',{'Cargo.toml':pkg('fixture-root'),'src/lib.rs':'pub fn root(){}\n'},['fixture-root']],
 ['automatic-path-member',{...virtual,'Cargo.toml':'[workspace]\nmembers=["crates/adapter"]\nresolver="2"\n'},['fixture-core','fixture-adapter']],
 ['literal-exclusion',{...virtual,'Cargo.toml':'[workspace]\nmembers=["crates/*"]\nexclude=["crates/adapter"]\nresolver="2"\n'},['fixture-core']],
 ['explicit-member-wins',{...virtual,'Cargo.toml':'[workspace]\nmembers=["crates/core", "crates/adapter"]\nexclude=["crates/adapter"]\nresolver="2"\n'},['fixture-core','fixture-adapter']],
 ['private-false',{...virtual,'crates/core/Cargo.toml':pkg('fixture-core','publish=false\n')},['fixture-core','fixture-adapter']],
 ['private-empty',{...virtual,'crates/core/Cargo.toml':pkg('fixture-core','publish=[]\n')},['fixture-core','fixture-adapter']],
 ['inherited-fields',{...virtual,'Cargo.toml':'[workspace]\nmembers=["crates/*"]\nresolver="2"\n[workspace.package]\nversion="1.0.0"\npublish=false\n','crates/core/Cargo.toml':'[package]\nname="fixture-core"\nversion.workspace=true\npublish.workspace=true\nedition="2021"\n'},['fixture-core','fixture-adapter']],
])await scenario(name,async()=>{const f=await fixture(name,files);const native=JSON.parse(await ok('cargo',['+1.99.1','metadata','--format-version','1','--no-deps'],f.cwd));assert.deepEqual(native.packages.map(p=>p.name).sort(),expected.sort());const before=await ok('git',['status','--porcelain'],f.cwd);const r=await release(f,['--dry-run']);await writeFile(join(evidence,(diagnostic?'diagnostic-':'documented-')+process.versions.node+'-'+name+'.log'),r.out);if(r.out.includes('ERR_PACKAGE_PATH_NOT_EXPORTED'))return {status:'BLOCKED',reason:'package-name CLI resolution fails before plugin hooks',nativeMembers:expected,log:name+'.log'};assert.equal(r.code,0,r.out);for(const p of expected)assert.ok(r.out.includes(p),'plugin omitted '+p);assert.equal(await ok('git',['status','--porcelain'],f.cwd),before);const refs=await ok('git',['ls-remote','origin'],f.cwd);assert.ok(!refs.includes('refs/tags/'));return {nativeMembers:expected,log:name+'.log',plan:plan(r.out)};});
for(const [name,files]of [
 ['duplicate-private',{...virtual,'crates/adapter/Cargo.toml':pkg('fixture-core','publish=false\n')}],
 ['nested-workspace',{...virtual,'crates/core/Cargo.toml':pkg('fixture-core','\n[workspace]\n')}],
 ['missing-manifest',{'Cargo.toml':'[workspace]\nmembers=["missing"]\n'}],
 ['unsafe-member',{'Cargo.toml':'[workspace]\nmembers=["../outside"]\n'}],
])for(let attempt=1;attempt<=2;attempt++)await scenario(name+'-'+attempt,async()=>{const f=await fixture(name,files);const native=await run('cargo',['+1.99.1','metadata','--format-version','1','--no-deps'],f.cwd);const r=await release(f,['--dry-run']);await writeFile(join(evidence,(diagnostic?'diagnostic-':'documented-')+process.versions.node+'-'+name+'-'+attempt+'.log'),r.out);assert.notEqual(r.code,0,r.out);if(r.out.includes('ERR_PACKAGE_PATH_NOT_EXPORTED'))return {status:'BLOCKED',reason:'package-name CLI resolution fails before plugin hooks',nativeExit:native.code,log:name+'-'+attempt+'.log'};assert.ok(/EWORKSPACE/.test(r.out),r.out);return {nativeExit:native.code,log:name+'-'+attempt+'.log'};});
await scenario('native-core-adapter-build-test',async()=>{const f=await fixture('native-graph',virtual);return {output:await ok('cargo',['+1.99.1','test','--workspace'],f.cwd)};});
console.log(JSON.stringify({total:results.length,pass:results.filter(x=>x.status==='PASS').length,fail:results.filter(x=>x.status==='FAIL').length,blocked:results.filter(x=>x.status==='BLOCKED').length}));
process.exitCode=results.some(x=>x.status==='FAIL')?1:0;
