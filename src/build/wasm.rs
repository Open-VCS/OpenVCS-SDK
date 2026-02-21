// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

//! WASM validation and component encoding.
//!
//! Provides utilities for validating WASM binaries and encoding them
//! as WebAssembly components with WASI adapters.

use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
#[cfg(test)]
use std::borrow::Cow;
use wasi_preview1_component_adapter_provider::WASI_SNAPSHOT_PREVIEW1_REACTOR_ADAPTER;
use wasmparser::{Encoding, Parser, Payload};
use wit_component::{ComponentEncoder, StringEncoding};

const DEFAULT_WORLD_NAMES: [&str; 3] = ["plugin-v1-1", "plugin", "vcs"];
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
            let sanitized_encoded_world =
                strip_component_type_encoded_world_custom_sections(&module)
                    .map_err(|sanitize_error| {
                        format!(
                            "encode component {}: {original_error}; failed to sanitize embedded encoded-world metadata sections: {sanitize_error}",
                            path.display()
                        )
                    })?;

            match encode_component_module_with_fallback_worlds(&sanitized_encoded_world, path) {
                Ok(component) => component,
                Err(first_retry_error) => {
                    let sanitized_all = strip_all_component_type_custom_sections(&module)
                .map_err(|sanitize_error| {
                    format!(
                        "encode component {}: {original_error}; failed to sanitize embedded component metadata sections: {sanitize_error}",
                        path.display()
                    )
                    })?;

                    encode_component_module_with_fallback_worlds(&sanitized_all, path).map_err(
                        |retry_error| {
                        format!(
                            "encode component {} after metadata embedding failed: {retry_error}; first retry error: {first_retry_error}; original error: {original_error}",
                            path.display()
                        )
                    },
                    )?
                }
            }
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

/// Tries encoding with fallback OpenVCS worlds after embedding metadata.
///
/// This is used as a compatibility fallback when wit-component cannot decode
/// already embedded world metadata from a module produced by a plugin build.
///
/// # Arguments
///
/// * `module` - Raw core WASM module bytes
/// * `path` - Source path used for diagnostics
///
/// # Returns
///
/// Returns encoded component bytes on success.
fn encode_component_module_with_fallback_worlds(module: &[u8], path: &Path) -> Result<Vec<u8>, String> {
    let wit_dir = default_world_wit_dir();
    let mut resolve = wit_parser::Resolve::default();
    let (package_id, _) = resolve
        .push_path(&wit_dir)
        .map_err(|e| format!("parse WIT package {}: {e}", wit_dir.display()))?;
    let package_ids = [package_id];
    let mut world_errors = Vec::new();

    for world_name in DEFAULT_WORLD_NAMES {
        let world_id = match resolve.select_world(&package_ids, Some(world_name)) {
            Ok(world_id) => world_id,
            Err(error) => {
                world_errors.push(format!("select world '{world_name}': {error}"));
                continue;
            }
        };

        let mut with_metadata = module.to_vec();
        if let Err(error) = wit_component::embed_component_metadata(
            &mut with_metadata,
            &resolve,
            world_id,
            StringEncoding::UTF8,
        ) {
            world_errors.push(format!(
                "embed world '{world_name}' metadata from {}: {error}",
                wit_dir.display()
            ));
            continue;
        }

        match encode_component_module(&with_metadata, path) {
            Ok(component) => return Ok(component),
            Err(error) => {
                world_errors.push(format!("encode with world '{world_name}': {error}"));
            }
        }
    }

    Err(format!(
        "fallback world attempts from {} failed: [{}]",
        wit_dir.display(),
        world_errors.join("; ")
    ))
}

/// Strips `component-type:*:encoded world` sections from a core WASM module.
///
/// Some modules can contain incompatible or stale embedded component metadata
/// custom sections. This preserves any existing `imports and exports` metadata,
/// which `wit-component` uses to re-encode a component world.
///
/// # Arguments
///
/// * `module` - Raw core WASM module bytes
///
/// # Returns
///
/// Returns a rebuilt module with stale encoded-world metadata removed.
fn strip_component_type_encoded_world_custom_sections(module: &[u8]) -> Result<Vec<u8>, String> {
    let mut rebuilt = wasm_encoder::Module::new();

    for payload in Parser::new(0).parse_all(module) {
        let payload = payload.map_err(|e| format!("parse wasm for metadata stripping: {e}"))?;

        if let Payload::CustomSection(section) = &payload
            && section.name().starts_with("component-type")
            && section.name().ends_with(":encoded world")
        {
            continue;
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

/// Strips all `component-type*` custom sections from a core WASM module.
///
/// This is a compatibility fallback used only if encoded-world-only stripping
/// still fails to componentize the module.
fn strip_all_component_type_custom_sections(module: &[u8]) -> Result<Vec<u8>, String> {
    let mut rebuilt = wasm_encoder::Module::new();

    for payload in Parser::new(0).parse_all(module) {
        let payload = payload.map_err(|e| format!("parse wasm for metadata stripping: {e}"))?;

        if let Payload::CustomSection(section) = &payload
            && section.name().starts_with("component-type")
        {
            continue;
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

#[cfg(test)]
mod tests {
    use super::*;

    /// Collects custom section names from a core wasm module.
    fn custom_section_names(module: &[u8]) -> Result<Vec<String>, String> {
        let mut names = Vec::new();
        for payload in Parser::new(0).parse_all(module) {
            let payload = payload.map_err(|e| format!("parse module for custom names: {e}"))?;
            if let Payload::CustomSection(section) = payload {
                names.push(section.name().to_string());
            }
        }
        Ok(names)
    }

    /// Ensures fallback sanitization preserves imports/exports metadata while removing encoded worlds.
    #[test]
    fn strips_only_component_type_encoded_world_sections() {
        let mut module = wasm_encoder::Module::new();
        module.section(&wasm_encoder::CustomSection {
            name: Cow::Borrowed("component-type:test:imports and exports"),
            data: Cow::Borrowed(&[]),
        });
        module.section(&wasm_encoder::CustomSection {
            name: Cow::Borrowed("component-type:test:encoded world"),
            data: Cow::Borrowed(&[]),
        });
        module.section(&wasm_encoder::CustomSection {
            name: Cow::Borrowed("name"),
            data: Cow::Borrowed(&[]),
        });

        let original = module.finish();
        let sanitized = strip_component_type_encoded_world_custom_sections(&original)
            .expect("sanitization should succeed");
        let names = custom_section_names(&sanitized).expect("module parse should succeed");

        assert!(names.iter().any(|name| name == "component-type:test:imports and exports"));
        assert!(names.iter().any(|name| name == "name"));
        assert!(!names.iter().any(|name| name == "component-type:test:encoded world"));
    }
}
