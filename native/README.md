# OpenVCS SDK Native (Rust)

Native implementation of the OpenVCS SDK packaging CLI.

This crate builds the `openvcs-sdk` and `cargo-openvcs` binaries used to package
OpenVCS plugins into `.ovcsp` artifacts.

## Build

```bash
cargo build --manifest-path native/Cargo.toml
```

## Test

```bash
cargo test --manifest-path native/Cargo.toml
```

## Format and lint

```bash
cargo fmt --manifest-path native/Cargo.toml --all
cargo clippy --manifest-path native/Cargo.toml --all-targets -- -D warnings
```

## Cargo subcommand usage

```bash
cargo openvcs dist --plugin-dir /path/to/plugin --out /path/to/dist
```

## Standalone binary usage

```bash
openvcs-sdk dist --plugin-dir /path/to/plugin --out /path/to/dist
```

```bash
openvcs-sdk init my-plugin
```
