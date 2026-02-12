# SDK Architecture

This document describes the OpenVCS SDK tooling in `SDK/`.

See umbrella context in `../ARCHITECTURE.md`.

## Bird's Eye View

`SDK/` provides packaging tooling to build OpenVCS plugin bundles (`.ovcsp`).

It is a build/distribution utility crate, not a runtime plugin host.

## Code Map

- `src/main.rs`: `openvcs-plugin` CLI entry.
- `src/bin/cargo-openvcs.rs`: Cargo subcommand entry (`cargo openvcs ...`).
- `src/lib.rs`: library exports.
- `src/dist.rs`: bundle assembly and output logic.

## Public Interfaces

User-facing binaries:
- `openvcs-plugin`
- `cargo-openvcs`

Primary concern:
- convert a plugin directory into a distributable `.ovcsp` artifact.

## Boundaries

- Runtime plugin execution is owned by `Client/Backend`, not SDK.
- Shared host/plugin contract types are owned by `Core/`, not SDK.
- VCS backend behavior is owned by plugin projects (for example `Git/`), not SDK.

## Architecture Invariants

- SDK should remain focused on packaging workflows.
- Output artifacts must match structure expected by host bundle installer.
- Manifest `entry` fields are rejected; plugins must package WASM components and/or `themes/`.

## Cross-Cutting Concerns

- Reproducibility:
  Packaging behavior should be deterministic for the same input plugin directory.
- Compatibility:
  Bundle format expectations must stay aligned with host installer validation logic.
