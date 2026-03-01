# @openvcs/sdk

[![Nightly](https://github.com/Open-VCS/OpenVCS-SDK/actions/workflows/nightly.yml/badge.svg?branch=Dev)](https://github.com/Open-VCS/OpenVCS-SDK/actions/workflows/nightly.yml)
[![Dev](https://github.com/Open-VCS/OpenVCS-SDK/actions/workflows/ci.yml/badge.svg?branch=Dev)](https://github.com/Open-VCS/OpenVCS-SDK/actions/workflows/ci.yml)
[![Stable](https://github.com/Open-VCS/OpenVCS-SDK/actions/workflows/release.yml/badge.svg?branch=Stable)](https://github.com/Open-VCS/OpenVCS-SDK/actions/workflows/release.yml)

OpenVCS SDK for npm-based plugin development.

Install this package in plugin projects, scaffold a starter plugin, and package
plugins into `.ovcsp` bundles.

## Install

```bash
npm install --save-dev @openvcs/sdk
```

This package installs a local CLI command named `openvcs`.

One-off usage without adding to a project:

```bash
npx --package @openvcs/sdk openvcs --help
```

## Scaffold a plugin

Interactive module plugin scaffold:

```bash
openvcs init my-plugin
```

The generated module template includes TypeScript and Node typings (`@types/node`).

Interactive theme plugin scaffold:

```bash
openvcs init --theme my-theme
```

## Build a `.ovcsp` bundle

In a generated plugin folder:

```bash
npm run build
```

This produces `dist/<plugin-id>.ovcsp`.

`.ovcsp` is a gzip-compressed tar archive (`tar.gz`) that contains a top-level
`<plugin-id>/` directory with `openvcs.plugin.json` and plugin runtime assets.

Dependency behavior while packaging:

- npm dependency bundling is enabled by default when `package.json` exists.
- If `package-lock.json` is missing, SDK generates it in the plugin worktree.
- Dependencies are installed into the bundle staging dir with:
  - `npm ci --omit=dev --ignore-scripts --no-bin-links --no-audit --no-fund`
- Disable npm dependency processing with `--no-npm-deps`.
- Native Node addons (`*.node`) are rejected for portable bundles.

## CLI usage

Package a plugin manually:

```bash
openvcs dist --plugin-dir /path/to/plugin --out /path/to/dist
```

Show command help:

```bash
openvcs --help
openvcs dist --help
openvcs init --help
```

## Releases

Stable releases are published from `.github/workflows/release.yml`.

- npm publishes use npm Trusted Publishing (OIDC), so no `NPM_TOKEN` is required.

## License

Copyright © 2025-2026 OpenVCS Contributors. SPDX-License-Identifier: GPL-3.0-or-later
