import {test} from 'node:test';
import assert from 'node:assert/strict';
import {assertPlan} from './preview-alpha6.mjs';
const intent={branch:'stable-alpha6-live',packages:[{name:'core',nextVersion:'1.1.0'},{name:'app',nextVersion:'1.1.0'}]};
const plan={release:{branch:intent.branch},packages:[...intent.packages,{name:'private',private:true,nextVersion:'9.0.0'}]};
test('preview accepts only the exact public package/version set and branch',()=>assert.doesNotThrow(()=>assertPlan(plan,intent)));
test('preview rejects an additional upload, changed version, missing member or wrong branch',()=>{
 for(const packages of [[...plan.packages,{name:'extra',nextVersion:'1.0.0'}],[{name:'core',nextVersion:'2.0.0'},intent.packages[1]],[intent.packages[0]]])assert.throws(()=>assertPlan({...plan,packages},intent));
 assert.throws(()=>assertPlan({...plan,release:{branch:'main'}},intent));
});
