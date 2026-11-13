import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
export const boundaryCode = 'ESHAREDFRESHRETRY';
export function injectRetryBoundary(intent, attempt) {
  return intent.mode === 'publish' && intent.phase === 'shared-retry' && attempt === '1';
}
export function allMembersPublished(journal, intent, head) {
  if (!journal || journal.head !== head || journal.planning?.plan?.version !== intent.version || !intent.expected?.length) return false;
  return intent.expected.every(p => journal.execution?.packages?.some(record => record.id.endsWith(':' + p.name) && record.published && record.intent && record.artifact));
}
export function assertExpectedBoundary({intent, attempt, output, journal, head}) {
  assert.ok(injectRetryBoundary(intent, attempt));
  assert.ok(output.includes(boundaryCode));
  assert.equal(journal?.status, 'pending');
  assert.equal(journal.batchTag, 'workspace-v' + intent.version);
  assert.ok(allMembersPublished(journal, intent, head), 'Expected failure requires every frozen artifact already published');
}
// This fixed plugin follows the workspace publisher; success never runs on attempt 1.
export function publish() {
  const intent = JSON.parse(readFileSync('shared-live-intent.json'));
  if (injectRetryBoundary(intent, process.env.GITHUB_RUN_ATTEMPT)) {
    const error = new Error(boundaryCode + ': deliberate boundary after workspace uploads; rerun this same workflow after read-only registry confirmation');
    error.code = boundaryCode;
    throw error;
  }
}
