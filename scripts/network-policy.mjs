import assert from 'node:assert/strict';

const trustMirror = 'tuf-repo-cdn.sigstore.dev';
export function identityHost(host, env = process.env) {
  let configured;
  if (env.ACTIONS_ID_TOKEN_REQUEST_URL) configured = new URL(env.ACTIONS_ID_TOKEN_REQUEST_URL).hostname;
  return host === configured || host === 'token.actions.githubusercontent.com' || host.endsWith('.actions.githubusercontent.com');
}
export function networkSummary(calls, env = process.env) {
  return {
    calls,
    writes: calls.filter(c => !['GET', 'HEAD', 'OPTIONS', 'READY'].includes(c.method)).length,
    identities: calls.filter(c => identityHost(c.host, env)).length,
    trustMetadataReads: calls.filter(c => c.host === trustMirror && ['GET', 'HEAD'].includes(c.method)).length,
  };
}
export function assertReadOnlyNetwork(calls, env = process.env) {
  assert.ok(calls.some(c => c.transport === 'observer'), 'HTTP observer did not initialize');
  for (const call of calls.filter(c => c.transport !== 'observer')) {
    assert.ok(['GET', 'HEAD', 'OPTIONS'].includes(call.method), 'Read-only invocation attempted a write/exchange/signing request');
    assert.ok(!identityHost(call.host, env), 'Read-only invocation attempted to obtain a CI identity');
    if (/sigstore|fulcio|rekor/.test(call.host)) {
      assert.equal(call.host, trustMirror, 'Unexpected signing service contact during read-only verification');
      assert.ok(['GET', 'HEAD'].includes(call.method));
    }
  }
}
