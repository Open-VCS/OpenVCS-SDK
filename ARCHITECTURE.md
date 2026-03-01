# SDK Architecture

This document describes the OpenVCS SDK tooling in `SDK/`.

See umbrella context in `../ARCHITECTURE.md`.

## Bird's Eye View

`SDK/` provides packaging tooling to build OpenVCS plugin bundles (`.ovcsp`).

It is a build/distribution utility crate, not a runtime plugin host.

## Code Map

- `src/bin/cargo-openvcs.rs`: Cargo subcommand entry (`cargo openvcs ...`).
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
- Plugins are packaged as `.ovcsp` bundles containing `openvcs.plugin.json`, optional `themes/`, and optional Node runtime entry files (`.js/.mjs/.cjs`) under `bin/`.

## Cross-Cutting Concerns

- Reproducibility:
  Packaging behavior should be deterministic for the same input plugin directory.
- Compatibility:
  Bundle format expectations must stay aligned with host installer validation logic.
