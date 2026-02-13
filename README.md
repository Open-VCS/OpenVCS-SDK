# OpenVCS-SDK
[![Nightly](https://github.com/Open-VCS/OpenVCS-SDK/actions/workflows/nightly.yml/badge.svg?branch=Dev)](https://github.com/Open-VCS/OpenVCS-SDK/actions/workflows/nightly.yml)
[![Dev](https://github.com/Open-VCS/OpenVCS-SDK/actions/workflows/ci.yml/badge.svg?branch=Dev)](https://github.com/Open-VCS/OpenVCS-SDK/actions/workflows/ci.yml)
[![Stable](https://github.com/Open-VCS/OpenVCS-SDK/actions/workflows/release.yml/badge.svg?branch=Stable)](https://github.com/Open-VCS/OpenVCS-SDK/actions/workflows/release.yml)

Tooling for building and packaging OpenVCS plugins.

## `openvcs-plugin`
- Bundle a plugin into a single `.ovcsp` tar.xz: `cargo run -p openvcs-sdk -- --plugin-dir /path/to/plugin`
- Plugin manifests must use `module.exec` (WASM) and/or `themes/`.

## Development
- Required: `cargo fmt --all`
- CI enforces: `cargo fmt --all -- --check`
- CI also runs: `cargo clippy --all-targets -- -D warnings`
- Convenience (if you have `just` installed): `just fix`
