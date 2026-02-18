// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

use crate::build::metadata::CargoMetadata;
use crate::build::wasm::{
    built_wasm_bin_path, ensure_component_module, ensure_wasm_magic, is_component_module,
};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use wasm_encoder::{CustomSection, RawSection};
use wasmparser::Parser;

struct TempDir {
    path: PathBuf,
}

impl TempDir {
    fn new(prefix: &str) -> Self {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_micros();
        let pid = std::process::id();
        let path = std::env::temp_dir().join(format!("openvcs-sdk-tests-{prefix}-{pid}-{now}"));
        fs::create_dir_all(&path).unwrap();
        Self { path }
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.path);
    }
}

#[test]
fn ensure_wasm_magic_accepts_valid_wasm() {
    let tmp = TempDir::new("valid_wasm");
    let wasm_path = tmp.path.join("module.wasm");
    let wasm_bytes = [0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00];
    fs::write(&wasm_path, wasm_bytes).unwrap();

    ensure_wasm_magic(&wasm_path).unwrap();
}

#[test]
fn ensure_wasm_magic_rejects_non_wasm() {
    let tmp = TempDir::new("non_wasm");
    let path = tmp.path.join("file.txt");
    fs::write(&path, b"not wasm").unwrap();

    let err = ensure_wasm_magic(&path).unwrap_err();
    assert!(err.contains("not a wasm module"), "{err}");
}

#[test]
fn ensure_wasm_magic_rejects_empty_file() {
    let tmp = TempDir::new("empty_file");
    let path = tmp.path.join("empty");
    fs::write(&path, b"").unwrap();

    let err = ensure_wasm_magic(&path).unwrap_err();
    assert!(err.contains("not a wasm module"), "{err}");
}

#[test]
fn is_component_module_detects_module() {
    let module_bytes = vec![0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00];
    let is_component = is_component_module(&module_bytes).unwrap();
    assert!(!is_component);
}

#[test]
fn is_component_module_errors_on_malformed_wasm() {
    let bad_bytes = vec![0x00, 0x61, 0x73, 0x6d, 0x99, 0x00];
    let result = is_component_module(&bad_bytes);
    assert!(result.is_err());
}

#[test]
fn resolve_target_dir_parses_metadata_target_directory() {
    let metadata = br#"{"target_directory":"/tmp/openvcs-target"}"#;
    let parsed: CargoMetadata = serde_json::from_slice(metadata).unwrap();
    assert_eq!(
        parsed.target_directory,
        PathBuf::from("/tmp/openvcs-target")
    );
}

#[test]
fn built_wasm_bin_path_uses_resolved_target_directory() {
    let path = built_wasm_bin_path(
        Path::new("/tmp/workspace-target"),
        "wasm32-wasip1",
        "openvcs-git-plugin",
    );
    assert_eq!(
        path,
        PathBuf::from("/tmp/workspace-target/wasm32-wasip1/release/openvcs-git-plugin.wasm")
    );
}

#[test]
fn ensure_component_module_falls_back_when_component_metadata_is_invalid() {
    let tmp = TempDir::new("invalid_component_metadata");
    let wasm_path = tmp.path.join("module.wasm");

    let wit_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../Core/wit");
    let mut resolve = wit_parser::Resolve::default();
    let (package_id, _) = resolve.push_path(&wit_dir).unwrap();
    let package_ids = [package_id];
    let world_id = resolve.select_world(&package_ids, Some("plugin")).unwrap();
    let module =
        wit_component::dummy_module(&resolve, world_id, wit_parser::ManglingAndAbi::Standard32);

    let mut rebuilt = wasm_encoder::Module::new();
    for payload in Parser::new(0).parse_all(&module) {
        let payload = payload.unwrap();
        if let Some((id, range)) = payload.as_section() {
            rebuilt.section(&RawSection {
                id,
                data: &module[range],
            });
        }
    }
    rebuilt.section(&CustomSection {
        name: "component-type:broken".into(),
        data: vec![0xde, 0xad, 0xbe, 0xef].into(),
    });
    fs::write(&wasm_path, rebuilt.finish()).unwrap();

    ensure_component_module(&wasm_path).unwrap();

    let output = fs::read(&wasm_path).unwrap();
    assert!(is_component_module(&output).unwrap());
}
