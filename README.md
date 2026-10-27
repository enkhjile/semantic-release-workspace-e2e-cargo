# Cargo alpha6 consumer acceptance

This harness installs the exact public `semantic-release-workspace@1.0.0-alpha.6` through npm and the checked-in lockfile with `semantic-release@25.0.9`. Primary tools are Node24.22.1, npm12.2.1, and Rust/Cargo1.99.1. It configures the documented package name and invokes the real semantic-release CLI.

Run `npm ci --ignore-scripts --no-audit --no-fund`, `cargo test --workspace --locked`, `npm test`, and `node scripts/lifecycle.mjs`. Fixtures use disposable bare Git remotes, native Cargo metadata/test/package, loopback registries, and fresh native downstream consumers. Synthetic identity is controlled fixture evidence, not public OIDC provenance. No controlled test uploads to crates.io or npm.

The alpha6 additions exercise omitted private versionless dev edges, native normalized feature pruning and legacy aliases, retained shared runtime/versioned dev edges, stable/alpha/promotion/backmerge/next .1/.2 cycles, ordinary network clones, planning-only promotion rejection, frozen newer stable selection after generateNotes failure, and identity changelog relocation/overrides. Evidence defaults to `evidence/alpha6`; override output and scratch scopes with `CARGO_EVIDENCE_DIR` and `CARGO_SCRATCH_DIR`. `CARGO_SCENARIO_FILTER` selects lifecycle case IDs.

`acceptance.yml` is the controlled canonical workflow. It exports every disposable remote as a checksum-verified bundle, restores all refs in an independent mirror, runs fsck, and retains prepared source, notes and exact crate archives. Run `python3 scripts/export-alpha6-evidence.py` locally with the same evidence/scratch scope after testing.

Historical alpha2/3/4 refs, evidence, accepted public versions and pending batches remain preserved. The public publication budget is exhausted; do not dispatch live-release workflows. Existing public no-change observations are reported separately from controlled tests.
