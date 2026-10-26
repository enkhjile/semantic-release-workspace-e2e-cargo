import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(import.meta.dirname, '..');

export const expectedBuiltInCratesIoScenarios = Object.freeze([
  'ordinary-default-crates-io-1',
  'ordinary-default-crates-io-2',
  'ordinary-default-crates-io-positive',
]);

const candidateCredential = /^(?:NPM_TOKEN|NODE_AUTH_TOKEN|CARGO_REGISTRY_TOKEN|CARGO_REGISTRIES_.+_TOKEN|CRATES_IO_ID_TOKEN|ACTIONS_ID_TOKEN_REQUEST_(?:URL|TOKEN))$/;

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

function required(options, name) {
  const value = options[name];
  assert.ok(value, `missing --${name}`);
  return value;
}

function options(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    assert.match(name, /^--[a-z-]+$/, `unexpected argument ${name}`);
    assert.equal(parsed[name.slice(2)], undefined, `duplicate argument ${name}`);
    assert.ok(argv[index + 1], `missing value for ${name}`);
    parsed[name.slice(2)] = argv[index + 1];
  }
  return parsed;
}

export function candidateCredentialNames(env = process.env) {
  return Object.keys(env).filter((name) => candidateCredential.test(name)).sort();
}

export function verifyCandidateResults(report) {
  assert.ok(Array.isArray(report?.results), 'candidate lifecycle must write a results array');

  const selected = expectedBuiltInCratesIoScenarios.map((name) => {
    const matches = report.results.filter((result) => result.name === name);
    assert.equal(matches.length, 1, `${name} must appear exactly once in candidate evidence`);
    const result = matches[0];
    assert.equal(result.status, 'PASS', `${name} must pass`);
    assert.equal(result.nativeMissingNamedIndex, false, `${name} must package without a named crates-io registry`);
    assert.ok(Number.isInteger(result.localIdentityRequests) && result.localIdentityRequests > 0, `${name} must reach the local identity guard after native packaging`);
    assert.ok(Number.isInteger(result.releaseExit) && result.releaseExit !== 0, `${name} local identity guard must reject the release`);
    assert.equal(result.cargoPublishCalls, 0, `${name} local identity guard must prevent cargo publish`);
    assert.equal(result.publicUploads, 0, `${name} must record zero public uploads`);
    return result;
  });

  return {
    scenarios: selected.map((result) => result.name),
    localIdentityRequests: selected.reduce((total, result) => total + result.localIdentityRequests, 0),
    publicUploads: selected.reduce((total, result) => total + result.publicUploads, 0),
  };
}

function assertNoPublicationCredentials() {
  const names = candidateCredentialNames();
  assert.deepEqual(names, [], `candidate lane cannot receive publication credentials: ${names.join(', ')}`);
  return names;
}

async function unchangedLock(lockBefore) {
  const [before, current] = await Promise.all([readFile(lockBefore), readFile(resolve(root, 'package-lock.json'))]);
  assert.deepEqual(current, before, 'candidate installation must leave package-lock.json byte-identical');
  return sha256(current);
}

async function record(optionsForCommand) {
  const productRef = required(optionsForCommand, 'product-ref');
  assert.doesNotMatch(productRef, /[\r\n]/, 'product ref must be one line');
  const product = resolve(root, required(optionsForCommand, 'product-dir'));
  const tarball = resolve(root, required(optionsForCommand, 'tarball'));
  const lockBefore = resolve(root, required(optionsForCommand, 'lock-before'));
  const output = resolve(root, required(optionsForCommand, 'out'));
  const credentialNames = assertNoPublicationCredentials();
  const lockSha256 = await unchangedLock(lockBefore);
  const [tarballBytes, tarballStats, productPackageBytes, installedPackageBytes, productDist, installedDist] = await Promise.all([
    readFile(tarball),
    stat(tarball),
    readFile(resolve(product, 'package.json')),
    readFile(resolve(root, 'node_modules/semantic-release-workspace/package.json')),
    readFile(resolve(product, 'dist/index.mjs')),
    readFile(resolve(root, 'node_modules/semantic-release-workspace/dist/index.mjs')),
  ]);
  const locked = JSON.parse(await readFile(resolve(root, 'package-lock.json'), 'utf8')).packages['node_modules/semantic-release-workspace'];
  const productPackage = JSON.parse(productPackageBytes);
  const installedPackage = JSON.parse(installedPackageBytes);

  assert.equal(locked.version, '1.0.0-alpha.4', 'candidate workflow must replace the locked alpha.4 plugin only in node_modules');
  assert.equal(productPackage.name, 'semantic-release-workspace');
  assert.equal(installedPackage.name, productPackage.name);
  assert.equal(installedPackage.version, productPackage.version, 'installed candidate metadata must come from the packed product');
  assert.deepEqual(installedDist, productDist, 'installed candidate dist must match the packed product checkout');
  assert.equal(git(product, 'status', '--porcelain'), '', 'candidate product checkout must be clean before packing');

  const evidence = {
    status: 'READY',
    productRef,
    productSourceSha: git(product, 'rev-parse', 'HEAD'),
    productVersion: productPackage.version,
    tarball: {
      basename: tarball.split('/').at(-1),
      bytes: tarballStats.size,
      sha256: sha256(tarballBytes),
    },
    lockedPlugin: {
      version: locked.version,
      integrity: locked.integrity,
      packageLockSha256: lockSha256,
    },
    installedPlugin: {
      version: installedPackage.version,
      distIndexSha256: sha256(installedDist),
      matchesProductDist: true,
    },
    publicationCredentialNames: credentialNames,
  };
  await mkdir(resolve(output, '..'), { recursive: true });
  await writeFile(output, JSON.stringify(evidence, null, 2) + '\n');
  console.log(JSON.stringify(evidence));
}

async function verify(optionsForCommand) {
  const resultsPath = resolve(root, required(optionsForCommand, 'results'));
  const metadataPath = resolve(root, required(optionsForCommand, 'metadata'));
  const lockBefore = resolve(root, required(optionsForCommand, 'lock-before'));
  const output = resolve(root, required(optionsForCommand, 'out'));
  const credentialNames = assertNoPublicationCredentials();
  const lockSha256 = await unchangedLock(lockBefore);
  const [results, metadataBytes] = await Promise.all([
    readFile(resultsPath, 'utf8').then(JSON.parse),
    readFile(metadataPath),
  ]);
  const metadata = JSON.parse(metadataBytes);
  assert.equal(metadata.status, 'READY');
  assert.match(metadata.productSourceSha, /^[0-9a-f]{40}$/);
  assert.match(metadata.tarball?.sha256, /^[0-9a-f]{64}$/);
  assert.equal(metadata.lockedPlugin?.version, '1.0.0-alpha.4');
  assert.equal(metadata.lockedPlugin?.packageLockSha256, lockSha256);
  assert.equal(git(root, 'status', '--porcelain', '--', 'package.json', 'package-lock.json'), '', 'candidate lane must not modify committed manifests or lockfiles');

  const verdict = {
    status: 'PASS',
    ...verifyCandidateResults(results),
    product: {
      ref: metadata.productRef,
      sourceSha: metadata.productSourceSha,
      version: metadata.productVersion,
      tarballSha256: metadata.tarball.sha256,
      tarballBytes: metadata.tarball.bytes,
      installedDistSha256: metadata.installedPlugin.distIndexSha256,
    },
    lockedPlugin: metadata.lockedPlugin,
    publicationCredentialNames: credentialNames,
  };
  await mkdir(resolve(output, '..'), { recursive: true });
  await writeFile(output, JSON.stringify(verdict, null, 2) + '\n');
  console.log(JSON.stringify(verdict));
}

async function main() {
  const [command, ...argv] = process.argv.slice(2);
  const parsed = options(argv);
  if (command === 'record') return record(parsed);
  if (command === 'verify') return verify(parsed);
  throw new Error('usage: candidate-product.mjs <record|verify> --name value ...');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.stack ?? error);
    process.exitCode = 1;
  });
}
