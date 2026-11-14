import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {resolve} from 'node:path';

export function verifyCandidateBinding() {
  const binding = JSON.parse(readFileSync('candidate-binding.json'));
  assert.match(binding.sha, /^[a-f0-9]{40}$/);
  assert.equal(binding.name, 'semantic-release-workspace');
  assert.equal(binding.node, process.version);
  const bytes = readFileSync('vendor/shared-version-candidate.tgz');
  assert.equal(createHash('sha256').update(bytes).digest('hex'), binding.tarballSha256);
  assert.equal('sha512-' + createHash('sha512').update(bytes).digest('base64'), binding.tarballIntegrity);
  const entry = import.meta.resolve('semantic-release-workspace');
  assert.ok(entry.endsWith('/dist/index.mjs'), 'The ordinary package export must resolve to the candidate');
  assert.ok(Object.keys(binding.files).length >= 5);
  assert.ok(binding.files['dist/index.mjs'] && binding.files['package.json']);
  for (const [path, sha256] of Object.entries(binding.files)) {
    assert.ok(!path.startsWith('/') && !path.split('/').includes('..'));
    assert.equal(createHash('sha256').update(readFileSync(new URL('../' + path, entry))).digest('hex'), sha256, path + ' differs from pinned candidate');
  }
  const metadata = JSON.parse(readFileSync(new URL('../package.json', entry)));
  assert.equal(metadata.name, binding.name);
  return {...binding, resolvedEntry: fileURLToPath(entry)};
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) console.log(JSON.stringify(verifyCandidateBinding()));
