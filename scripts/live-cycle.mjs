import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const out = resolve('evidence/live-alpha8');
mkdirSync(out, { recursive: true });
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' });
const intent = JSON.parse(readFileSync('live-cycle-intent.json'));
const names = ['enkhjile-srw-e2e-core', 'enkhjile-srw-e2e-adapter'];
const sha = git('rev-parse', 'HEAD').trim();
assert.equal(process.env.GITHUB_EVENT_NAME, 'push');
assert.equal(sha, process.env.GITHUB_SHA);
assert.ok(['refs/heads/main', 'refs/heads/alpha'].includes(process.env.GITHUB_REF));
assert.ok(['preview', 'release'].includes(intent.mode));
for (const name of ['NPM_TOKEN', 'NODE_AUTH_TOKEN', 'CARGO_REGISTRY_TOKEN', 'CARGO_REGISTRIES_CRATES_IO_TOKEN']) {
  assert.ok(!process.env[name], `${name} must be absent`);
}
assert.equal(JSON.parse(readFileSync('node_modules/semantic-release-workspace/package.json')).version, '1.0.0-alpha.8');
const binding = {
  'LICENSE': 'cbf03239029c49b8ed065c590b4e607b320056de4488b2b30be5054f58963ba9',
  'package.json': '69d5febdec2f99bdc2bb34df8d77e675451c9d04f4ef70d5e581bf8147ff341e',
  'README.md': '6fabe34a436b7cefdff56238f75e89413ab2218c8d8e2aa03477882d93af6ba6',
  'dist/index.mjs': 'd947b81548774898a4b24e94fbafef0582746e7a69b82a75a264635084ce8a36',
  'dist/index.d.mts': 'bd901675972e58d3e06fe4906d31e69905b70b99f6c0ac8a3e7a8f576144be34',
};
for (const [path, hash] of Object.entries(binding)) {
  assert.equal(createHash('sha256').update(readFileSync(join('node_modules/semantic-release-workspace', path))).digest('hex'), hash);
}
const save = (name, value) => writeFileSync(join(out, name + '.json'), JSON.stringify(value, null, 2) + '\n');
const headers = { 'user-agent': 'semantic-release-workspace live acceptance (github.com/enkhjile/semantic-release-workspace-e2e-cargo)' };
async function metadata(name) {
  const response = await fetch('https://crates.io/api/v1/crates/' + name, { headers });
  assert.equal(response.status, 200);
  return (await response.json()).versions;
}
async function inventory() {
  const rows = {};
  for (const name of names) rows[name] = Object.fromEntries((await metadata(name)).map(v => [v.num, { checksum: v.checksum, yanked: v.yanked }]).sort(([a], [b]) => a.localeCompare(b)));
  return rows;
}
function source() {
  return { head: git('rev-parse', 'HEAD').trim(), status: git('status', '--porcelain'), files: git('ls-files', '-z').split('\0').filter(Boolean).map(path => ({ path, sha256: createHash('sha256').update(readFileSync(path)).digest('hex') })) };
}
async function snapshot() {
  return { source: source(), refs: git('ls-remote', '--refs', 'origin').trim().split('\n').sort(), inventory: await inventory() };
}
function run(label, dry = false) {
  const args = ['exec', '--', 'semantic-release', ...(dry ? ['--dry-run'] : [])];
  const result = spawnSync('npm', args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  const output = (result.stdout ?? '') + (result.stderr ?? '');
  writeFileSync(join(out, label + '.log'), output);
  process.stdout.write(output);
  assert.equal(result.status, 0, `${label} failed`);
  return output;
}
function plan(output) {
  const key = output.indexOf('"schemaVersion": 1');
  if (key < 0) return [];
  for (let start = output.lastIndexOf('{', key); start >= 0; start = output.lastIndexOf('{', start - 1)) {
    for (let end = start + 1; end < output.length; end++) {
      if (output[end] !== '}') continue;
      try { const value = JSON.parse(output.slice(start, end + 1)); if (value.schemaVersion === 1 && Array.isArray(value.packages)) return value.packages.filter(p => !p.private && p.nextVersion).map(p => ({ name: p.name, nextVersion: p.nextVersion })).sort((a, b) => a.name.localeCompare(b.name)); } catch {}
    }
    if (start === 0) break;
  }
  throw Error('Unparseable workspace plan');
}
const before = await snapshot();
assert.equal(before.source.status, '', 'Release source must be clean');
save('before', before);
const preview = run('dry-run', true);
const selected = plan(preview);
const expected = [...intent.expected].sort((a, b) => a.name.localeCompare(b.name));
if (selected.length === 0 && expected.length > 0 && Number(process.env.GITHUB_RUN_ATTEMPT) > 1) {
  for (const { name, nextVersion } of expected) {
    const previous = (await metadata(name)).find(v => v.num === nextVersion);
    assert.equal(previous?.trustpub_data?.provider, 'github');
    assert.equal(previous.trustpub_data.repository, process.env.GITHUB_REPOSITORY);
    assert.equal(previous.trustpub_data.sha, sha, 'Completed retry must belong to this exact source');
    assert.equal(previous.trustpub_data.run_id, process.env.GITHUB_RUN_ID);
  }
} else {
  assert.deepEqual(selected, expected, 'Exact reviewed versions required');
}
save('plan', { intent, selected, source: sha, binding });
assert.deepEqual(await snapshot(), before, 'Dry-run changed source, refs or registry');
if (intent.mode === 'release') {
  run('release');
  assert.deepEqual(source(), before.source, 'Plugin did not restore source');
  const proof = [];
  for (const { name, nextVersion: version } of intent.expected) {
    let row;
    for (let attempt = 0; attempt < 30; attempt++) {
      row = (await metadata(name)).find(v => v.num === version);
      if (row) break;
      await new Promise(resolve => setTimeout(resolve, 10000));
    }
    assert.ok(row, `${name}@${version} missing; do not republish`);
    assert.equal(row.trustpub_data?.provider, 'github');
    assert.equal(row.trustpub_data.repository, process.env.GITHUB_REPOSITORY);
    assert.equal(row.trustpub_data.sha, sha);
    if (Number(process.env.GITHUB_RUN_ATTEMPT) === 1) assert.equal(row.trustpub_data.run_id, process.env.GITHUB_RUN_ID);
    const response = await fetch(`https://static.crates.io/crates/${name}/${name}-${version}.crate`, { headers });
    assert.equal(response.status, 200);
    const bytes = Buffer.from(await response.arrayBuffer());
    assert.equal(createHash('sha256').update(bytes).digest('hex'), row.checksum);
    const path = join(out, `${name}-${version}.crate`);
    writeFileSync(path, bytes);
    const manifest = execFileSync('tar', ['-xOf', path, `${name}-${version}/Cargo.toml`], { encoding: 'utf8' });
    assert.ok(manifest.includes(`version = "${version}"`));
    writeFileSync(path + '.Cargo.toml', manifest);
    proof.push({ name, version, checksum: row.checksum, bytes: bytes.length, trustpub: row.trustpub_data, packageTag: git('rev-parse', `refs/tags/cargo/${name}@${version}`).trim() });
  }
  const complete = await snapshot();
  if (intent.expected.length === 0) assert.deepEqual(complete, before, 'No-release invocation changed source, refs or public inventory');
  const additions = [];
  for (const name of names) {
    for (const [version, value] of Object.entries(before.inventory[name])) assert.deepEqual(complete.inventory[name][version], value, 'Existing public version changed');
    for (const version of Object.keys(complete.inventory[name])) if (!(version in before.inventory[name])) additions.push({ name, nextVersion: version });
  }
  const expectedNew = intent.expected.filter(p => !(p.nextVersion in before.inventory[p.name]));
  assert.deepEqual(additions.sort((a, b) => a.name.localeCompare(b.name)), [...expectedNew].sort((a, b) => a.name.localeCompare(b.name)));
  save('published', { source: sha, run: process.env.GITHUB_RUN_ID, proof, additions });
  save('after-release', complete);
  run('no-change');
  const afterNoChange = await snapshot();
  save('after-no-change', afterNoChange);
  assert.deepEqual(afterNoChange, complete, 'No-change rerun changed source, refs or public versions');
  const adapter = intent.expected.find(p => p.name.endsWith('-adapter'));
  if (adapter) {
    const consumer = resolve('.scratch/live-alpha8-downstream');
    mkdirSync(join(consumer, 'src'), { recursive: true });
    writeFileSync(join(consumer, 'Cargo.toml'), `[package]\nname="srw-live-downstream"\nversion="0.1.0"\nedition="2024"\n[workspace]\n[dependencies]\nenkhjile-srw-e2e-adapter="=${adapter.nextVersion}"\n`);
    writeFileSync(join(consumer, 'src/main.rs'), 'fn main() { assert_eq!(enkhjile_srw_e2e_adapter::value(), 42); println!("42"); }\n');
    const child = spawnSync('cargo', ['run', '--quiet'], { cwd: consumer, encoding: 'utf8' });
    writeFileSync(join(out, 'downstream.log'), (child.stdout ?? '') + (child.stderr ?? ''));
    assert.equal(child.status, 0, child.stderr);
    assert.equal(child.stdout.trim(), '42');
  }
}
save('result', { status: 'PASS', intent, source: sha, event: process.env.GITHUB_EVENT_NAME, ref: process.env.GITHUB_REF, run: process.env.GITHUB_RUN_ID, publicUploads: intent.mode === 'release' ? intent.expected.length : 0, sourceRestored: true, dryRunUnchanged: true });
