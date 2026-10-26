import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { parse } from 'yaml';
import { expectedBuiltInCratesIoScenarios, verifyCandidateResults } from './candidate-product.mjs';

const root = resolve(import.meta.dirname, '..');

const result = (name, extra = {}) => ({
  name,
  status: 'PASS',
  nativeMissingNamedIndex: false,
  localIdentityRequests: 1,
  publicUploads: 0,
  releaseExit: 1,
  cargoPublishCalls: 0,
  ...extra,
});

test('accepts the complete built-in crates.io native-packaging candidate evidence', () => {
  const verdict = verifyCandidateResults({
    results: expectedBuiltInCratesIoScenarios.map((name) => result(name)),
  });

  assert.deepEqual(verdict.scenarios, expectedBuiltInCratesIoScenarios);
  assert.equal(verdict.publicUploads, 0);
  assert.equal(verdict.localIdentityRequests, expectedBuiltInCratesIoScenarios.length);
});

test('requires candidate lifecycle evidence to identify the recorded installed plugin', () => {
  const installedPlugin = { name: 'semantic-release-workspace', version: '0.0.0-candidate.1' };
  const expectedArtifact = `${installedPlugin.name}@${installedPlugin.version}`;
  const mismatched = {
    results: expectedBuiltInCratesIoScenarios.map((name) => result(name, {
      installedArtifact: 'semantic-release-workspace@1.0.0-alpha.3',
    })),
  };

  assert.throws(
    () => verifyCandidateResults(mismatched, installedPlugin),
    /installed candidate/,
  );

  const verdict = verifyCandidateResults({
    results: expectedBuiltInCratesIoScenarios.map((name) => result(name, { installedArtifact: expectedArtifact })),
  }, installedPlugin);
  assert.equal(verdict.installedArtifact, expectedArtifact);
});

test('rejects a candidate that did not reach the local OIDC guard after native packaging', () => {
  assert.throws(
    () => verifyCandidateResults({
      results: expectedBuiltInCratesIoScenarios.map((name) => result(name, { localIdentityRequests: 0 })),
    }),
    /local identity guard/,
  );
});

test('rejects evidence that records an external crate upload', () => {
  assert.throws(
    () => verifyCandidateResults({
      results: expectedBuiltInCratesIoScenarios.map((name) => result(name, { publicUploads: 1 })),
    }),
    /public uploads/,
  );
});

test('rejects a candidate whose local identity guard allowed a release to succeed', () => {
  assert.throws(
    () => verifyCandidateResults({
      results: expectedBuiltInCratesIoScenarios.map((name) => result(name, { releaseExit: 0 })),
    }),
    /local identity guard must reject the release/,
  );
});

test('rejects a candidate that invoked cargo publish after its local identity guard', () => {
  assert.throws(
    () => verifyCandidateResults({
      results: expectedBuiltInCratesIoScenarios.map((name) => result(name, { cargoPublishCalls: 1 })),
    }),
    /must prevent cargo publish/,
  );
});

test('candidate workflow stays manual and cannot receive publication credentials', async () => {
  const workflow = await readFile(join(root, '.github/workflows/candidate-product-cargo.yml'), 'utf8');
  const parsed = parse(workflow);

  assert.ok(parsed.on.workflow_dispatch);
  assert.equal(parsed.permissions.contents, 'read');
  assert.equal(parsed.permissions['id-token'], undefined);
  assert.equal(parsed.on.workflow_dispatch.inputs.product_ref.required, true);
  assert.equal(parsed.on.workflow_dispatch.inputs.product_ref.default, undefined);
  assert.match(workflow, /^\s*workflow_dispatch:/m);
  assert.match(workflow, /CARGO_SCENARIO_FILTER:\s*['"]?\^ordinary-default-crates-io-/);
  assert.match(workflow, /npm install --ignore-scripts --no-save --package-lock=false --no-audit --no-fund/);
  assert.match(workflow, /pnpm --dir candidate-product install --frozen-lockfile --ignore-scripts/);
  assert.match(workflow, /pnpm --dir candidate-product pack --ignore-scripts --pack-destination/);
  assert.match(workflow, /PRODUCT_REF:\s*\$\{\{ inputs\.product_ref \}\}/);
  assert.match(workflow, /--product-ref "\$PRODUCT_REF"/);
  assert.doesNotMatch(workflow, /--product-ref "\$\{\{ inputs\.product_ref \}\}"/);
  assert.match(workflow, /reviewed candidate install, build, and package code/);
  assert.match(workflow, /no publication credentials, OIDC permission, or write token/);
  assert.match(workflow, /does not sandbox an untrusted ref/);
  const install = workflow.indexOf('pnpm --dir candidate-product install --frozen-lockfile --ignore-scripts');
  const build = workflow.indexOf('pnpm --dir candidate-product build');
  const pack = workflow.indexOf('pnpm --dir candidate-product pack --ignore-scripts --pack-destination');
  assert.ok(install >= 0 && install < build && build < pack, 'candidate build must run after the safe install and before packing');
  assert.doesNotMatch(workflow, /id-token:\s*write/);
  assert.doesNotMatch(workflow, /contents:\s*write/);
  assert.doesNotMatch(workflow, /live-release\.yml/);
});

test('lifecycle supports isolated candidate evidence and disposable state paths', async () => {
  const lifecycle = await readFile(join(root, 'scripts/lifecycle.mjs'), 'utf8');

  assert.match(lifecycle, /process\.env\.CARGO_EVIDENCE_DIR/);
  assert.match(lifecycle, /process\.env\.CARGO_SCRATCH_DIR/);
});

test('candidate workflow derives the lifecycle artifact from the installed package', async () => {
  const [workflow, lifecycle] = await Promise.all([
    readFile(join(root, '.github/workflows/candidate-product-cargo.yml'), 'utf8'),
    readFile(join(root, 'scripts/lifecycle.mjs'), 'utf8'),
  ]);

  assert.match(workflow, /CARGO_CANDIDATE_PRODUCT:\s*['"]true['"]/);
  assert.match(lifecycle, /process\.env\.CARGO_CANDIDATE_PRODUCT/);
  assert.match(lifecycle, /node_modules\/semantic-release-workspace\/package\.json/);
});

test('candidate artifacts are not commit candidates', async () => {
  const ignored = await readFile(join(root, '.gitignore'), 'utf8');

  assert.match(ignored, /^evidence\/candidate-product\/$/m);
});
