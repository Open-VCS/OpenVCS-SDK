# OpenVCS-SDK
[![Nightly](https://github.com/Open-VCS/OpenVCS-SDK/actions/workflows/nightly.yml/badge.svg?branch=Dev)](https://github.com/Open-VCS/OpenVCS-SDK/actions/workflows/nightly.yml)
[![Dev](https://github.com/Open-VCS/OpenVCS-SDK/actions/workflows/ci.yml/badge.svg?branch=Dev)](https://github.com/Open-VCS/OpenVCS-SDK/actions/workflows/ci.yml)
[![Stable](https://github.com/Open-VCS/OpenVCS-SDK/actions/workflows/release.yml/badge.svg?branch=Stable)](https://github.com/Open-VCS/OpenVCS-SDK/actions/workflows/release.yml)

Tooling for building and packaging OpenVCS plugins.

## `openvcs-plugin`
- Bundle a plugin into a single `.ovcsp` tar.xz: `cargo run -- --plugin-dir /path/to/plugin --out /path/to/dist`
- Plugins must be Rust libraries with `src/lib.rs` using the `#[openvcs_plugin]` macro and `export_plugin!` macro to define the plugin ABI.
- Plugin manifests must use `module.exec` (WASM) and/or `themes/`.

## `cargo openvcs dist`

The SDK also ships a Cargo subcommand wrapper:

```bash
cargo openvcs dist --plugin-dir /path/to/plugin --out /path/to/dist
```

## Development
- Required: `cargo fmt --all`
- CI enforces: `cargo fmt --all -- --check`
- CI also runs: `cargo clippy --all-targets -- -D warnings`
- Convenience (if you have `just` installed): `just fix`

## License

Copyright © 2025-2026 OpenVCS Contributors. SPDX-License-Identifier: GPL-3.0-or-later
