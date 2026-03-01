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

Plugins are Node.js runtime modules (typically authored in TypeScript) and/or
theme packs.

Plugin manifests must use `module.exec` (`.js`, `.mjs`, or `.cjs`) and/or
`themes/`.

When `module.exec` is set, the entry file must exist at
`bin/<module.exec>` before running `cargo openvcs dist`.

## Development
- Required: `cargo fmt --all`
- CI enforces: `cargo fmt --all -- --check`
- CI also runs: `cargo clippy --all-targets -- -D warnings`
- Convenience (if you have `just` installed): `just fix`

## License

Copyright © 2025-2026 OpenVCS Contributors. SPDX-License-Identifier: GPL-3.0-or-later
