# OpenVCS-SDK

Tooling for building and packaging OpenVCS plugins.

## `openvcs-plugin`
- Bundle a plugin into a single `.ovcsp` tar.xz: `cargo run -p openvcs-sdk -- --plugin-dir /path/to/plugin`

## Development
- Required: `cargo fmt --all`
- CI enforces: `cargo fmt --all -- --check`
