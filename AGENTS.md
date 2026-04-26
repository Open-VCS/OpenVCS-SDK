# Repository Guidelines

## Project structure & module responsibilities
- SDK source is authored in `src/` and compiled to runtime files in `bin/` and `lib/`.
- npm package entry is at repo root (`package.json`, `src/`, `bin/`, `lib/`, `test/`).
- `src/bin/openvcs.ts` compiles to the executable entrypoint installed by npm (`bin/openvcs.js`).
- `src/lib/cli.ts` routes subcommands.
- `src/lib/build.ts` implements plugin asset builds (`openvcs build`).
- `src/lib/init.ts` implements interactive plugin scaffolding (`openvcs init`).
- `src/lib/fs-utils.ts` contains file-copy and path safety helpers.
- `src/lib/runtime/` contains the shared Node plugin runtime, JSON-RPC transport, and delegate dispatcher.
- `src/lib/types/` contains shared protocol, plugin, host, and VCS contract types.
- Build outputs go into plugin runtime files such as `bin/` and generated SDK `lib/` outputs.

## Architecture reference
- SDK owns plugin runtime asset builds plus Node plugin authoring helpers.
- Plugins are ordinary npm packages that ship `package.json` with an `openvcs` object, runtime files under `bin/`, optional `themes/`, and runtime dependencies from `dependencies`.
- The canonical host contract still lives in `Client/Backend/src/plugin_runtime/protocol.rs`; SDK runtime/types mirror that contract for plugin authors.
- Keep manifest fields and bundle structure consistent with host expectations.

## Build, test, and tooling commands
- `npm install` (install SDK dependencies).
- `npm run build` (compile TypeScript sources to `bin/` and `lib/`).
- `npm test` (compile then run Node tests via `node --test`).
- `npm run openvcs -- <args>` (run the local CLI with a prebuild step).
- `openvcs build --plugin-dir /path/to/plugin` to build plugin runtime assets.
- `openvcs init [--theme] [dir]` to scaffold plugin projects.
- Install path for users is npm: `npm install --save-dev @openvcs/sdk`.
- CI release channels publish npm prereleases on `Beta` (`beta`), `Dev` push commits (`edge`), and scheduled `Dev` nightlies (`nightly`).

## Coding style & conventions
- Author code in TypeScript (`src/**/*.ts`) targeting Node 18+.
- Compiled outputs in `bin/` and `lib/` are generated artifacts; do not edit them manually.
- Prefer small, focused modules in `src/lib/` and keep files under 1000 lines.
- Use clear error messages that include the relevant path/flag/context.
- Keep path validation strict for security-sensitive code paths.
- API surfaces should return rich error messages explaining path, capability, or validation issues.
- Code plugins should expose a `build:plugin` npm script so SDK build can invoke compilation explicitly.

## Documentation & licensing

- When you change behavior, workflows, CLI flags, npm packaging expectations, or manifest expectations, ALWAYS update the relevant documentation in the same change, even if the user does not explicitly ask.
- All code files MUST be no more than 1000 lines; split files before they exceed this limit.

## Testing guidelines
- Keep Node tests in `test/` near the feature area they validate.
- Name tests descriptively and cover bundle safety checks (symlinks, path traversal, native addons).
- Before PRs, run `npm test`.

## Commit & PR guidelines
- Use short, imperative commit messages (<=72 chars) such as `sdk: validate manifest fields`.
- PRs should explain the new workflow, list commands/tests run, and surface any user-visible bundle changes (new capabilities, layout updates, etc.).
- Update this AGENTS whenever SDK workflows or packaging expectations change so the guidance stays fresh.
