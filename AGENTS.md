# Repository Guidelines

## Project structure & module responsibilities
- `src/bin/cargo-openvcs.rs` produces the `cargo-openvcs` subcommand used as `cargo openvcs ...`.
- Packaging logic lives in `src/dist/` (CLI args, manifest parsing, bundle assembly) with shared file helpers in `src/build/`; `src/lib.rs` exports helpers consumed by the CLI and tests.
- Build outputs go under `dist/` (generated archives) and `target/` (Cargo artifacts).

## Architecture reference
- Read `ARCHITECTURE.md` before changing structural or workflow components; the SDK is focused on plugin packaging, not runtime execution.
- Bundles follow the `.ovcsp` format (tar.xz with `openvcs.plugin.json` + `bin/` entries). Keep manifest fields consistent with host expectations documented in `Client/docs/plugin architecture.md`.

## Build, test, and tooling commands
- `cargo build` (compile SDK binaries/library).
- `cargo test` (unit tests in `src/tests/` and supporting helpers).
- `cargo fmt --all`; keep formatting clean.
- `cargo clippy --all-targets -- -D warnings`; CI enforces linting.
- `just fix` runs `cargo fmt` + `cargo clippy --fix` for quick cleanup.
- `cargo openvcs dist --plugin-dir /path/to/plugin --out /path/to/dist` to produce a `.ovcsp` bundle for manual verification.
- Install path for users is crates.io: `cargo install openvcs-sdk`.

## Coding style & conventions
- Follow default Rust formatting (`rustfmt`/`cargo fmt`). Use 4-space indentation in Rust sources, `snake_case` for functions/modules, `PascalCase` for types, `SCREAMING_SNAKE_CASE` for constants.
- API surfaces should return rich error messages explaining path, capability, or validation issues.

## Documentation & licensing

- When you change behavior, workflows, CLI flags, bundle layout, or manifest expectations, ALWAYS update the relevant documentation in the same change, even if the user does not explicitly ask.
- All new Rust source files must include a license header:
  ```rust
  // Copyright © 2025-2026 OpenVCS Contributors
  // SPDX-License-Identifier: GPL-3.0-or-later
  ```
- All public API items (functions, structs, enums, traits, modules) must have doc comments (`///`).
- Add module-level docs (`//!`) to new modules explaining their purpose.
- Run `cargo doc --no-deps` to verify documentation builds without warnings.

## Testing guidelines
- Keep tests next to the logic they cover (e.g., `src/tests/`). Name tests descriptively (e.g., `bundles_plugin_manifest`).
- Before PRs, run the formatter/linter/test trio from above.

## Commit & PR guidelines
- Use short, imperative commit messages (<=72 chars) such as `sdk: validate manifest fields`.
- PRs should explain the new workflow, list commands/tests run, and surface any user-visible bundle changes (new capabilities, layout updates, etc.).
- Update this AGENTS whenever SDK workflows or packaging expectations change so the guidance stays fresh.
