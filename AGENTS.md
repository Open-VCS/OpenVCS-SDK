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
- CI runs `cargo clippy --all-targets -- -D warnings` after rustfmt.

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
- Commit message format: agents must format commit messages with a short
  title of at most 72 characters, followed by a blank line and any
  additional explanatory text in the body.
- Open PRs against the `Dev` branch; keep `Stable` for releases.
- PRs should include: a brief description of behavior changes, how you tested (`cargo test`, bundling command used), and any linked issue(s).

- Agents / automation: allowed to create or amend local commits and branches (for example, `git commit`, `git commit --amend`, and creating topic branches), but MUST NOT push commits to the remote or open pull requests.
- When an agent prepares changes, it should run the project's fixer command `just fix` (agents MUST NOT run `cargo fmt` or `cargo clippy` manually), create a descriptive commit, and then notify a human reviewer who will push the branch and open the PR.
- CI or other trusted automation that has been explicitly approved in project policy may be exempted; otherwise treat pushing as a human action.

**Sandbox note**: Running `just fix` and some `cargo` commands (for example `cargo build`, `cargo test`, or commands that fetch dependencies or add toolchain targets) may require network access or host-level tooling and therefore should be run outside a restricted sandbox or container. If operating with sandboxing or restricted network access, request approval before executing these commands or run them on the host machine.

## Packaging Notes (WASI)

- Plugins are built for WASI targets (`wasm32-wasip1` first, with a fallback to `wasm32-wasi`).
- If local builds fail due to missing targets, install via `rustup target add wasm32-wasip1` (and/or `wasm32-wasi`).
