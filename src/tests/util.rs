// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

use crate::build::util::{find_local_core_path, has_pub_fn, toml_escape};
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
fn toml_escape_escapes_backslashes_and_quotes() {
    assert_eq!(toml_escape(r#"C:\path"#), r#"C:\\path"#);
    assert_eq!(toml_escape(r#"say "hello""#), r#"say \"hello\""#);
    assert_eq!(toml_escape(r#"C:\\test\"#), r#"C:\\\\test\\"#);
}

#[test]
fn has_pub_fn_detects_function_presence() {
    let tmp = TempDir::new("has_pub_fn_present");
    let path = tmp.path.join("test.rs");
    fs::write(&path, "pub fn register_handlers() {}").unwrap();

    assert!(has_pub_fn(&path, "register_handlers"));
    assert!(!has_pub_fn(&path, "missing_fn"));
    assert!(!has_pub_fn(&path, "register"));
}

#[test]
fn has_pub_fn_returns_false_for_missing_file() {
    let tmp = TempDir::new("has_pub_fn_missing");
    let path = tmp.path.join("nonexistent.rs");

    assert!(!has_pub_fn(&path, "any_fn"));
}

#[test]
fn find_local_core_path_locates_core_in_ancestors() {
    let tmp = TempDir::new("find_core");
    let workspace = tmp.path.join("workspace");
    let core = workspace.join("Core");
    let plugin = workspace.join("plugins").join("myplugin");
    fs::create_dir_all(&core).unwrap();
    fs::create_dir_all(&plugin).unwrap();
    fs::write(core.join("Cargo.toml"), "[package]").unwrap();

    let found = find_local_core_path(&plugin);
    assert!(found.is_some());
    assert_eq!(found.unwrap(), core);
}

#[test]
fn find_local_core_path_returns_none_when_not_found() {
    let tmp = TempDir::new("find_core_none");
    let plugin = tmp.path.join("plugin");
    fs::create_dir_all(&plugin).unwrap();

    let found = find_local_core_path(&plugin);
    assert!(found.is_none());
}
