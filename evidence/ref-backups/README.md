# Retained Cargo Git evidence

This read-only export closes the local Git-history retention gap without rerunning release tests or changing the source remotes. `index.json` lists every retained fixture, all of its exact refs, bundle SHA-256/size, and checksums/source refs for the exported prepared files and Git notes. All 300 bundles are retained locally in ignored `bundles/`; readable prepared/note payloads are retained locally in ignored `exports/`. Only indexes, checksums, the exporter and retrieval instructions are published. The complete payload is also retained in local branch `evidence-retention-local` at `601f355`; that branch was not pushed.

The 300 remotes include historical harness attempts. Backup PASS means export/restore integrity only; it does not add release-scenario PASS results. Use `evidence/acceptance-ledger.json` for the alpha.2 verdict. Match a CLI log's `.scratch/<fixture>/remote.git` URL to the index fixture name.

Coverage: 300/300 retained local remotes; 1,424 ref occurrences including 330 tag refs, 444 notes refs, and 340 `refs/semantic-release-workspace/*` refs; 724 prepared manifest/lockfile/changelog exports and 480 notes exports. All 300 bundles passed `git bundle verify`, exact ref comparison, a fresh `git clone --mirror`, and `git fsck --full --no-reflogs`. Original remote refs were compared before/after and remained identical. `verification.json` records an independent checksum pass over every bundle/export after export.

Inspect `summary.json` for counts and unavailable histories. Discovery/dry-run fixtures correctly have no prepared refs or publication notes. The 108 local fixtures with prepared commits have readable prepared-file exports; 107 have readable notes exports. Notes retain the original plan/journal JSON bytes. The bundle is authoritative for other source files, note history, retained artifact bytes, and refs.

Public indexes do not contain the raw Git bundles or note/prepared-file contents. Retrieval requires this existing local workspace, or an authorized copy of the ignored payload directories alongside the published index. The local payload checksums are already independently verified.

## Retrieve one fixture

Choose a fixture entry from `index.json`, then use its `bundle.path`:

```sh
git clone --mirror evidence/ref-backups/bundles/<fixture>.bundle /tmp/cargo-recovered.git
git --git-dir=/tmp/cargo-recovered.git for-each-ref --format='%(objectname) %(refname)'
git --git-dir=/tmp/cargo-recovered.git show 'refs/tags/cargo/fixture-adapter@1.1.0:crates/adapter/Cargo.toml'
```

For other prepared versions, use a package tag or an indexed `refs/semantic-release-workspace/prepared/<source-sha>` ref and the original repository-relative manifest path. The `preparedExports` entries provide exact commit IDs, source paths, and referring tags/refs. `noteExports` entries provide the exact notes namespace, target object, and note blob ID:

```sh
git --git-dir=/tmp/cargo-recovered.git notes --ref='<notesRef>' show '<target>'
git --git-dir=/tmp/cargo-recovered.git cat-file blob '<noteBlob>'
```

The note content is exported byte-for-byte, including plans, progress, and artifact references. Recover a retained artifact using its indexed custom ref or its journal's reference, then inspect the tree with `git ls-tree -r <ref>` and export the named blob with `git show <ref>:<path>`. If the index records a ref as type `blob` (including deliberately corrupt artifact fixtures), retrieve it directly with `git cat-file blob <ref>` rather than `ls-tree`. Exact refs/OIDs and all their reachable objects are present in the bundle; no manually preloaded release state is needed for inspection.

## Limits

The two completed GitHub Actions runners were removed before this remediation. Their exact disposable Git histories cannot be recovered retroactively. The original hosted crate bytes, checksums, CLI logs, prepared-manifest strings, and run metadata remain under `evidence/hosted-initial` and `evidence/hosted-final`; analogous local histories are not represented as the exact hosted histories.

Fault fixtures are captured in their retained final state. Deliberately removed/swapped/corrupt pre-fault artifact refs are not reconstructed or claimed available. Those fixtures have an explicit limitation in the index. Unreferenced dangling objects and reflogs are outside `git bundle --all` coverage. No local retained remote was unavailable.
