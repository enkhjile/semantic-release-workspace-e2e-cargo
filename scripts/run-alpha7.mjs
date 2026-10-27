import {spawnSync} from 'node:child_process';
import {mkdirSync,rmSync,existsSync,writeFileSync,statSync,readdirSync} from 'node:fs';
import {resolve,join} from 'node:path';
const root=resolve(import.meta.dirname,'..');
const evidence=join(root,process.env.CARGO_EVIDENCE_DIR??'evidence/alpha7/hosted');
const scratch=join(root,process.env.CARGO_SCRATCH_DIR??'.scratch/alpha7-hosted');
const temporary=join(root,'.scratch/alpha7-temp');
const cleanupPaths=[scratch,temporary,join(root,'.scratch/alpha7-install-cache')];
const bytes=p=>{if(!existsSync(p))return 0;const st=statSync(p);return st.isDirectory()?readdirSync(p).reduce((n,f)=>n+bytes(join(p,f)),0):st.size;};
const sizes=()=>Object.fromEntries(cleanupPaths.map(p=>[p.slice(root.length+1),bytes(p)]));
mkdirSync(evidence,{recursive:true});mkdirSync(temporary,{recursive:true});
const env={...process.env,RUSTUP_TOOLCHAIN:'1.99.1',CARGO_EVIDENCE_DIR:evidence.slice(root.length+1),CARGO_SCRATCH_DIR:scratch.slice(root.length+1),TMPDIR:temporary};
const steps=[],before=sizes();let failed=false,exported=false;
const step=(name,cmd,args)=>{const result=spawnSync(cmd,args,{cwd:root,env,encoding:'utf8',maxBuffer:64*1024*1024});const log=(result.stdout??'')+(result.stderr??'');writeFileSync(join(evidence,name+'.log'),log);console.log(name+': '+(result.status??'spawn error'));console.log(log.slice(-1500));steps.push({name,cmd,args,exit:result.status,error:result.error?.message});if(result.status!==0)failed=true;return result.status===0;};
try{
 if(step('tools',process.execPath,['scripts/settings-tools.mjs'])){
  if(!process.argv.includes('--focused')){step('native','cargo',['test','--workspace','--locked','--target-dir',join(scratch,'native-target')]);step('discovery',process.execPath,['scripts/acceptance.mjs']);}
  step('lifecycle',process.execPath,['scripts/lifecycle.mjs']);
 }
}finally{
 exported=step('export','python3',['scripts/export-alpha6-evidence.py']);
 const beforeCleanup=sizes();
 // The exporter first verifies mirror restore, all refs, and reachable objects.
 // Preserve a failed export's scratch for diagnosis instead of deleting proof.
 if(exported)for(const path of cleanupPaths)rmSync(path,{recursive:true,force:true});
 const cleanup={generatedAt:new Date().toISOString(),before, beforeCleanup,after:sizes(),exportVerified:exported,removed:exported?cleanupPaths.map(p=>p.slice(root.length+1)):[],preserved:['node_modules','all preexisting scratch/evidence and historical refs'],steps};
 writeFileSync(join(evidence,'cleanup.json'),JSON.stringify(cleanup,null,2));
 writeFileSync(join(evidence,'run.json'),JSON.stringify({source:spawnSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).stdout.trim(),focused:process.argv.includes('--focused'),steps,cleanupPassed:exported&&Object.values(cleanup.after).every(n=>n===0)},null,2));
}
process.exitCode=failed?1:0;
