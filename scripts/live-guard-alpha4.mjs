import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {join,resolve} from 'node:path';
import {adapter,core,candidate,git,inventory,protectedState} from './live-policy-alpha4.mjs';
const root=resolve(import.meta.dirname,'..'),out=join(root,'evidence/alpha4/live');
await mkdir(out,{recursive:true});
const source=git(root,'rev-parse','HEAD');
if(process.env.GITHUB_SHA)assert.equal(source,process.env.GITHUB_SHA,'real workflow SHA must equal source HEAD');
for(const name of ['CARGO_REGISTRY_TOKEN','CARGO_REGISTRIES_CRATES_IO_TOKEN'])assert.ok(!process.env[name],name+' must be absent');
const state=await inventory(root,source),protection=protectedState(root);
await writeFile(join(out,'protected-before.json'),JSON.stringify(protection,null,2));
const native=spawnSync('cargo',['metadata','--locked','--format-version','1','--no-deps'],{cwd:root,encoding:'utf8'});
assert.equal(native.status,0,native.stderr);
const workspace=JSON.parse(native.stdout);assert.deepEqual(workspace.packages.map(x=>x.name),[adapter]);
const dependency=workspace.packages[0].dependencies.find(x=>x.name===core);
assert.equal(dependency.req,'=0.2.0-alpha.1');assert.equal(dependency.path,undefined);assert.equal(dependency.registry,null);
const command=spawnSync(process.execPath,[join(root,'node_modules/semantic-release/bin/semantic-release.js'),'--dry-run','--extends','./release.oidc.config.mjs'],{cwd:root,env:process.env,encoding:'utf8'});
const text=command.stdout+command.stderr;
await writeFile(join(out,'dryrun.log'),text);assert.equal(command.status,0,text);
assert.ok(text.includes('Run automated release from branch alpha4-live'),text);
const match=text.match(/```json\s*(\{[\s\S]*?\})\s*```/)??text.match(/\n {4}(\{[\s\S]*?\})\s*\n\s*<\/details>/);
let plan=null;
if(match){plan=JSON.parse(match[1]);assert.equal(plan.head,source);assert.equal(plan.release.branch,'alpha4-live');assert.equal(plan.release.prerelease,'alpha4');assert.equal(plan.packages.length,1);assert.equal(plan.packages[0].id,'cargo:'+adapter);assert.equal(plan.packages[0].nextVersion,candidate);assert.equal(plan.packages[0].private,false);}
else {assert.ok(state.accepted&&state.ownership,'only this retained accepted batch may be a no-change retry');assert.equal(state.ownership.journalStatus,'complete');assert.ok(text.includes('no new version is released'),text);}
const proof={status:'PASS',source,context:process.env.GITHUB_RUN_ID?'REAL_GITHUB_ACTIONS':'LOCAL_SYNTHETIC_IDENTITY_CONTEXT',realWorkflowSha:process.env.GITHUB_RUN_ID?process.env.GITHUB_SHA:null,plan,registry:state,maximumAcceptedVersions:4,acceptedBefore:state.acceptedVersionCount,maximumNewUploads:state.accepted?0:1,expectedCandidate:adapter+'@'+candidate,mode:state.accepted?'OWNED_ACCEPTED_RETRY':'NEW_ADAPTER_ONLY_INTENT'};
await writeFile(join(out,'prepublish-guard.json'),JSON.stringify(proof,null,2));
console.log(JSON.stringify({status:'PASS',source,candidate:proof.expectedCandidate,mode:proof.mode,acceptedBefore:proof.acceptedBefore,maximumNewUploads:proof.maximumNewUploads}));
