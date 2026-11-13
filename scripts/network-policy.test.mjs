import assert from 'node:assert/strict';
import test from 'node:test';
import {assertReadOnlyNetwork, networkSummary} from './network-policy.mjs';
const ready = {transport: 'observer', method: 'READY', host: ''};
const call = (method, host) => [ready, {transport: 'fetch', method, host}];
test('retained provenance may read the installed Sigstore SDK default TUF mirror', () => {
  const records = call('GET', 'tuf-repo-cdn.sigstore.dev');
  assertReadOnlyNetwork(records, {});
  assert.deepEqual(networkSummary(records, {}), {calls: records, writes: 0, identities: 0, trustMetadataReads: 1});
});
for (const [method, host] of [['GET','pipelines.actions.githubusercontent.com'], ['GET','token.actions.githubusercontent.com'], ['POST','registry.npmjs.org'], ['POST','fulcio.sigstore.dev'], ['POST','rekor.sigstore.dev'], ['POST','tuf-repo-cdn.sigstore.dev'], ['GET','fulcio.sigstore.dev']]) {
  test(`read-only rejects ${method} ${host}`, () => assert.throws(() => assertReadOnlyNetwork(call(method, host), {})));
}
test('identity request remains forbidden even with a nonstandard configured host', () => assert.throws(() => assertReadOnlyNetwork(call('GET', 'identity.example.test'), {ACTIONS_ID_TOKEN_REQUEST_URL: 'https://identity.example.test/private/token?secret=never-logged'})));
test('ordinary registry reads preserve zero-identity proof', () => {
  const calls = call('GET', 'registry.npmjs.org');
  assertReadOnlyNetwork(calls, {});
  assert.equal(networkSummary(calls, {}).identities, 0);
});
