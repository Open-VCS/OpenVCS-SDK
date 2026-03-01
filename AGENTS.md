# Repository Guidelines

## Project structure & module responsibilities
- npm package entry is at repo root (`package.json`, `bin/`, `lib/`, `test/`).
- `bin/openvcs.js` is the executable entrypoint installed by npm.
- `lib/cli.js` routes subcommands.
- `lib/dist.js` implements plugin packaging (`openvcs dist`).
- `lib/init.js` implements interactive plugin scaffolding (`openvcs init`).
- `lib/fs-utils.js` contains file-copy and path safety helpers.
- Build outputs go under plugin `dist/` folders.

## Architecture reference
- SDK is focused on plugin packaging, not runtime execution.
- Bundles follow the `.ovcsp` format as gzip-compressed tar (`tar.gz`) containing `openvcs.plugin.json` plus plugin assets (`bin/`, `themes/`, optional `node_modules/`).
- Keep manifest fields and bundle structure consistent with host expectations.

## Build, test, and tooling commands
- `npm install` (install SDK dependencies).
- `npm test` (run Node tests via `node --test`).
- `openvcs dist --plugin-dir /path/to/plugin --out /path/to/dist` to produce `.ovcsp` bundles.
- `openvcs init [--theme] [dir]` to scaffold plugin projects.
- Install path for users is npm: `npm install --save-dev @openvcs/sdk`.

## Coding style & conventions
- Use CommonJS (`require`/`module.exports`) and Node 18+ APIs.
- Prefer small, focused modules in `lib/` and keep files under 1000 lines.
- Use clear error messages that include the relevant path/flag/context.
- Keep path validation strict for security-sensitive code paths.
- API surfaces should return rich error messages explaining path, capability, or validation issues.

## Documentation & licensing

- When you change behavior, workflows, CLI flags, bundle layout, or manifest expectations, ALWAYS update the relevant documentation in the same change, even if the user does not explicitly ask.
- All code files MUST be no more than 1000 lines; split files before they exceed this limit.

## Testing guidelines
- Keep Node tests in `test/` near the feature area they validate.
- Name tests descriptively and cover bundle safety checks (symlinks, path traversal, native addons).
- Before PRs, run `npm test`.

## Commit & PR guidelines
- Use short, imperative commit messages (<=72 chars) such as `sdk: validate manifest fields`.
- PRs should explain the new workflow, list commands/tests run, and surface any user-visible bundle changes (new capabilities, layout updates, etc.).
- Update this AGENTS whenever SDK workflows or packaging expectations change so the guidance stays fresh.
