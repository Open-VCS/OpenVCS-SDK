use crate::build::metadata::CargoMetadata;
use crate::build::wasm::{built_wasm_bin_path, ensure_wasm_magic, is_component_module};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

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
