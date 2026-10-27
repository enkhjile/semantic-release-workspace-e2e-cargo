// Count methods/hosts only. Never inspect or retain headers, credentials, URLs, paths, or bodies.
import {channel} from 'node:diagnostics_channel';
import {appendFileSync} from 'node:fs';
const destination=process.env.SRW_HTTP_AUDIT;
function record(transport,method,host){if(destination)appendFileSync(destination,JSON.stringify({transport,method,host})+'\n');}
record('observer','READY','');
channel('undici:request:create').subscribe(({request})=>record('fetch',request.method,new URL(request.origin).hostname));
channel('http.client.request.start').subscribe(({request})=>record('http',request.method,request.host?.split(':')[0]??'unknown'));
