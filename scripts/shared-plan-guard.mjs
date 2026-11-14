// Additive to the existing live-cycle guard. This module never publishes or changes refs.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

export function assertSharedAlphaPlan(plan, intent) {
  assert.equal(intent.branch, 'alpha');
  assert.equal(intent.channel, 'alpha');
  assert.match(intent.candidateSha, /^[a-f0-9]{40}$/);
  assert.match(intent.sourceSha, /^[a-f0-9]{40}$/);
  assert.ok(['npm', 'pnpm', 'yarn', 'cargo'].includes(intent.lane));
  assert.ok(['publish', 'no-change'].includes(intent.mode));
  const names = intent.lane === 'cargo'
    ? ['enkhjile-srw-e2e-core', 'enkhjile-srw-e2e-adapter']
    : ['core', 'app'].map(role => `@enkhjile/srw-e2e-${intent.lane}-${role}`);
  assert.deepEqual([...intent.members].sort(), [...names].sort(), 'Only the two existing public identities are authorized');
  assert.equal(intent.budgetLimit, 12);
  assert.ok(Number.isInteger(intent.alreadyAdded) && intent.alreadyAdded >= 0);
  assert.ok(intent.alreadyAdded <= intent.budgetLimit);
  assert.equal(plan.head, intent.sourceSha, 'Preview must bind to the actual merged push source');
  assert.equal(plan.release?.branch, 'alpha');
  assert.equal(plan.release?.channel, 'alpha');
  assert.equal(plan.release?.prerelease, 'alpha');
  const selected = plan.packages.filter(p => !p.private && p.nextVersion);
  if (intent.mode === 'no-change') {
    assert.equal(selected.length, 0);
    return;
  }
  assert.match(intent.version, /^\d+\.\d+\.\d+-alpha\.\d+$/, 'Only literal alpha prereleases are authorized');
  assert.equal(plan.versioning, 'shared');
  assert.equal(plan.version, intent.version, 'The semantic-release coordinator version must be authoritative');
  assert.ok(plan.packages.filter(p => p.private).every(p => p.nextVersion === null));
  const additional = intent.expectedAdditionalVersions ?? names.length;
  assert.ok(Number.isInteger(additional) && additional >= 0 && additional <= names.length);
  assert.ok(intent.alreadyAdded + additional <= intent.budgetLimit, 'Per-repo publication cap exceeded');
  assert.deepEqual(selected.map(p => p.name).sort(), [...names].sort(), 'All public members must release together');
  assert.equal(new Set(selected.map(p => p.name)).size, names.length);
  for (const pkg of selected) assert.equal(pkg.nextVersion, intent.version, 'All members must have the coordinator version');
  for (const name of intent.unchangedMembers ?? []) {
    assert.ok(names.includes(name));
    assert.deepEqual(selected.find(p => p.name === name).commits, [], 'The unchanged member must have no own commits');
  }
  const core = names[0], dependent = selected.find(p => p.name === names[1]);
  const update = dependent.dependencyUpdates.find(update => update.dependency === `${intent.lane === 'cargo' ? 'cargo' : 'npm'}:${core}` || update.field?.includes(core));
  assert.ok(update, 'The public dependent must explicitly track the shared core release');
  const allowed = [intent.version, '^' + intent.version, ...(intent.lane === 'cargo' ? ['=' + intent.version] : [])];
  assert.ok(allowed.includes(update.publishedRange), 'The public dependency must resolve the exact shared prerelease');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  assert.equal(process.argv.length, 4, 'Usage: node shared-plan-guard.mjs PLAN.json INTENT.json');
  const plan = JSON.parse(readFileSync(process.argv[2]));
  const intent = JSON.parse(readFileSync(process.argv[3]));
  assertSharedAlphaPlan(plan, intent);
  console.log(JSON.stringify({status: 'PASS', branch: 'alpha', source: intent.sourceSha, mode: intent.mode, version: intent.version}));
}
