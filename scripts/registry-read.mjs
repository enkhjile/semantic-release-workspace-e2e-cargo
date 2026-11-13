import {setTimeout as delay} from 'node:timers/promises';
export async function registryJson(url,{ready=()=>true,candidate,attempts=20,intervalMs=3000,timeoutMs,onAttempt=()=>{}}={}){
  const isReady=candidate?value=>{const entry=value.versions?.[candidate.version];if(!entry)return false;candidate.validate?.(entry,value);return true;}:ready;
  const deadline=timeoutMs===undefined?undefined:Date.now()+timeoutMs;
  let last;
  for(let attempt=1;deadline===undefined?attempt<=attempts:attempt===1||Date.now()<=deadline;attempt++){
    const fresh=new URL(url);fresh.searchParams.set('srw_acceptance',Date.now()+'-'+attempt);const response=await fetch(fresh,{headers:{accept:'application/json','cache-control':'no-cache'},signal:AbortSignal.timeout(10000)});
    const record={url,attempt,status:response.status,age:response.headers.get('age')};
    onAttempt(record);last=record;
    if(response.ok){const value=await response.json();if(isReady(value))return value;}
    else {await response.body?.cancel();if(![404,429,502,503,504].includes(response.status))throw new Error(`Registry read failed: HTTP${response.status} ${url}`);}
    if(deadline===undefined?attempt<attempts:Date.now()<deadline)await delay(deadline===undefined?intervalMs:Math.min(intervalMs,deadline-Date.now()));
  }
  throw new Error(`Registry read did not become ready after ${timeoutMs===undefined?`${attempts} attempts`:`${timeoutMs}ms`}: HTTP${last?.status} ${url}`);
}
