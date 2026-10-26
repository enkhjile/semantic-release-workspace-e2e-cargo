# Cargo consumer acceptance

This repository consumes the exact published `semantic-release-workspace@1.0.0-alpha.3` with `semantic-release@25.0.9`, native npm12.2.1, Node24.22.1, and Rust/Cargo1.99.1. Ordinary package-name configuration is used throughout the current lane.

**Alpha.3 verdict: FAIL.** Two ordinary Cargo fixtures confirm that staging inserts a named `crates-io` dependency registry without configuring that name. The public core OIDC release succeeded; the adapter remains blocked at native packaging. See `evidence/alpha3/ordinary-default-registry-results.json` and `summary.json`.

Run `npm ci --ignore-scripts`, `npm test`, and `node scripts/lifecycle.mjs`. Native buildable Cargo fixtures use disposable bare Git remotes and loopback registries with synthetic credentials. The actual semantic-release CLI performs releases; actual Cargo packages and fresh downstream binaries verify downloaded crates. The current evidence is under `evidence/alpha3/`; historical alpha.2 failures and retained Git bundles remain unchanged.

The manual controlled Actions workflow exports disposable Git histories before runner teardown. The separate `live-release.yml` workflow requires the `cargo-live` environment and per-crate trusted publishers, uses plugin-owned OIDC, and has no native publication token.

The two reviewed public test names are `enkhjile-srw-e2e-core` and `enkhjile-srw-e2e-adapter`. Their bootstrap is0.1.0 in dependency order, followed by exactly one plugin OIDC0.2.0-alpha.1 version each. Maximum public budget: four crate-version uploads. Controlled scenarios never publish to crates.io.
