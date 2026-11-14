import assert from 'node:assert/strict';
import test from 'node:test';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {candidatePackEntry, assertFrozenRecovery, assertRetainedPublication} from './candidate-helpers.mjs';

const entry = {name: 'semantic-release-workspace', version: '0.0.0-development', filename: 'semantic-release-workspace-0.0.0-development.tgz', integrity: 'sha512-YQ=='};
for (const shape of [[entry], {[entry.name]: entry}]) test('accepts one validated native npm pack shape ' + (Array.isArray(shape) ? 'array' : 'keyed'), () => {
  assert.deepEqual(candidatePackEntry(JSON.stringify(shape), entry), entry);
});
for (const [name, output] of [
  ['null', null], ['multiple array entries', [entry, entry]], ['extra keyed entry', {[entry.name]: entry, unexpected: entry}],
  ['wrong key', {wrong: entry}], ['wrong name', [{...entry, name: 'other'}]], ['wrong version', [{...entry, version: '99.0.0'}]],
  ['parent filename', [{...entry, filename: '../other.tgz'}]], ['backslash filename', [{...entry, filename: '..\\other.tgz'}]],
]) test('rejects ambiguous or invalid pack output: ' + name, () => assert.throws(() => candidatePackEntry(JSON.stringify(output), entry)));

test('pending-to-complete retry allows completion bookkeeping and preserves only frozen fields', () => {
  const before = {planning: {plan: {version: '1.5.0-alpha.1'}, releaseNotes: {date: '2026-11-13'}, versions: [], dependencyRanges: []}, execution: {prepared: 'a'.repeat(40), packages: [{id: 'npm:core', artifact: {commit: 'b'.repeat(40)}}]}};
  const complete = structuredClone(before);
  complete.planning.versions = [{id: 'npm:core', version: '1.5.0-alpha.1'}];
  complete.planning.dependencyRanges = [{publishedRange: '1.5.0-alpha.1'}];
  assertFrozenRecovery(complete, before);
  complete.execution.packages[0].artifact.commit = 'c'.repeat(40);
  assert.throws(() => assertFrozenRecovery(complete, before));
});

test('new shared records require retained refs but do not require legacy tagged/package tags', () => {
  const head = 'a'.repeat(40), prepared = 'b'.repeat(40), commit = 'c'.repeat(40);
  const artifact = {ref: 'refs/semantic-release-workspace/artifacts/scope/' + head + '/id', commit};
  const refs = new Map([[artifact.ref, commit], ['refs/semantic-release-workspace/prepared/scope/' + head, prepared]]);
  const record = {intent: true, published: true, artifact};
  assertRetainedPublication(record, {head, execution: {prepared}}, refs);
  refs.delete(artifact.ref);
  assert.throws(() => assertRetainedPublication(record, {head, execution: {prepared}}, refs));
});

test('real native pack and installed candidate binding smoke; tampering fails', () => {
  const root = mkdtempSync(join(tmpdir(), 'shared-candidate-binding-smoke-'));
  try {
    const pkg = join(root, 'node_modules/semantic-release-workspace');
    mkdirSync(join(pkg, 'dist'), {recursive: true});
    mkdirSync(join(root, 'vendor'));
    mkdirSync(join(root, 'scripts'));
    const files = {
      'package.json': JSON.stringify({name: entry.name, version: entry.version, type: 'module', exports: './dist/index.mjs', files: ['dist'], license: 'MIT'}),
      'dist/index.mjs': 'export const candidate = true;\n',
      'dist/index.d.mts': 'export declare const candidate: true;\n',
      'README.md': 'Candidate fixture\n', 'LICENSE': 'Fixture license\n',
    };
    for (const [path, content] of Object.entries(files)) writeFileSync(join(pkg, path), content);
    const raw = execFileSync('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', root], {cwd: pkg, encoding: 'utf8', env: {...process.env, npm_config_cache: join(root, 'npm-cache')}});
    const packed = candidatePackEntry(raw, entry);
    const bytes = readFileSync(join(root, packed.filename));
    assert.equal(packed.integrity, 'sha512-' + createHash('sha512').update(bytes).digest('base64'));
    copyFileSync(join(root, packed.filename), join(root, 'vendor/shared-version-candidate.tgz'));
    copyFileSync(new URL('./verify-candidate.mjs', import.meta.url), join(root, 'scripts/verify-candidate.mjs'));
    const binding = {name: entry.name, sha: 'd'.repeat(40), node: process.version, tarballSha256: createHash('sha256').update(bytes).digest('hex'), tarballIntegrity: packed.integrity, files: Object.fromEntries(Object.entries(files).map(([path, content]) => [path, createHash('sha256').update(content).digest('hex')]))};
    writeFileSync(join(root, 'candidate-binding.json'), JSON.stringify(binding));
    const checked = JSON.parse(execFileSync(process.execPath, ['scripts/verify-candidate.mjs'], {cwd: root, encoding: 'utf8'}));
    assert.equal(checked.sha, binding.sha);
    writeFileSync(join(pkg, 'dist/index.mjs'), 'tampered');
    assert.throws(() => execFileSync(process.execPath, ['scripts/verify-candidate.mjs'], {cwd: root, stdio: 'pipe'}));
  } finally {rmSync(root, {recursive: true, force: true});}
});
