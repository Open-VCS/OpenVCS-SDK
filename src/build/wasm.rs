// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

//! WASM validation and component encoding.
//!
//! Provides utilities for validating WASM binaries and encoding them
//! as WebAssembly components with WASI adapters.

use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use wasi_preview1_component_adapter_provider::WASI_SNAPSHOT_PREVIEW1_REACTOR_ADAPTER;
use wasmparser::{Encoding, Parser, Payload};
use wit_component::{ComponentEncoder, StringEncoding};

const DEFAULT_WORLD_NAME: &str = "plugin";
const DEFAULT_WORLD_WIT_DIR: &str = "../Core/wit";

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

    let component = match encode_component_module(&module, path) {
        Ok(component) => component,
        Err(original_error) => {
            let sanitized = strip_component_type_custom_sections(&module)
                .map_err(|sanitize_error| {
                    format!(
                        "encode component {}: {original_error}; failed to sanitize embedded component metadata sections: {sanitize_error}",
                        path.display()
                    )
                })?;

            let with_metadata = embed_default_world_metadata(&sanitized).map_err(|embed_error| {
                format!(
                    "encode component {}: {original_error}; fallback metadata embedding failed: {embed_error}",
                    path.display()
                )
            })?;

            encode_component_module(&with_metadata, path).map_err(|retry_error| {
                format!(
                    "encode component {} after metadata embedding failed: {retry_error}; original error: {original_error}",
                    path.display()
                )
            })?
        }
    };

    fs::write(path, component).map_err(|e| format!("write {}: {e}", path.display()))
}

/// Encodes a core WASM module into a component with the WASI preview1 adapter.
///
/// # Arguments
///
/// * `module` - Raw core WASM module bytes
/// * `path` - Source path used for diagnostics
///
/// # Returns
///
/// Returns the encoded component bytes when successful.
fn encode_component_module(module: &[u8], path: &Path) -> Result<Vec<u8>, String> {
    ComponentEncoder::default()
        .module(module)
        .map_err(|e| format!("componentize module {}: {e}", path.display()))?
        .adapter(
            "wasi_snapshot_preview1",
            WASI_SNAPSHOT_PREVIEW1_REACTOR_ADAPTER,
        )
        .map_err(|e| format!("set preview1 adapter {}: {e}", path.display()))?
        .validate(true)
        .encode()
        .map_err(|e| format!("encode component {}: {e}", path.display()))
}

/// Embeds default OpenVCS world metadata into a core WASM module.
///
/// This is used as a compatibility fallback when wit-component cannot decode
/// already embedded world metadata from a module produced by a plugin build.
///
/// # Arguments
///
/// * `module` - Raw core WASM module bytes
///
/// # Returns
///
/// Returns a new module buffer with embedded component metadata.
fn embed_default_world_metadata(module: &[u8]) -> Result<Vec<u8>, String> {
    let wit_dir = default_world_wit_dir();
    let mut resolve = wit_parser::Resolve::default();
    let (package_id, _) = resolve
        .push_path(&wit_dir)
        .map_err(|e| format!("parse WIT package {}: {e}", wit_dir.display()))?;
    let package_ids = [package_id];
    let world_id = resolve
        .select_world(&package_ids, Some(DEFAULT_WORLD_NAME))
        .map_err(|e| {
            format!(
                "resolve world '{DEFAULT_WORLD_NAME}' from {}: {e}",
                wit_dir.display()
            )
        })?;

    let mut with_metadata = module.to_vec();
    wit_component::embed_component_metadata(
        &mut with_metadata,
        &resolve,
        world_id,
        StringEncoding::UTF8,
    )
    .map_err(|e| format!("embed world metadata {}: {e}", wit_dir.display()))?;
    Ok(with_metadata)
}

/// Strips `component-type*` custom sections from a core WASM module.
///
/// Some modules can contain incompatible or stale embedded component metadata
/// custom sections. Removing these sections allows the SDK to embed fresh
/// metadata for the canonical OpenVCS world.
///
/// # Arguments
///
/// * `module` - Raw core WASM module bytes
///
/// # Returns
///
/// Returns a rebuilt module with all `component-type*` custom sections removed.
fn strip_component_type_custom_sections(module: &[u8]) -> Result<Vec<u8>, String> {
    let mut rebuilt = wasm_encoder::Module::new();

    for payload in Parser::new(0).parse_all(module) {
        let payload = payload.map_err(|e| format!("parse wasm for metadata stripping: {e}"))?;

        if let Payload::CustomSection(section) = &payload {
            if section.name().starts_with("component-type") {
                continue;
            }
        }

        if let Some((id, range)) = payload.as_section() {
            rebuilt.section(&wasm_encoder::RawSection {
                id,
                data: &module[range],
            });
        }
    }

    Ok(rebuilt.finish())
}

/// Returns the absolute path to the default OpenVCS WIT directory.
///
/// The SDK crate is expected to live at `/SDK` in the monorepo with
/// world definitions located in `/Core/wit`.
fn default_world_wit_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(DEFAULT_WORLD_WIT_DIR)
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
