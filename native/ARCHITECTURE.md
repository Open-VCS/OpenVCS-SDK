# SDK Architecture

This document describes the OpenVCS SDK native tooling in `native/`.

## Bird's Eye View

`native/` provides packaging tooling to build OpenVCS plugin bundles (`.ovcsp`).

It is a build/distribution utility crate, not a runtime plugin host.

## Code Map

- `src/bin/cargo-openvcs.rs`: Cargo subcommand entry (`cargo openvcs ...`).
- `src/bin/openvcs-sdk.rs`: standalone CLI entry used by npm wrapper and direct execution.
- `src/lib.rs`: library exports.
- `src/dist/mod.rs`: bundle assembly entrypoint plus dist-oriented modules (`args`, `manifest`, `fsops`, `bundle`).
- `src/build/mod.rs`: shared file/build helpers (`util`).

## Public Interfaces

User-facing binary:
- `cargo-openvcs` (installed via `cargo install openvcs-sdk`, invoked as `cargo openvcs ...`)

Primary concern:
- convert a plugin directory into a distributable `.ovcsp` artifact.

## Boundaries

- Runtime plugin execution is owned by `Client/Backend`, not SDK.
- Shared host/plugin contract types are owned by `Core/`, not SDK.
- VCS backend behavior is owned by plugin projects (for example `Git/`), not SDK.

## Architecture Invariants

- SDK should remain focused on packaging workflows.
- Output artifacts must match structure expected by host bundle installer.
- Plugins are packaged as `.ovcsp` bundles containing `openvcs.plugin.json`, optional `themes/`, optional `bin/` runtime files, and optional preinstalled npm dependencies under `node_modules/`.
- npm dependency bundling is enabled by default for plugins that include `package.json`; `--no-npm-deps` disables lockfile/dependency processing.
- SDK enforces no-symlink bundle contents and rejects native Node addons (`*.node`) for portable output.

## Cross-Cutting Concerns

- Reproducibility:
  Packaging behavior should be deterministic for the same input plugin directory.
- Compatibility:
  Bundle format expectations must stay aligned with host installer validation logic.
