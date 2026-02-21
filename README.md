# OpenVCS-SDK
[![Nightly](https://github.com/Open-VCS/OpenVCS-SDK/actions/workflows/nightly.yml/badge.svg?branch=Dev)](https://github.com/Open-VCS/OpenVCS-SDK/actions/workflows/nightly.yml)
[![Dev](https://github.com/Open-VCS/OpenVCS-SDK/actions/workflows/ci.yml/badge.svg?branch=Dev)](https://github.com/Open-VCS/OpenVCS-SDK/actions/workflows/ci.yml)
[![Stable](https://github.com/Open-VCS/OpenVCS-SDK/actions/workflows/release.yml/badge.svg?branch=Stable)](https://github.com/Open-VCS/OpenVCS-SDK/actions/workflows/release.yml)

Tooling for building and packaging OpenVCS plugins.

## Install

Install from crates.io:

```bash
cargo install openvcs-sdk
```

## `cargo openvcs dist`

Bundle a plugin into a single `.ovcsp` tar.xz:

```bash
cargo openvcs dist --plugin-dir /path/to/plugin --out /path/to/dist
```

Plugins must be Rust libraries with `src/lib.rs` using the `#[openvcs_plugin]` macro and
`export_plugin!` macro to define the plugin ABI.

Plugin manifests must use `module.exec` (WASM) and/or `themes/`.

The SDK also supports rebuilding component metadata for modules with stale
`component-type:*:encoded world` sections by preserving wit-bindgen
`imports and exports` metadata and retrying encoding against OpenVCS worlds.

## Development
- Required: `cargo fmt --all`
- CI enforces: `cargo fmt --all -- --check`
- CI also runs: `cargo clippy --all-targets -- -D warnings`
- Convenience (if you have `just` installed): `just fix`

## License

Copyright © 2025-2026 OpenVCS Contributors. SPDX-License-Identifier: GPL-3.0-or-later
