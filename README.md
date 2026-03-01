# @openvcs/sdk

[![Nightly](https://github.com/Open-VCS/OpenVCS-SDK/actions/workflows/nightly.yml/badge.svg?branch=Dev)](https://github.com/Open-VCS/OpenVCS-SDK/actions/workflows/nightly.yml)
[![Dev](https://github.com/Open-VCS/OpenVCS-SDK/actions/workflows/ci.yml/badge.svg?branch=Dev)](https://github.com/Open-VCS/OpenVCS-SDK/actions/workflows/ci.yml)
[![Stable](https://github.com/Open-VCS/OpenVCS-SDK/actions/workflows/release.yml/badge.svg?branch=Stable)](https://github.com/Open-VCS/OpenVCS-SDK/actions/workflows/release.yml)

OpenVCS SDK for npm-based plugin development.

Install this package in plugin projects, scaffold a starter plugin, and package
plugins into `.ovcsp` bundles with `npm run build`.

## Install

```bash
npm install --save-dev @openvcs/sdk
```

## Scaffold a plugin

Interactive module plugin scaffold:

```bash
npx @openvcs/sdk init my-plugin
```

Interactive theme plugin scaffold:

```bash
npx @openvcs/sdk init --theme my-theme
```

## Build a `.ovcsp` bundle

In a generated plugin folder:

```bash
npm run build
```

This produces `dist/<plugin-id>.ovcsp`.

Dependency behavior while packaging:

- npm dependency bundling is enabled by default when `package.json` exists.
- If `package-lock.json` is missing, SDK generates it in the plugin worktree.
- Dependencies are installed into the bundle staging dir with:
  - `npm ci --omit=dev --ignore-scripts --no-bin-links --no-audit --no-fund`
- Disable npm dependency processing with `--no-npm-deps`.
- Native Node addons (`*.node`) are rejected for portable bundles.

## Native implementation

The native implementation (Rust crate and binaries) lives in `native/`.

See `native/README.md` for Rust-focused development and crates.io publishing.

## License

Copyright © 2025-2026 OpenVCS Contributors. SPDX-License-Identifier: GPL-3.0-or-later
