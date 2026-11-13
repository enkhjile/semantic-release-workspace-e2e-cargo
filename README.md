# Cargo shared-version acceptance

This repository tests the reviewed `semantic-release-workspace` candidate at `442b7b3ce5d576c0a6bec92a12031bfe1fd24c77` through native Cargo packaging and the ordinary semantic-release plugin loader. The candidate is rebuilt from that exact commit and checked against `candidate-binding.json` before each immutable dependency install.

The only workflows are read-only pull-request checks (`acceptance.yml`) and push-triggered `alpha` acceptance (`live-release.yml`). The latter retains the `cargo-live` environment and existing crates.io trusted-publisher identities. Its committed intent currently permits preview only: no uploads or identity exchanges.

The public workspace members are `enkhjile-srw-e2e-core` and `enkhjile-srw-e2e-adapter`. Two private ancestor crates exercise nested packaging and are never published. Workspace source versions and the inherited local dependency start at `0.0.0`; semantic-release supplies one shared release version for both public members.

The planned live sequence has four phases: initial shared release, a core-only feature, an adapter-only fix, and a core feature followed by a deliberately interrupted post-publication hook. The final phase reruns the same GitHub run from a fresh checkout and must finish without another upload or identity exchange. Eight new crate versions are planned within the approved limit of twelve. Each publication requires an exact dry-run plan matching the committed intent.

All fourteen earlier public test versions were yanked; crate names, immutable bytes, and trusted-publishing configuration remain. `shared-retired-public-ledger.json` preserves their original checksums and state. `shared-public-baseline.json` records the verified post-cleanup registry state used by this campaign. Historical test tags, notes, payload refs, and obsolete branches were archived in a verified local recovery bundle before removal; `main` was not changed. The fresh `1.0.0-alpha.1` package version has never been published for either member.

Local checks are `npm test`, `cargo +1.99.1 test --workspace --locked`, and the four `scripts/*.test.mjs` guard suites invoked by the workflow. The native harness retains all twenty-one scenarios. Historical logs, bootstrap packages, and obsolete runners were removed from the active tree after archiving in the verified recovery bundle. Current job evidence is uploaded from the ignored `evidence/shared-version/` directory.
