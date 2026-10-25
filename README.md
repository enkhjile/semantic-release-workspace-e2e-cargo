# semantic-release-workspace Cargo consumer acceptance

Independent consumer of the exact npm artifact `semantic-release-workspace@1.0.0-alpha.2` with `semantic-release@25.0.9`, Rust/Cargo 1.99.1, and native Cargo consumers.

The documented plugin-name setup fails with `ERR_PACKAGE_PATH_NOT_EXPORTED` before hooks run. `scripts/acceptance.mjs` records this as a failure in two independent fixtures. The diagnostic lane resolves the installed public ESM export with `import.meta.resolve`; all such results are labelled `PUBLIC_ESM_RESOLUTION_WORKAROUND` and do not clear the documented setup failure.

Run `npm ci --ignore-scripts`, `npm test`, `PUBLIC_ESM_RESOLUTION_WORKAROUND=1 npm test`, and `node scripts/lifecycle.mjs`. Controlled lifecycle tests use disposable bare Git remotes and loopback sparse registries with synthetic credentials. They invoke the actual semantic-release CLI and actual Cargo packaging, then build fresh downstream binaries from downloaded registry crates. Runtime compatibility fixtures are isolated from each other.

`evidence/` contains machine-readable results and CLI logs. The explicit Actions workflow preserves the normal setup failure while collecting diagnostics. `bootstrap/` contains reviewed minimal crates at 0.1.0; no public upload occurs through the controlled test workflow. The separately dispatched live workflow requires the `cargo-live` environment and per-crate trusted publishers.

Public-write budget: two dedicated crates × one bootstrap plus one OIDC release = at most four crate-version uploads. The names are `enkhjile-srw-e2e-core` and `enkhjile-srw-e2e-adapter`. Publish bootstrap core before adapter; the adapter's registry requirement is `0.1.0`.

The `alpha` live profile additionally carries `EXPLICIT_CARGO_METADATA_WORKAROUND`: per-crate version/edition/license/repository fields and an ordinary adapter path+version dependency. Canonical controlled inherited-manifest fixtures and their two FAIL results remain on `main`. This profile isolates live OIDC from that known packaging defect and does not clear either alpha.2 failure.
