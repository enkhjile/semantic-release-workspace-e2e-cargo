import assert from 'node:assert/strict';
import test from 'node:test';
import {assertSharedAlphaPlan} from './shared-plan-guard.mjs';
import {assertAddedVersions, resolvePublishPlan} from './shared-live-cycle.mjs';

const core = '@enkhjile/srw-e2e-npm-core', app = '@enkhjile/srw-e2e-npm-app';
const version = '1.5.0-alpha.1', head = 'a'.repeat(40);
function fixture() {
  return {
    intent: {branch: 'alpha', channel: 'alpha', candidateSha: 'b'.repeat(40), sourceSha: head, lane: 'npm', mode: 'publish', members: [core, app], budgetLimit: 12, alreadyAdded: 0, version, unchangedMembers: [app]},
    plan: {head, versioning: 'shared', version, releaseType: 'minor', release: {branch: 'alpha', channel: 'alpha', prerelease: 'alpha'}, packages: [
      {name: core, private: false, nextVersion: version, commits: [{message: 'feat: add core capability'}], dependencyUpdates: []},
      {name: app, private: false, nextVersion: version, commits: [], dependencyUpdates: [{dependency: 'npm:' + core, field: ['dependencies', core], publishedRange: version}]},
      {name: 'private-member', private: true, nextVersion: null, commits: [], dependencyUpdates: []},
    ]},
  };
}
test('core-only change releases unchanged public app at exact coordinator version', () => {
  const {plan, intent} = fixture();
  assertSharedAlphaPlan(plan, intent);
});
test('app-only change releases unchanged core at exact coordinator version', () => {
  const {plan, intent} = fixture();
  plan.packages[0].commits = [];
  plan.packages[1].commits = [{message: 'fix: improve app behavior'}];
  intent.unchangedMembers = [core];
  assertSharedAlphaPlan(plan, intent);
});
for (const [label, mutate] of [
  ['stable branch', x => {x.plan.release.branch = 'main';}],
  ['nonliteral alpha identifier', x => {x.plan.release.prerelease = 'alpha7';}],
  ['coordinator mismatch', x => {x.plan.version = '1.5.0-alpha.2';}],
  ['independent mode', x => {x.plan.versioning = 'independent';}],
  ['missing public member', x => {x.plan.packages.splice(1, 1);}],
  ['different member version', x => {x.plan.packages[1].nextVersion = '1.1.1-alpha.2';}],
  ['changed supposedly unchanged member', x => {x.plan.packages[1].commits = [{message: 'fix: hidden app change'}];}],
  ['stale dependency', x => {x.plan.packages[1].dependencyUpdates[0].publishedRange = '1.0.0';}],
  ['unauthorized identity', x => {x.intent.members[0] = '@enkhjile/new-package';}],
  ['budget overflow', x => {x.intent.alreadyAdded = 11;}],
]) test('rejects ' + label, () => {
  const x = fixture(); mutate(x);
  assert.throws(() => assertSharedAlphaPlan(x.plan, x.intent));
});
test('same-source completed retry at budget ceiling adds zero versions', () => {
  const {plan, intent} = fixture();
  intent.alreadyAdded = 12;
  intent.expectedAdditionalVersions = 0;
  assertSharedAlphaPlan(plan, intent);
  const journal = {head, status: 'complete', planning: {plan}};
  assert.equal(resolvePublishPlan(null, journal, head), plan);
  assertAddedVersions([], [{name: core, version}, {name: app, version}], {[core]: {versions: {[version]: 'frozen'}}, [app]: {versions: {[version]: 'frozen'}}});
});
test('no-next-release does not pass for a pending or wrong-source journal', () => {
  const {plan} = fixture();
  assert.throws(() => resolvePublishPlan(null, {head, status: 'pending', planning: {plan}}, head));
  assert.throws(() => resolvePublishPlan(null, {head: 'c'.repeat(40), status: 'complete', planning: {plan}}, head));
});
test('pending retry accepts logged frozen plan without requiring a new root release', () => {
  const {plan} = fixture();
  assert.equal(resolvePublishPlan(plan, {head, status: 'pending', planning: {plan}}, head), plan);
});
test('Cargo permits only the same native exact shared requirement', () => {
  const {plan, intent} = fixture();
  const cargoCore = 'enkhjile-srw-e2e-core', adapter = 'enkhjile-srw-e2e-adapter';
  intent.lane = 'cargo';
  intent.members = [cargoCore, adapter];
  intent.unchangedMembers = [adapter];
  plan.packages[0].name = cargoCore;
  plan.packages[1].name = adapter;
  plan.packages[1].dependencyUpdates = [{dependency: 'cargo:' + cargoCore, field: ['dependencies', cargoCore], publishedRange: '=' + version}];
  assertSharedAlphaPlan(plan, intent);
  plan.packages[1].dependencyUpdates[0].publishedRange = '=1.0.0';
  assert.throws(() => assertSharedAlphaPlan(plan, intent));
});
