# Repository Guidelines

## Project Structure & Module Organization
- Core Rust sources live in `src/`.
- CLI entrypoints:
  - `src/main.rs` builds the `openvcs-plugin` binary.
  - `src/bin/cargo-openvcs.rs` builds the `cargo-openvcs` subcommand.
- Packaging logic and most tests are in `src/dist.rs`; `src/lib.rs` exports SDK modules.
- Build outputs are written to `dist/` (bundles) and `target/` (Cargo artifacts).

## Architecture Reference
- Read `ARCHITECTURE.md` before making structural or workflow changes.
- Keep implementation aligned with its stated boundaries (SDK focuses on packaging, not runtime hosting).
- If a PR changes packaging flow, bundle format expectations, or module responsibilities, update `ARCHITECTURE.md` in the same PR.

## Build, Test, and Development Commands
- `cargo build` - compile the SDK binaries and library.
- `cargo test` - run unit tests (including `src/dist.rs` tests).
- `cargo fmt --all` - format code.
- `cargo clippy --all-targets -- -D warnings` - lint and fail on warnings (CI parity).
- `just fix` - run `cargo fmt` and `cargo clippy --fix` for local cleanup.
- `cargo run -p openvcs-sdk -- --plugin-dir /path/to/plugin` - bundle a plugin into `.ovcsp`.

## Coding Style & Naming Conventions
- Follow default Rust style (`rustfmt`); use 4-space indentation.
- Keep modules focused; place CLI parsing/orchestration in bin files and reusable logic in `src/dist.rs` or library modules.
- Use `snake_case` for functions/files, `PascalCase` for types, and `SCREAMING_SNAKE_CASE` for constants.
- Prefer explicit error messages with context (path/action) for CLI-facing failures.

# ExecPlans

When writing complex features or significant refactors, use an ExecPlan (as described in .agent/PLANS.md) from design to implementation.

## Testing Guidelines
- Use Rust’s built-in test framework (`#[test]` with `cargo test`).
- Keep tests near related logic (existing pattern in `src/dist.rs`).
- Name tests descriptively, e.g. `bundles_plugin_manifest`.
- Before opening a PR, run: `cargo fmt --all -- --check`, `cargo clippy --all-targets -- -D warnings`, and `cargo test`.

## Commit & Pull Request Guidelines
- Current history favors short, imperative commit subjects (e.g., `Fix CI`, `Add build status badges to README`).
- Keep subject lines concise (about 50 chars when possible) and focused on one change.
- PRs should include:
  - a clear summary of behavior changes,
  - linked issue(s) when applicable,
  - test/lint evidence (commands run),
  - CLI output snippets when user-facing behavior changes.
