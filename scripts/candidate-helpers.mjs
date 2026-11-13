import assert from 'node:assert/strict';
import {basename} from 'node:path';

export function candidatePackEntry(raw, expected) {
  const value = JSON.parse(raw);
  let entry;
  if (Array.isArray(value)) {
    assert.equal(value.length, 1, 'Exactly one candidate archive is required');
    entry = value[0];
  } else {
    assert.ok(value && typeof value === 'object');
    assert.deepEqual(Object.keys(value), [expected.name], 'npm keyed output must contain only the candidate package name');
    entry = value[expected.name];
  }
  assert.ok(entry && typeof entry === 'object');
  assert.equal(entry.name, expected.name);
  assert.equal(entry.version, expected.version);
  assert.equal(typeof entry.filename, 'string');
  assert.equal(entry.filename, basename(entry.filename));
  assert.ok(!entry.filename.includes('\\') && entry.filename.endsWith('.tgz'));
  assert.match(entry.integrity, /^sha512-[A-Za-z0-9+/]+=*$/);
  return entry;
}

export function assertFrozenRecovery(complete, before) {
  assert.deepEqual(complete.planning.plan, before.planning.plan, 'Retry changed the frozen plan');
  assert.deepEqual(complete.planning.releaseNotes, before.planning.releaseNotes, 'Retry changed frozen release notes');
  assert.equal(complete.execution.prepared, before.execution.prepared, 'Retry changed prepared source');
  for (const old of before.execution.packages.filter(p => p.artifact)) assert.deepEqual(complete.execution.packages.find(p => p.id === old.id)?.artifact, old.artifact, 'Retry changed retained artifact bytes');
  // Completion legitimately updates planning.versions and dependencyRanges.
}

export function assertRetainedPublication(record, journal, remoteRefs) {
  assert.equal(record.published, true);
  assert.equal(record.intent, true);
  assert.ok(record.artifact);
  assert.equal(remoteRefs.get(record.artifact.ref), record.artifact.commit, 'Exact retained artifact ref is missing');
  const prepared = [...remoteRefs].filter(([ref, sha]) => ref.startsWith('refs/semantic-release-workspace/prepared/') && ref.endsWith('/' + journal.head) && sha === journal.execution.prepared);
  assert.equal(prepared.length, 1, 'Exactly one matching immutable prepared ref is required');
  // New shared journals have no tagged field and create no per-package tags.
}
