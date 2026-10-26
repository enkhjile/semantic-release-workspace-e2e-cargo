"""Read-only verification of recorded native source/ref and crate-byte evidence."""
import hashlib
import json
import pathlib
import tarfile

root = pathlib.Path(__file__).resolve().parent.parent / 'evidence/alpha3'
out = {'dryRunAndNoChange': {}, 'freshCloneRecovery': {}, 'inheritedVariants': {}, 'artifactChecks': {'count': 0, 'allSha256Matched': True}}
for name in ['dry-run', 'no-change', 'oidc-required-dry-run', 'oidc-required-no-change']:
    d = json.loads((root / (name + '.json')).read_text())
    writes = [x for x in d['newRequests'] if x['method'] != 'GET']
    identities = [x for x in d['newRequests'] if '/oidc' in x['path'] or '/tokens' in x['path']]
    assert d['sourceBefore'] == d['sourceAfter'] and not writes and not identities
    assert d['uploadsBefore'] == d['uploadsAfter']
    out['dryRunAndNoChange'][name] = {'sourceAndRefsUnchanged': True, 'httpWrites': 0, 'identityOrExchangeOrRevocationRequests': 0, 'additionalUploads': 0}
for kind, prefix, packages in [('reject', 'recovery-reject', 2), ('reject-second', 'recovery-reject-second', 2), ('uncertain-full', 'uncertain-full', 1), ('uncertain-partial', 'uncertain-partial', 2)]:
    a = json.loads((root / (prefix + '-first.json')).read_text())
    b = json.loads((root / (prefix + '-retry.json')).read_text())
    def refs(d):
        return {line.split()[1]: line.split()[0] for line in d['sourceAfter']['refs'].splitlines() if 'refs/semantic-release-workspace/artifacts/' in line}
    before, after = refs(a), refs(b)
    assert all(after.get(k) == v for k, v in before.items())
    calls = [x for x in b['nativeCallsAfter'].splitlines() if x.startswith('package ')]
    assert len(calls) == packages
    assert len(b['uploadsAfter']) == len(set(b['uploadsAfter'])) == packages
    assert a['sourceBefore']['head'] == b['sourceBefore']['head']
    if kind == 'uncertain-full':
        assert b['exchangeCountBefore'] == b['exchangeCountAfter'] == 1
    out['freshCloneRecovery'][kind] = {'initialExit': a['exit'], 'retryExit': b['exit'], 'retainedArtifactRefsUnchanged': len(before), 'totalNativePackageCalls': len(calls), 'uniqueUploads': b['uploadsAfter'], 'sourceShaSame': True}
for kind in ['runtime', 'shared', 'renamed', 'optional', 'target', 'build', 'dev']:
    path = root / 'cargo-artifacts' / ('inherited-' + kind) / 'fixture-core-1.1.0.crate'
    with tarfile.open(path) as tf:
        manifest = tf.extractfile('fixture-core-1.1.0/Cargo.toml').read().decode()
    assert 'workspace = true' not in manifest and '1.1.0' in manifest and '2021' in manifest
    out['inheritedVariants'][kind] = {'normalizedCoreVersion': '1.1.0', 'noWorkspaceInheritanceInArchive': True}
for path in root.glob('cargo-artifacts/*/registry-ledger.json'):
    d = json.loads(path.read_text())
    for name, versions in d['crates'].items():
        for version, x in versions.items():
            assert hashlib.sha256((path.parent / (name + '-' + version + '.crate')).read_bytes()).hexdigest() == x['sha256']
            out['artifactChecks']['count'] += 1
(root / 'evidence-audit.json').write_text(json.dumps(out, indent=2))
print(json.dumps(out, indent=2))
