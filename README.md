# OpenVCS-SDK

Tooling for building and packaging OpenVCS plugins.

## `openvcs-plugin`
- Bundle a plugin into a single `.ovcsp` zip (defaults inferred from `openvcs.plugin.json`): `cargo run -p openvcs-sdk -- --plugin-dir /path/to/plugin`
- Build + bundle a plugin directory (legacy): `cargo run -p openvcs-sdk -- package --plugin-dir /path/to/plugin --plugin-id openvcs.git --bin openvcs-git-plugin`
- Bundle a multi-target `.ovcsp` (requires toolchains): `cargo run -p openvcs-sdk -- bundle --plugin-dir /path/to/plugin --target x86_64-pc-windows-msvc --target x86_64-unknown-linux-gnu --target aarch64-apple-darwin`
