import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir, writeFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {join, resolve} from 'node:path';
const root=resolve(import.meta.dirname,'..'),out=join(root,'evidence/alpha3/live');
await mkdir(out,{recursive:true});
const version=process.env.CARGO_EXPECT_VERSION??'0.2.0-alpha.1';
const proof=[];
for(const name of ['enkhjile-srw-e2e-core','enkhjile-srw-e2e-adapter']){
 let metadata;
 for(let attempt=0;attempt<18;attempt++){
  const response=await fetch(`https://crates.io/api/v1/crates/${name}/${version}`,{headers:{'user-agent':'semantic-release-workspace consumer acceptance (github.com/enkhjile/semantic-release-workspace-e2e-cargo)'}});
  if(response.ok){metadata=await response.json();break;}
  assert.equal(response.status,404,`unexpected registry status ${response.status}`);
  await new Promise(resolve=>setTimeout(resolve,10000));
 }
 assert.ok(metadata,'accepted crate did not become publicly visible; do not republish');
 assert.equal(metadata.version.num,version);
 if(process.env.GITHUB_SHA){
  assert.equal(metadata.version.trustpub_data?.provider,'github');
  assert.equal(metadata.version.trustpub_data.repository,process.env.GITHUB_REPOSITORY);
  assert.equal(metadata.version.trustpub_data.sha,process.env.GITHUB_SHA);
  assert.equal(metadata.version.trustpub_data.run_id,process.env.GITHUB_RUN_ID);
 }
 const response=await fetch(`https://static.crates.io/crates/${name}/${name}-${version}.crate`);
 assert.equal(response.status,200);
 const bytes=Buffer.from(await response.arrayBuffer());
 const checksum=createHash('sha256').update(bytes).digest('hex');
 assert.equal(checksum,metadata.version.checksum);
 await writeFile(join(out,`${name}-${version}.crate`),bytes);
 await writeFile(join(out,`${name}-${version}.json`),JSON.stringify(metadata,null,2));
 proof.push({name,version,sha256:checksum,bytes:bytes.length,trustpub:metadata.version.trustpub_data});
}
const consumer=join(root,'.scratch/alpha3/live-consumer-'+Date.now());
await mkdir(join(consumer,'src'),{recursive:true});
await writeFile(join(consumer,'Cargo.toml'),`[package]\nname="live-downstream"\nversion="0.1.0"\nedition="2021"\n[workspace]\n[dependencies]\nenkhjile-srw-e2e-adapter="=${version}"\n`);
await writeFile(join(consumer,'src/main.rs'),'fn main(){assert_eq!(enkhjile_srw_e2e_adapter::value(),42);}\n');
const native=spawnSync('cargo',['+1.99.1','run','--quiet'],{cwd:consumer,encoding:'utf8'});
await writeFile(join(out,'native-downstream.log'),native.stdout+native.stderr);
assert.equal(native.status,0,native.stderr);
await writeFile(join(out,'verification.json'),JSON.stringify({generatedAt:new Date().toISOString(),nativeDownstreamExit:native.status,sourceSha:process.env.GITHUB_SHA,runId:process.env.GITHUB_RUN_ID,crates:proof},null,2));
console.log(JSON.stringify({version,verifiedCrates:proof.length,nativeDownstreamExit:0}));
