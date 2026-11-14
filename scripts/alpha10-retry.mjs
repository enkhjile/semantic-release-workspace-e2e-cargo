import {readFileSync} from 'node:fs';
export function publish(){const intent=JSON.parse(readFileSync('alpha10-intent.json'));if(intent.retry && process.env.GITHUB_RUN_ATTEMPT==='1'){const error=new Error('EALPHA10FRESHRETRY deliberate postpublish failure');error.code='EALPHA10FRESHRETRY';throw error;}}
