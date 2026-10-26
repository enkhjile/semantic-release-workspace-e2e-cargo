import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {join,resolve} from 'node:path';
const root=resolve(import.meta.dirname,'..'),out=join(root,'evidence/alpha4/live');
await mkdir(out,{recursive:true});
const sha=spawnSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).stdout.trim();
if(process.env.GITHUB_SHA)assert.equal(sha,process.env.GITHUB_SHA,'real workflow SHA must equal source HEAD');
for(const name of ['CARGO_REGISTRY_TOKEN','CARGO_REGISTRIES_CRATES_IO_TOKEN'])assert.ok(!process.env[name],name+' must be absent');
const names=['enkhjile-srw-e2e-core','enkhjile-srw-e2e-adapter'];
const inventory=[];for(const name of names){const response=await fetch(`https://crates.io/api/v1/crates/${name}`,{headers:{'user-agent':'semantic-release-workspace acceptance'}});assert.equal(response.status,200);const data=await response.json();inventory.push({name,versions:data.versions.map(x=>x.num)});}
assert.deepEqual(inventory[0].versions.sort(),['0.1.0','0.2.0-alpha.1']);
assert.deepEqual(inventory[1].versions,['0.1.0']);
const native=spawnSync('cargo',['metadata','--locked','--format-version','1','--no-deps'],{cwd:root,encoding:'utf8'});assert.equal(native.status,0,native.stderr);const workspace=JSON.parse(native.stdout);assert.deepEqual(workspace.packages.map(x=>x.name),[names[1]]);const dependency=workspace.packages[0].dependencies.find(x=>x.name===names[0]);assert.equal(dependency.req,'=0.2.0-alpha.1');assert.equal(dependency.path,undefined);assert.equal(dependency.registry,null);
const command=spawnSync(process.execPath,[join(root,'node_modules/semantic-release/bin/semantic-release.js'),'--dry-run','--extends','./release.oidc.config.mjs'],{cwd:root,env:process.env,encoding:'utf8'});await writeFile(join(out,'dryrun.log'),command.stdout+command.stderr);assert.equal(command.status,0,command.stdout+command.stderr);const match=(command.stdout+command.stderr).match(/```json\s*(\{[\s\S]*?\})\s*```/);assert.ok(match,'dry-run must expose the frozen package plan');const plan=JSON.parse(match[1]);assert.equal(plan.head,sha);assert.equal(plan.release.branch,'alpha4-live');assert.equal(plan.release.prerelease,'alpha4');assert.equal(plan.packages.length,1);assert.equal(plan.packages[0].id,'cargo:'+names[1]);assert.equal(plan.packages[0].nextVersion,'0.2.0-alpha4.1');assert.equal(plan.packages[0].private,false);
await writeFile(join(out,'prepublish-guard.json'),JSON.stringify({status:'PASS',source:sha,realWorkflowSha:process.env.GITHUB_SHA??null,plan,inventory,maximumAcceptedVersions:4,acceptedBefore:3,maximumNewUploads:1,expectedCandidate:names[1]+'@0.2.0-alpha4.1'},null,2));console.log(JSON.stringify({status:'PASS',source:sha,candidate:names[1]+'@0.2.0-alpha4.1',acceptedBefore:3,maximumNewUploads:1}));
