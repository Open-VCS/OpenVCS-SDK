# @openvcs/sdk

[![Nightly](https://github.com/Open-VCS/OpenVCS-SDK/actions/workflows/nightly.yml/badge.svg?branch=Dev)](https://github.com/Open-VCS/OpenVCS-SDK/actions/workflows/nightly.yml)
[![Dev](https://github.com/Open-VCS/OpenVCS-SDK/actions/workflows/ci.yml/badge.svg?branch=Dev)](https://github.com/Open-VCS/OpenVCS-SDK/actions/workflows/ci.yml)
[![Stable](https://github.com/Open-VCS/OpenVCS-SDK/actions/workflows/release.yml/badge.svg?branch=Stable)](https://github.com/Open-VCS/OpenVCS-SDK/actions/workflows/release.yml)

OpenVCS SDK for npm-based plugin development.

Install this package in plugin projects, scaffold a starter plugin, and package
plugins into `.ovcsp` bundles. The SDK also exports a Node-only JSON-RPC runtime
layer and shared protocol/types so plugins do not have to hand-roll stdio
framing or method dispatch.

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

Generated module plugins now export a declarative `PluginDefinition` plus an
`OnPluginStart()` hook that the SDK-owned bootstrap calls for them:

```ts
import type { PluginModuleDefinition } from '@openvcs/sdk/runtime';

export const PluginDefinition: PluginModuleDefinition = {
  plugin: {
    async 'plugin.init'(_params, context) {
      context.host.info('OpenVCS plugin started');
      return null;
    },
  },
};

export function OnPluginStart(): void {}
```

Runtime and protocol imports are exposed as npm subpaths:

```ts
import { pluginError } from '@openvcs/sdk/runtime';
import type { PluginDelegates, VcsDelegates } from '@openvcs/sdk/types';
```

The runtime handles stdio framing, JSON-RPC request dispatch, host notifications,
default `plugin.*` handlers, exact-method delegate registration for `vcs.*`, and
the generated `bin/<module.exec>` bootstrap created by `openvcs build`.

Interactive theme plugin scaffold:

```bash
openvcs init --theme my-theme
```

## Build plugin assets

In a generated code plugin folder:

```bash
npm run build
```

This runs `openvcs build`, which executes `scripts["build:plugin"]`, expects your
compiled plugin author module at `bin/plugin.js`, and then generates the SDK-owned
`bin/<module.exec>` bootstrap that imports `./plugin.js`, applies `PluginDefinition`,
invokes `OnPluginStart()`, and starts the runtime.

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

For code plugins, reserve `bin/plugin.js` for the compiled author module and point
`module.exec` at a different bootstrap filename such as `openvcs-plugin.js`.

`.ovcsp` is a gzip-compressed tar archive (`tar.gz`) that contains a top-level
`<plugin-id>/` directory with `openvcs.plugin.json` and plugin runtime assets.

Bundle contents:
- `openvcs.plugin.json` (required)
- `icon.*` (optional, first found by extension priority)
- `bin/` (required for code plugins with `module.exec`)
- `entry` directory (required for UI plugins with top-level `entry` field; the entire directory containing the entry file is bundled)
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
