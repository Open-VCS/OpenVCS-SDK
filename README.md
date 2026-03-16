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

## SDK development

This repository is authored in TypeScript under `src/` and compiles runtime files
to `bin/` and `lib/`.

Build the SDK:

```bash
npm run build
```

Run tests (builds first):

```bash
npm test
```

Run the local CLI through npm scripts:

```bash
npm run openvcs -- --help
npm run openvcs -- build --help
npm run openvcs -- init --help
npm run openvcs -- dist --help
```

## Scaffold a plugin

Interactive module plugin scaffold:

```bash
openvcs init my-plugin
```

The generated module template includes TypeScript and Node typings (`@types/node`).
Plugin IDs entered during scaffold must not be `.`/`..` and must not contain path
separators (`/` or `\\`).

Interactive theme plugin scaffold:

```bash
openvcs init --theme my-theme
```

## Build plugin assets

In a generated code plugin folder:

```bash
npm run build
```

This runs `openvcs build`, which executes `scripts["build:plugin"]` and verifies
that `bin/<module.exec>` now exists.

Theme-only plugins can also run `npm run build`; the command exits successfully
without producing `bin/` output.

## Build a `.ovcsp` bundle

In a generated plugin folder:

```bash
npm run dist
```

This produces `dist/<plugin-id>.ovcsp`.

`openvcs dist` runs `openvcs build` first unless `--no-build` is provided.
Use `--no-build` when packaging prebuilt plugin assets.

Generated code plugin scripts use this split by default:

```json
{
  "scripts": {
    "build:plugin": "tsc -p tsconfig.json",
    "build": "openvcs build",
    "dist": "openvcs dist --plugin-dir . --out dist"
  }
}
```

`.ovcsp` is a gzip-compressed tar archive (`tar.gz`) that contains a top-level
`<plugin-id>/` directory with `openvcs.plugin.json` and plugin runtime assets.

Bundle contents:
- `openvcs.plugin.json` (required)
- `icon.*` (optional, first found by extension priority)
- `bin/` (required for code plugins with `module.exec`)
- `entry` file (required for UI plugins with top-level `entry` field)
- `themes/` (required for theme plugins)
- `node_modules/` (if npm dependencies are bundled)

Dependency behavior while packaging:

- npm dependency bundling is enabled by default when `package.json` exists.
- If `package-lock.json` is missing, SDK generates it in the staging area (not the plugin worktree).
- Dependencies are installed into the bundle staging dir with:
  - `npm ci --omit=dev --ignore-scripts --no-bin-links --no-audit --no-fund`
- Disable npm dependency processing with `--no-npm-deps`.
- Native Node addons (`*.node`) are rejected for portable bundles.

## CLI usage

Package a plugin manually:

```bash
npx openvcs build --plugin-dir /path/to/plugin
npx openvcs dist --plugin-dir /path/to/plugin --out /path/to/dist
```

Show command help:

```bash
npx openvcs --help
npx openvcs build --help
npx openvcs dist --help
npx openvcs init --help
```

## Releases

Stable releases are published from `.github/workflows/release.yml`.

- npm publishes use npm Trusted Publishing (OIDC), so no `NPM_TOKEN` is required.
- `npm prepack` compiles TypeScript so published packages include `bin/` and `lib/` JS outputs.

## License

Copyright © 2025-2026 OpenVCS Contributors. SPDX-License-Identifier: GPL-3.0-or-later
