// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

use crate::dist::manifest::{manifest_defaults, parse_manifest_text};
use std::env;
use std::fs;
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

struct TempDir {
    path: std::path::PathBuf,
}

impl TempDir {
    fn new(prefix: &str) -> Self {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_micros();
        let pid = std::process::id();
        let path = env::temp_dir().join(format!("openvcs-sdk-tests-{prefix}-{pid}-{now}"));
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
fn parse_manifest_text_parses_and_trims_fields() {
    let (id, module_exec) = parse_manifest_text(
        r#"{
  "id": "  my.plugin  ",
  "module": { "exec": "  module.wasm  " }
}"#,
        Path::new("<memory>/openvcs.plugin.json"),
    )
    .unwrap();
    assert_eq!(id, "my.plugin");
    assert_eq!(module_exec.as_deref(), Some("module.wasm"));
}

#[test]
fn parse_manifest_text_errors_when_id_is_empty() {
    let err = parse_manifest_text(
        r#"{ "id": "   " }"#,
        Path::new("<memory>/openvcs.plugin.json"),
    )
    .unwrap_err();
    assert!(err.contains("missing a string 'id'"), "{err}");
}

#[test]
fn parse_manifest_text_errors_on_invalid_json_with_path_context() {
    let err = parse_manifest_text("{", Path::new("some/path/openvcs.plugin.json")).unwrap_err();
    assert!(
        err.contains("parse some/path/openvcs.plugin.json:"),
        "{err}"
    );
}

#[test]
fn parse_manifest_text_treats_whitespace_only_optional_fields_as_none() {
    let (id, module_exec) = parse_manifest_text(
        r#"{ "id": "x", "module": { "exec": "   " } }"#,
        Path::new("<memory>/openvcs.plugin.json"),
    )
    .unwrap();
    assert_eq!(id, "x");
    assert_eq!(module_exec, None);
}

#[test]
fn parse_manifest_text_ignores_functions_field() {
    let (id, module_exec) = parse_manifest_text(
        r#"{ "id": "x", "module": { "exec": "m.wasm" }, "functions": { "exec": "f.wasm" } }"#,
        Path::new("<memory>/openvcs.plugin.json"),
    )
    .unwrap();
    assert_eq!(id, "x");
    assert_eq!(module_exec.as_deref(), Some("m.wasm"));
}

#[test]
fn parse_manifest_text_rejects_missing_id() {
    let err = parse_manifest_text(r#"{}"#, Path::new("<memory>/openvcs.plugin.json")).unwrap_err();
    assert!(err.contains("missing field `id`"), "{err}");
}

#[test]
fn parse_manifest_text_rejects_null_id() {
    let err = parse_manifest_text(r#"{"id": null}"#, Path::new("<memory>/openvcs.plugin.json"))
        .unwrap_err();
    assert!(err.contains("expected a string"), "{err}");
}

#[test]
fn parse_manifest_text_rejects_invalid_json_types() {
    let err = parse_manifest_text(r#"{"id": 123}"#, Path::new("<memory>/openvcs.plugin.json"))
        .unwrap_err();
    assert!(err.contains("expected a string"), "{err}");
}

#[test]
fn manifest_defaults_errors_when_missing_manifest() {
    let tmp = TempDir::new("manifest_defaults_missing_manifest");
    let plugin_dir = tmp.path.join("plugin");
    fs::create_dir_all(&plugin_dir).unwrap();
    let err = manifest_defaults(&plugin_dir).unwrap_err();
    assert!(err.contains("missing openvcs.plugin.json"), "{err}");
}
