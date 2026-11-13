import {allMembersPublished, assertExpectedBoundary, injectRetryBoundary} from './retry-boundary.mjs';
import {assertReadOnlyNetwork, networkSummary} from './network-policy.mjs';
import {assertFrozenRecovery, assertRetainedPublication} from './candidate-helpers.mjs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync, spawnSync} from 'node:child_process';
import {mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
import {verifyCandidateBinding} from './verify-candidate.mjs';
import {assertSharedAlphaPlan} from './shared-plan-guard.mjs';
import {parsePlan} from './live-plan.mjs';
import {resolvePublishPlan} from './shared-live-cycle.mjs';

const out = resolve('evidence/shared-version');
mkdirSync(out, {recursive: true});
const binding = verifyCandidateBinding();
const intent = JSON.parse(readFileSync('shared-live-intent.json'));
const baseline = JSON.parse(readFileSync('shared-public-baseline.json'));
const names = ['enkhjile-srw-e2e-core', 'enkhjile-srw-e2e-adapter'];
const git = (...args) => execFileSync('git', args, {encoding: 'utf8'});
const head = git('rev-parse', 'HEAD').trim();
const save = (name, value) => writeFileSync(join(out, name + '.json'), JSON.stringify(value, null, 2) + '\n');
assert.equal(process.env.GITHUB_EVENT_NAME, 'push');
assert.equal(process.env.GITHUB_REF, 'refs/heads/alpha');
assert.equal(process.env.GITHUB_REPOSITORY, 'enkhjile/semantic-release-workspace-e2e-cargo');
assert.equal(head, process.env.GITHUB_SHA);
assert.equal(intent.branch, 'alpha');
assert.equal(intent.channel, 'alpha');
assert.equal(intent.candidateSha, binding.sha);
assert.equal(intent.budgetLimit, 12);
assert.ok(['preview', 'publish', 'no-change'].includes(intent.mode));
assert.ok(intent.expected.length <= 2);
assert.equal(JSON.parse(readFileSync('package.json')).devDependencies['semantic-release-workspace'], 'file:vendor/shared-version-candidate.tgz');
for (const key of ['NPM_TOKEN', 'NODE_AUTH_TOKEN', 'CARGO_REGISTRY_TOKEN', 'CARGO_REGISTRIES_CRATES_IO_TOKEN']) assert.ok(!process.env[key], key + ' must be absent');
const headers = {'user-agent': 'shared-version acceptance (github.com/enkhjile/semantic-release-workspace-e2e-cargo)'};
async function metadata(name) {
  const response = await fetch('https://crates.io/api/v1/crates/' + name, {headers, signal: AbortSignal.timeout(30000)});
  assert.equal(response.status, 200);
  return (await response.json()).versions;
}
async function inventory() {
  const result = {};
  for (const name of names) result[name] = Object.fromEntries((await metadata(name)).map(v => [v.num, {checksum: v.checksum, yanked: v.yanked}]));
  return result;
}
function source() {
  return {head: git('rev-parse', 'HEAD').trim(), status: git('status', '--porcelain'), files: git('ls-files', '-z').split('\0').filter(Boolean).map(path => ({path, sha256: createHash('sha256').update(readFileSync(path)).digest('hex')}))};
}
async function snapshot() {return {source: source(), refs: git('ls-remote', '--refs', 'origin').trim().split('\n').sort(), inventory: await inventory()};}
function currentJournal() {
  const ref = 'refs/notes/workspace-release-branches/' + createHash('sha256').update('alpha').digest('hex');
  const listed = spawnSync('git', ['notes', '--ref=' + ref, 'list'], {encoding: 'utf8'});
  if (listed.status !== 0) return null;
  return listed.stdout.trim().split('\n').filter(Boolean).map(line => JSON.parse(git('cat-file', 'blob', line.split(' ')[0]))).find(j => j.head === head) ?? null;
}
function run(label, dry = false, readonly = false) {
  const audit = join(out, label + '-http.jsonl');
  writeFileSync(audit, '');
  const child = spawnSync('npm', ['exec', '--', 'semantic-release', ...(dry ? ['--dry-run'] : [])], {encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, env: {...process.env, NODE_OPTIONS: [process.env.NODE_OPTIONS, '--import=' + pathToFileURL(resolve('scripts/network-count.mjs')).href].filter(Boolean).join(' '), SRW_HTTP_AUDIT: audit}});
  const output = (child.stdout ?? '') + (child.stderr ?? '');
  writeFileSync(join(out, label + '.log'), output);
  process.stdout.write(output);
  const calls = readFileSync(audit, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
  assert.ok(calls.some(c => c.transport === 'observer'));
  if (readonly) assertReadOnlyNetwork(calls);
  save(label + '-http-summary', networkSummary(calls));
  if (child.status !== 0) {
    save(label + '-failed-journal', currentJournal());
    save(label + '-failure', {exitCode: child.status, source: head, automaticRetry: false});
  }
  if (child.status !== 0 && label === 'release' && injectRetryBoundary(intent, process.env.GITHUB_RUN_ATTEMPT)) {
    const pending = currentJournal();
    assertExpectedBoundary({intent, attempt: process.env.GITHUB_RUN_ATTEMPT, output, journal: pending, head});
    assert.equal(git('rev-parse', 'refs/tags/' + pending.batchTag).trim(), head);
    save('expected-pending-retry', {status: 'EXPECTED_FAILURE', source: head, version: intent.version, attempt: process.env.GITHUB_RUN_ATTEMPT, frozen: pending, instruction: 'Confirm exact public registry bytes and ledger, then rerun this same GitHub run with a fresh checkout. Do not edit source or advance versions.'});
  }
  assert.equal(child.status, 0, label + ' real semantic-release failed');
  return output;
}

const before = await snapshot();
assert.equal(before.source.status, '');
save('before', before);
let alreadyAdded = 0;
for (const name of names) {
  for (const [version, old] of Object.entries(baseline[name].versions)) assert.deepEqual(before.inventory[name][version], old);
  alreadyAdded += Object.keys(before.inventory[name]).filter(v => !(v in baseline[name].versions)).length;
}
const expectedAdditionalVersions = intent.expected.filter(p => !(p.version in before.inventory[p.name])).length;
assert.ok(alreadyAdded + expectedAdditionalVersions <= 12);
if (intent.mode === 'publish') {
  const semver = createRequire(import.meta.resolve('semantic-release'))('semver');
  for (const name of names) for (const version of Object.keys(before.inventory[name])) if (version !== intent.version) assert.ok(semver.gt(intent.version, version));
}
for (const name of intent.unchangedMembers ?? []) {
  assert.ok(names.includes(name));
  assert.match(intent.previousSourceSha, /^[a-f0-9]{40}$/);
  const directory = name.endsWith('-core') ? 'crates/core' : 'crates/outer/inner/nested';
  assert.equal(git('diff', '--name-only', intent.previousSourceSha, head, '--', directory).trim(), '', 'Unchanged public member source changed');
}
const output = run('dry-run', true, true);
const loggedPlan = output.includes('"schemaVersion": 1') ? parsePlan(output) : null;
const frozenBefore = currentJournal();
if (frozenBefore) save('journal-before', frozenBefore);
let plan = loggedPlan;
if (intent.mode === 'publish') {
  plan = resolvePublishPlan(plan, frozenBefore, head);
  assertSharedAlphaPlan(plan, {...intent, lane: 'cargo', sourceSha: head, alreadyAdded, expectedAdditionalVersions, members: names});
  assert.deepEqual(plan.packages.filter(p => !p.private && p.nextVersion).map(p => ({name: p.name, version: p.nextVersion})).sort((a,b) => a.name.localeCompare(b.name)), [...intent.expected].sort((a,b) => a.name.localeCompare(b.name)));
} else if (intent.mode === 'no-change') {
  assert.equal(intent.expected.length, 0);
  if (plan) assert.equal(plan.packages.filter(p => !p.private && p.nextVersion).length, 0);
  else assert.match(output, /There are no relevant changes|There are no changes to release/);
} else {
  assert.equal(intent.expected.length, 0);
  if (plan) {
    assert.equal(plan.versioning, 'shared');
    assert.equal(plan.release.branch, 'alpha');
    assert.equal(plan.release.prerelease, 'alpha');
    assert.ok(plan.packages.filter(p => !p.private).every(p => p.nextVersion === plan.version));
  }
}
save('plan', plan);
assert.deepEqual(await snapshot(), before, 'Dry-run changed source, refs or public inventory');
if (intent.mode === 'preview') {
  save('result', {status: 'PASS', mode: 'preview', source: head, candidateSha: binding.sha, uploads: 0});
} else {
  run('release', false, intent.mode === 'no-change' || frozenBefore?.status === 'complete' || allMembersPublished(frozenBefore, intent, head));
  assert.deepEqual(source(), before.source);
  let journal;
  if (intent.expected.length) {
    journal = currentJournal();
    assert.equal(journal?.status, 'complete');
    assert.equal(journal.head, head);
    assert.equal(journal.planning.plan.version, intent.version);
    assert.equal(journal.batchTag, 'workspace-v' + intent.version);
    assert.equal(git('rev-parse', 'refs/tags/' + journal.batchTag).trim(), head);
    if (frozenBefore) assertFrozenRecovery(journal, frozenBefore);
    save('journal', journal);
  }
  const proof = [];
  for (const {name, version} of intent.expected) {
    let row;
    const deadline = Date.now() + 1200000;
    do {
      row = (await metadata(name)).find(v => v.num === version);
      if (row) break;
      await new Promise(resolve => setTimeout(resolve, 15000));
    } while (Date.now() < deadline);
    assert.ok(row, 'Public metadata not visible; retain frozen state, do not reupload');
    assert.equal(row.trustpub_data?.provider, 'github');
    assert.equal(row.trustpub_data.repository, process.env.GITHUB_REPOSITORY);
    assert.equal(row.trustpub_data.sha, head);
    assert.equal(row.trustpub_data.run_id, process.env.GITHUB_RUN_ID);
    const response = await fetch(`https://static.crates.io/crates/${name}/${name}-${version}.crate`, {headers});
    assert.equal(response.status, 200);
    const bytes = Buffer.from(await response.arrayBuffer());
    assert.equal(createHash('sha256').update(bytes).digest('hex'), row.checksum);
    const record = journal.execution.packages.find(p => p.id === 'cargo:' + name);
    const artifactRefs = new Map(git('ls-remote', '--refs', 'origin').trim().split('\n').map(line => line.split('\t').reverse()));
    assertRetainedPublication(record, journal, artifactRefs);
    assert.equal(git('rev-parse', record.artifact.commit + '^').trim(), journal.execution.prepared);
    assert.equal(git('rev-parse', journal.execution.prepared + '^').trim(), head);
    assert.equal(record.artifact.sha256, row.checksum);
    assert.deepEqual(execFileSync('git', ['show', record.artifact.commit + ':artifact']), bytes);
    const archive = join(out, `${name}-${version}.crate`);
    writeFileSync(archive, bytes);
    const manifest = execFileSync('tar', ['-xOf', archive, `${name}-${version}/Cargo.toml`], {encoding: 'utf8'});
    writeFileSync(archive + '.Cargo.toml', manifest);
    assert.ok(manifest.includes(`version = "${version}"`));
    proof.push({name, version, checksum: row.checksum, trustpub: row.trustpub_data, artifact: record.artifact});
  }
  const released = await snapshot();
  const additions = [];
  for (const name of names) {
    for (const [version, old] of Object.entries(before.inventory[name])) assert.deepEqual(released.inventory[name][version], old);
    for (const version of Object.keys(released.inventory[name])) if (!(version in before.inventory[name])) additions.push({name, version});
  }
  assert.deepEqual(additions.sort((a,b) => a.name.localeCompare(b.name)), intent.expected.filter(p => !(p.version in before.inventory[p.name])).sort((a,b) => a.name.localeCompare(b.name)));
  const releasedRefs = new Map(released.refs.map(line => line.split('\t').reverse()));
  const originalRefs = new Map(before.refs.map(line => line.split('\t').reverse()));
  for (const [ref, oid] of releasedRefs) if (ref.startsWith('refs/tags/') && !originalRefs.has(ref)) {
    assert.equal(ref, 'refs/tags/workspace-v' + intent.version, 'Only the shared coordinator tag may be created');
    assert.equal(oid, head);
  }
  const alphaKey = createHash('sha256').update('alpha').digest('hex');
  const mutable = new Set(['refs/notes/workspace-release-branches/' + alphaKey, 'refs/notes/workspace-release-history/' + alphaKey, 'refs/notes/semantic-release-0-workspace']);
  for (const line of before.refs) {
    const [oid, ref] = line.split('\t');
    if (!mutable.has(ref)) assert.equal(releasedRefs.get(ref), oid, 'Historical ref changed');
    else if (releasedRefs.get(ref) !== oid) git('merge-base', '--is-ancestor', oid, releasedRefs.get(ref));
  }
  save('after-release', released);
  save('published', {proof, additions});
  if (intent.mode === 'no-change') assert.deepEqual(released, before);
  run('no-change', false, true);
  const unchanged = await snapshot();
  save('after-no-change', unchanged);
  assert.deepEqual(unchanged, released);
  if (intent.expected.length) {
    const consumer = mkdtempSync(join(tmpdir(), 'srw-shared-cargo-consumer-'));
    try {
      mkdirSync(join(consumer, 'src'));
      writeFileSync(join(consumer, 'Cargo.toml'), `[package]\nname="shared-native-consumer"\nversion="0.1.0"\nedition="2024"\n[workspace]\n[dependencies]\nenkhjile-srw-e2e-adapter="=${intent.version}"\n`);
      writeFileSync(join(consumer, 'src/main.rs'), 'fn main(){assert_eq!(enkhjile_srw_e2e_adapter::value(),42);println!("42");}\n');
      const output = execFileSync('cargo', ['run', '--quiet'], {cwd: consumer, encoding: 'utf8'});
      assert.equal(output.trim(), '42');
      const resolved = JSON.parse(execFileSync('cargo', ['metadata', '--format-version=1'], {cwd: consumer, encoding: 'utf8'}));
      for (const name of names) assert.equal(resolved.packages.find(p => p.name === name)?.version, intent.version);
      const dependent = resolved.packages.find(p => p.name === names[1]);
      const requirement = dependent.dependencies.find(d => d.name === names[0]).req;
      assert.ok([intent.version, '^' + intent.version, '=' + intent.version].includes(requirement));
      save('native-consumer', {output: output.trim(), version: intent.version, dependencyRequirement: requirement, packages: resolved.packages.filter(p => names.includes(p.name)).map(p => ({name: p.name, version: p.version, source: p.source}))});
    } finally {rmSync(consumer, {recursive: true, force: true});}
  }
  save('result', {status: 'PASS', mode: intent.mode, source: head, candidateSha: binding.sha, newVersions: additions.length, dryRunEffects: 0, noChangeEffects: 0});
}
