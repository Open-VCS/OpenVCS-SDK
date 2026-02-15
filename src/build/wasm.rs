// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

//! WASM validation and component encoding.
//!
//! Provides utilities for validating WASM binaries and encoding them
//! as WebAssembly components with WASI adapters.

use std::fs;
use std::io::Read;
use std::path::Path;
use wasi_preview1_component_adapter_provider::WASI_SNAPSHOT_PREVIEW1_REACTOR_ADAPTER;
use wasmparser::{Encoding, Parser, Payload};
use wit_component::ComponentEncoder;

/// Checks if a WASM binary is a component module.
///
/// # Arguments
///
/// * `bytes` - Raw WASM binary content
///
/// # Returns
///
/// Returns `Ok(true)` if it's a component, `Ok(false)` if it's a core module,
/// or `Err(String)` if the encoding cannot be determined.
pub(crate) fn is_component_module(bytes: &[u8]) -> Result<bool, String> {
    for payload in Parser::new(0).parse_all(bytes) {
        let payload = payload.map_err(|e| format!("parse wasm: {e}"))?;
        if let Payload::Version { encoding, .. } = payload {
            return Ok(matches!(encoding, Encoding::Component));
        }
    }
    Err("unable to detect wasm encoding".to_string())
}

/// Ensures a WASM file is a component module, encoding it if necessary.
///
/// If the input is already a component, this is a no-op.
/// Otherwise, it wraps the core module in a component with the
/// WASI preview1 adapter.
///
/// # Arguments
///
/// * `path` - Path to the WASM file (modified in place)
///
/// # Returns
///
/// Returns `Ok(())` on success, or `Err(String)` on failure.
///
/// # Errors
///
/// Returns an error if:
/// - The file cannot be read
/// - The content cannot be parsed as WASM
/// - Component encoding fails
pub(crate) fn ensure_component_module(path: &Path) -> Result<(), String> {
    let module = fs::read(path).map_err(|e| format!("read {}: {e}", path.display()))?;
    if is_component_module(&module)? {
        return Ok(());
    }

    let component = ComponentEncoder::default()
        .module(&module)
        .map_err(|e| format!("componentize module {}: {e}", path.display()))?
        .adapter(
            "wasi_snapshot_preview1",
            WASI_SNAPSHOT_PREVIEW1_REACTOR_ADAPTER,
        )
        .map_err(|e| format!("set preview1 adapter {}: {e}", path.display()))?
        .validate(true)
        .encode()
        .map_err(|e| format!("encode component {}: {e}", path.display()))?;

    fs::write(path, component).map_err(|e| format!("write {}: {e}", path.display()))
}

/// Validates that a file is a valid WASM module by checking its magic number.
///
/// WASM modules must start with the magic bytes `\0asm`.
pub(crate) fn ensure_wasm_magic(path: &Path) -> Result<(), String> {
    let mut f = fs::File::open(path).map_err(|e| format!("open {}: {e}", path.display()))?;
    let mut magic = [0u8; 4];
    let n = f
        .read(&mut magic)
        .map_err(|e| format!("read {}: {e}", path.display()))?;
    if n < magic.len() || magic != [0x00, 0x61, 0x73, 0x6d] {
        return Err(format!(
            "built exec is not a wasm module (WASM-only plugins): {}",
            path.display()
        ));
    }
    Ok(())
}
#[cfg(test)]
use std::path::PathBuf;

/// Returns the expected exec filename for a given input (no-op transformation).
///
/// Used in tests to simulate expected output paths.
#[cfg(test)]
pub(crate) fn platform_exec_filename(exec: &str) -> String {
    let exec = exec.trim();
    if exec.is_empty() {
        return String::new();
    }
    exec.to_string()
}

/// Constructs the expected path to a built WASM binary.
///
/// Constructs a path like: `{target_dir}/{target}/release/{bin}.wasm`
#[cfg(test)]
pub(crate) fn built_wasm_bin_path(target_dir: &Path, target: &str, bin: &str) -> PathBuf {
    let mut p = target_dir.to_path_buf();
    p.push(target);
    p.push("release");
    p.push(format!("{bin}.wasm"));
    p
}
