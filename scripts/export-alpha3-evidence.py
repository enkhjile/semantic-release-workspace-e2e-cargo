#!/usr/bin/env python3
"""Read-only export of retained acceptance remotes; never run release commands."""
import hashlib
import json
import re
import shutil
import subprocess
import tempfile
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUTPUT = ROOT / 'evidence/alpha3/ref-backups'
BUNDLES = OUTPUT / 'bundles'
OUTPUT.mkdir(parents=True, exist_ok=True)
BUNDLES.mkdir(exist_ok=True)


def git(remote, *args, check=True):
    result = subprocess.run(['git', '--git-dir', str(remote), *args],
                            stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if check and result.returncode:
        raise RuntimeError(result.stderr.decode(errors='replace'))
    return result


def refs(remote):
    raw = git(remote, 'for-each-ref', '--format=%(objectname) %(objecttype) %(refname)').stdout
    return [{'oid': oid, 'type': kind, 'name': name}
            for oid, kind, name in (line.split(' ', 2) for line in raw.decode().splitlines())]


def sha(data):
    return hashlib.sha256(data).hexdigest()


def write_export(path, data, **extra):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    return {'path': str(path.relative_to(ROOT)), 'sha256': sha(data),
            'bytes': len(data), **extra}


records = []
for remote in sorted((ROOT / '.scratch/alpha3').glob('*/remote.git')):
    name = remote.parent.name
    before = refs(remote)
    record = {'fixture': name, 'fixtureLabel': re.sub(r'-[^-]{6}$', '', name),
              'sourceRemote': str(remote.relative_to(ROOT)), 'refs': before,
              'refCounts': dict(Counter('notes' if x['name'].startswith('refs/notes/') else
                                       'workspace' if x['name'].startswith('refs/semantic-release-workspace/') else
                                       'tags' if x['name'].startswith('refs/tags/') else 'other' for x in before)),
              'preparedExports': [], 'noteExports': []}
    if not before:
        record.update(status='UNAVAILABLE', reason='Retained remote has no refs; no bundle can be created.')
        records.append(record)
        continue
    try:
        bundle = BUNDLES / f'{name}.bundle'
        git(remote, 'bundle', 'create', str(bundle), '--all')
        git(remote, 'bundle', 'verify', str(bundle))
        heads = git(remote, 'bundle', 'list-heads', str(bundle)).stdout.decode().splitlines()
        bundled = {line.split(' ', 1)[1]: line.split(' ', 1)[0] for line in heads
                   if line.split(' ', 1)[1].startswith('refs/')}
        assert bundled == {x['name']: x['oid'] for x in before}, 'Bundle omitted or changed a ref'
        verify_root = Path(tempfile.mkdtemp(prefix='verify-', dir=BUNDLES))
        try:
            recovered = verify_root / 'recovered.git'
            subprocess.run(['git', 'clone', '--mirror', '--quiet', str(bundle), str(recovered)],
                           check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            assert refs(recovered) == before, 'Restored bundle refs differ'
            # Traverse every reachable commit/tree/blob, including custom artifact refs.
            git(recovered, 'fsck', '--full', '--no-reflogs')
        finally:
            shutil.rmtree(verify_root)
        commits = {}
        for ref in before:
            if ref['name'].startswith(('refs/tags/cargo/', 'refs/semantic-release-workspace/prepared/')):
                peeled = git(remote, 'rev-parse', ref['name'] + '^{commit}', check=False)
                if peeled.returncode == 0:
                    commits.setdefault(peeled.stdout.decode().strip(), []).append(ref['name'])
        for commit, names in sorted(commits.items()):
            paths = git(remote, 'ls-tree', '-r', '--name-only', commit).stdout.decode().splitlines()
            for path in paths:
                if Path(path).name not in {'Cargo.toml', 'Cargo.lock', 'package.json', 'CHANGELOG.md', 'rust-toolchain.toml'}:
                    continue
                data = git(remote, 'show', f'{commit}:{path}').stdout
                record['preparedExports'].append(write_export(
                    OUTPUT / 'exports' / name / 'prepared' / commit / path, data,
                    commit=commit, sourcePath=path, refs=names))
        for ref in before:
            if not ref['name'].startswith('refs/notes/'):
                continue
            namespace = sha(ref['name'].encode())[:16]
            lines = git(remote, 'notes', '--ref=' + ref['name'], 'list').stdout.decode().splitlines()
            for line in lines:
                note, target = line.split(' ', 1)
                data = git(remote, 'cat-file', 'blob', note).stdout
                try:
                    json.loads(data)
                    suffix = '.json'
                except (ValueError, UnicodeDecodeError):
                    suffix = '.txt'
                record['noteExports'].append(write_export(
                    OUTPUT / 'exports' / name / 'notes' / namespace / (target + suffix), data,
                    notesRef=ref['name'], target=target, noteBlob=note))
        assert refs(remote) == before, 'Source remote refs changed during export'
        record.update(status='PASS', bundle={'path': str(bundle.relative_to(ROOT)),
                      'sha256': sha(bundle.read_bytes()), 'bytes': bundle.stat().st_size,
                      'allRefsMatched': True, 'mirrorRestoreVerified': True,
                      'restoredFsckPassed': True, 'sourceRefsUnchanged': True})
        if any(marker in name for marker in ('missing-artifact-', 'swapped-artifact-', 'corrupt-artifact-')):
            record['limitation'] = ('Post-fault remote captured exactly. Deliberately deleted/swapped/corrupt '
                                    'pre-fault artifact refs are not reconstructed by this backup.')
    except Exception as error:
        record.update(status='UNAVAILABLE', reason=str(error))
    records.append(record)
    if len(records) % 25 == 0:
        print('Exported', len(records), 'of retained remotes', flush=True)

summary = {
    'generatedAt': datetime.now(timezone.utc).isoformat(),
    'operation': 'ALPHA3_RETAINED_REMOTE_EXPORT',
    'fixtureCount': len(records),
    'statusCounts': dict(Counter(r['status'] for r in records)),
    'bundleBytes': sum(r.get('bundle', {}).get('bytes', 0) for r in records),
    'refOccurrences': sum(len(r['refs']) for r in records),
    'tagRefOccurrences': sum(r['refCounts'].get('tags', 0) for r in records),
    'notesRefOccurrences': sum(r['refCounts'].get('notes', 0) for r in records),
    'workspaceRefOccurrences': sum(r['refCounts'].get('workspace', 0) for r in records),
    'preparedManifestExports': sum(len(r['preparedExports']) for r in records),
    'noteExports': sum(len(r['noteExports']) for r in records),
    'unavailable': [{'fixture': r['fixture'], 'reason': r['reason']} for r in records if r['status'] != 'PASS'],
    'hostedHistoryUnavailable': [],
    'limitations': [
        'Raw alpha.3 bundles and exports are retained with the run evidence.',
        'Local fixtures were exported in their retained final state, including deliberate fault damage. No pre-fault ref snapshot is invented.',
        'Export covers refs and their reachable objects, not unreferenced dangling objects or reflogs.',
    ],
}
(OUTPUT / 'index.json').write_text(json.dumps({'summary': summary, 'fixtures': records}, indent=2) + '\n')
(OUTPUT / 'summary.json').write_text(json.dumps(summary, indent=2) + '\n')
print(json.dumps(summary, indent=2), flush=True)
