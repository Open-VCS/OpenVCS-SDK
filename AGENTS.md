# Repository Guidelines

## Project Structure & Module Organization

- `src/lib.rs`: Rust library crate (`openvcs-sdk`), currently exporting `openvcs_sdk::dist`.
- `src/dist.rs`: Core packaging/bundling logic (reads `openvcs.plugin.json`, builds WASI binaries, writes `.ovcsp` tar.xz bundles).
- `src/main.rs`: `openvcs-plugin` binary entrypoint (plugin bundler CLI).
- `src/bin/cargo-openvcs.rs`: `cargo-openvcs` binary (`cargo openvcs dist ...`) convenience wrapper.
- `dist/`: local output directory for bundles and staging (gitignored).
- `target/`: Cargo build output (gitignored).
- `.github/workflows/`: CI, nightly, release, and CodeQL workflows.

## Build, Test, and Development Commands

- Build (debug): `cargo build`
- Build (release): `cargo build --release`
- Check (CI-like): `cargo check --all-targets`
- Run bundler CLI: `cargo run --bin openvcs-plugin -- --plugin-dir /path/to/plugin --out dist`
- Run cargo subcommand wrapper: `cargo run --bin cargo-openvcs -- dist --help`
- Format: `cargo fmt`
- Lint (recommended): `cargo clippy --all-targets -- -D warnings`

## Before Committing

- Required: `cargo fmt`

## Coding Style & Naming Conventions

- Rust edition: 2024 (see `Cargo.toml`).
- Formatting: use `rustfmt` (`cargo fmt`) before pushing.
- Naming: follow Rust conventions (modules `snake_case`, types `PascalCase`, functions/vars `snake_case`).
- Prefer clear error messages (most functions return `Result<_, String>` in `src/dist.rs`).

## Testing Guidelines

- Run tests with `cargo test` (CI runs this on `Dev`).
- Add unit tests in the defining module (e.g., `src/dist.rs` with `#[test]`), and use `tests/` for integration tests if needed.

## Commit & Pull Request Guidelines

- Commits in this repo typically use short, imperative subjects (e.g., “Update …”, “Fix …”); keep messages concise and scoped.
- Open PRs against the `Dev` branch; keep `Stable` for releases.
- PRs should include: a brief description of behavior changes, how you tested (`cargo test`, bundling command used), and any linked issue(s).

## Packaging Notes (WASI)

- Plugins are built for WASI targets (`wasm32-wasip1` first, with a fallback to `wasm32-wasi`).
- If local builds fail due to missing targets, install via `rustup target add wasm32-wasip1` (and/or `wasm32-wasi`).
