# Live bootstrap content

Two dedicated crates at 0.1.0. Publish core before adapter using the native crates.io API token only after account setup. The dependency is a valid published 0.1.0 requirement with a local path for the native preflight. Configure per-crate GitHub trusted publishing only after bootstrap. The single plugin-owned alpha release should publish 0.2.0-alpha.1 versions from the root consumer graph, then leave bootstrap state fixed. Maximum budget: two bootstrap and two OIDC uploads.
