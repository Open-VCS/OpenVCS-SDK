use crate::build::metadata::package_name_for_manifest;
use std::fs;
use std::path::PathBuf;
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
fn package_name_returns_none_when_no_cargo_toml() {
    let tmp = TempDir::new("no_cargo_toml");
    let result = package_name_for_manifest(&tmp.path);
    assert_eq!(result, None);
}

#[test]
fn package_name_falls_back_to_first_package() {
    let tmp = TempDir::new("package_name_fallback");
    let cargo_toml = tmp.path.join("Cargo.toml");
    fs::write(
        &cargo_toml,
        r#"
[package]
name = "test-plugin"
version = "0.1.0"

[lib]
path = "lib.rs"
"#,
    )
    .unwrap();

    let result = package_name_for_manifest(&tmp.path);
    assert_eq!(result, Some("test-plugin".to_string()));
}
