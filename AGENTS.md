# Repository Guidelines

## Project structure & module responsibilities
- `src/main.rs` builds the `openvcs-plugin`/`openvcs-sdk` CLI used to manage plugin bundles and the `.ovcsp` archive format.
- `src/bin/cargo-openvcs.rs` produces the `cargo-openvcs` subcommand that wraps the same bundling workflow.
- Packaging logic is split across `src/dist/` (CLI args, manifest parsing, bundle assembly) and `src/build/` (WASM/component build pipeline + shim generation); `src/lib.rs` exports helpers consumed by the CLI and tests.
- Build outputs go under `dist/` (generated archives) and `target/` (Cargo artifacts).

## Architecture reference
- Read `ARCHITECTURE.md` before changing structural or workflow components; the SDK is focused on plugin packaging, not runtime execution.
- Bundles follow the `.ovcsp` format (tar.xz with `openvcs.plugin.json` + `bin/` entries). Keep the manifest fields consistent with the host expectations defined in `Core/wit/openvcs-core.wit`.

## Build, test, and tooling commands
- `cargo build` (compile SDK binaries/library).
- `cargo test` (unit tests in `src/tests/` and supporting helpers).
- `cargo fmt --all`; keep formatting clean.
- `cargo clippy --all-targets -- -D warnings`; CI enforces linting.
- `just fix` runs `cargo fmt` + `cargo clippy --fix` for quick cleanup.
- `cargo run -- --plugin-dir /path/to/plugin` to produce a `.ovcsp` bundle for manual verification.

## Coding style & conventions
- Follow default Rust formatting (`rustfmt`/`cargo fmt`). Use 4-space indentation in Rust sources, `snake_case` for functions/modules, `PascalCase` for types, `SCREAMING_SNAKE_CASE` for constants.
- API surfaces should return rich error messages explaining path, capability, or validation issues.

## Testing guidelines
- Keep tests next to the logic they cover (e.g., `src/tests/`). Name tests descriptively (e.g., `bundles_plugin_manifest`).
- Before PRs, run the formatter/linter/test trio from above.

## Commit & PR guidelines
- Use short, imperative commit messages (<=72 chars) such as `sdk: validate manifest fields`.
- PRs should explain the new workflow, list commands/tests run, and surface any user-visible bundle changes (new capabilities, layout updates, etc.).
- Update this AGENTS whenever SDK workflows or packaging expectations change so the guidance stays fresh.
