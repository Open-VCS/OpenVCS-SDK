// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

use crate::dist::fsops::{ICON_EXTENSIONS, copy_dir_recursive};
use crate::dist::manifest::parse_manifest_text;
use crate::dist::{PluginBuildArgs, bundle_plugin};
use std::collections::BTreeMap;
use std::io::Cursor;
use std::io::Read;
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
        std::fs::create_dir_all(&path).unwrap();
        Self { path }
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.path);
    }
}

fn write_file(path: &Path, content: &[u8]) {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).unwrap();
    }
    std::fs::write(path, content).unwrap();
}

struct VirtualPlugin {
    manifest_json: String,
    root_files: BTreeMap<String, Vec<u8>>,
    bin_files: BTreeMap<String, Vec<u8>>,
}

impl VirtualPlugin {
    fn new(manifest_json: impl Into<String>) -> Self {
        Self {
            manifest_json: manifest_json.into(),
            root_files: BTreeMap::new(),
            bin_files: BTreeMap::new(),
        }
    }

    fn add_root_file(mut self, path: &str, content: impl Into<Vec<u8>>) -> Self {
        self.root_files.insert(path.to_string(), content.into());
        self
    }

    fn add_module_exec(mut self, exec: &str, content: impl Into<Vec<u8>>) -> Self {
        self.bin_files.insert(exec.to_string(), content.into());
        self
    }

    fn add_bin_file(mut self, path: &str, content: impl Into<Vec<u8>>) -> Self {
        self.bin_files.insert(path.to_string(), content.into());
        self
    }
}

fn virtual_bundle_tar_xz_bytes(plugin: &VirtualPlugin) -> Result<(String, Vec<u8>), String> {
    let manifest_path = PathBuf::from("<memory>/openvcs.plugin.json");
    let (plugin_id, module_exec) = parse_manifest_text(&plugin.manifest_json, &manifest_path)?;

    let has_themes = plugin
        .root_files
        .keys()
        .any(|k| k == "themes" || k.starts_with("themes/"));
    let has_module = module_exec.is_some();
    let has_ui_or_assets = has_themes;
    if !has_module && !has_ui_or_assets {
        return Err("manifest has no module.exec or themes/".to_string());
    }

    let cursor = Cursor::new(Vec::<u8>::new());
    let encoder = xz2::write::XzEncoder::new(cursor, 6);
    let mut tar = tar::Builder::new(encoder);

    {
        let mut header = tar::Header::new_gnu();
        let bytes = plugin.manifest_json.as_bytes();
        header.set_size(bytes.len() as u64);
        header.set_cksum();
        tar.append_data(
            &mut header,
            format!("{plugin_id}/openvcs.plugin.json"),
            bytes,
        )
        .map_err(|e| format!("tar append manifest failed: {e}"))?;
    }

    for ext in ICON_EXTENSIONS {
        let name = format!("icon.{ext}");
        if let Some(bytes) = plugin.root_files.get(&name) {
            let mut header = tar::Header::new_gnu();
            header.set_size(bytes.len() as u64);
            header.set_cksum();
            tar.append_data(&mut header, format!("{plugin_id}/{name}"), bytes.as_slice())
                .map_err(|e| format!("tar append icon failed: {e}"))?;
            break;
        }
    }

    for (path, bytes) in &plugin.root_files {
        if !path.starts_with("themes/") {
            continue;
        }
        let mut header = tar::Header::new_gnu();
        header.set_size(bytes.len() as u64);
        header.set_cksum();
        tar.append_data(&mut header, format!("{plugin_id}/{path}"), bytes.as_slice())
            .map_err(|e| format!("tar append theme failed: {e}"))?;
    }

    if let Some(exec) = module_exec.as_deref() {
        let exec = exec.trim().to_string();
        if exec.is_empty() {
            return Err("manifest module.exec is empty".to_string());
        }

        let lower = exec.to_ascii_lowercase();
        let is_supported =
            lower.ends_with(".js") || lower.ends_with(".mjs") || lower.ends_with(".cjs");
        if !is_supported {
            return Err(format!(
                "manifest exec must end with .js/.mjs/.cjs (Node runtime): {exec}"
            ));
        }

        let bytes = plugin
            .bin_files
            .get(&exec)
            .ok_or_else(|| format!("module entrypoint not found at <memory>/bin/{exec}"))?;

        let mut header = tar::Header::new_gnu();
        header.set_size(bytes.len() as u64);
        header.set_cksum();
        tar.append_data(
            &mut header,
            format!("{plugin_id}/bin/{exec}"),
            bytes.as_slice(),
        )
        .map_err(|e| format!("tar append module failed: {e}"))?;
    }

    for (path, bytes) in &plugin.bin_files {
        let Some(module_exec) = module_exec.as_deref() else {
            continue;
        };
        if path == module_exec {
            continue;
        }
        let mut header = tar::Header::new_gnu();
        header.set_size(bytes.len() as u64);
        header.set_cksum();
        tar.append_data(
            &mut header,
            format!("{plugin_id}/bin/{path}"),
            bytes.as_slice(),
        )
        .map_err(|e| format!("tar append bin file failed: {e}"))?;
    }

    let encoder = tar
        .into_inner()
        .map_err(|e| format!("tar finish failed: {e}"))?;
    let cursor = encoder
        .finish()
        .map_err(|e| format!("xz finish failed: {e}"))?;

    Ok((plugin_id, cursor.into_inner()))
}

fn read_tar_xz_entries_bytes(bundle_bytes: &[u8]) -> BTreeMap<String, Vec<u8>> {
    let cursor = Cursor::new(bundle_bytes);
    let decoder = xz2::read::XzDecoder::new(cursor);
    let mut tar = tar::Archive::new(decoder);
    let mut out = BTreeMap::new();
    for entry in tar.entries().unwrap() {
        let mut entry = entry.unwrap();
        if !entry.header().entry_type().is_file() {
            continue;
        }
        let name = entry.path().unwrap().to_string_lossy().to_string();
        let mut buf = Vec::new();
        entry.read_to_end(&mut buf).unwrap();
        out.insert(name, buf);
    }
    out
}

#[test]
fn copy_dir_recursive_copies_nested_files() {
    let tmp = TempDir::new("copy_dir_recursive");
    let src = tmp.path.join("src");
    let dst = tmp.path.join("dst");
    write_file(&src.join("a.txt"), b"a");
    write_file(&src.join("nested/b.txt"), b"b");

    copy_dir_recursive(&src, &dst).unwrap();

    assert_eq!(std::fs::read(dst.join("a.txt")).unwrap(), b"a");
    assert_eq!(std::fs::read(dst.join("nested/b.txt")).unwrap(), b"b");
}

#[test]
fn virtual_bundle_packages_themes_only_plugins() {
    let plugin = VirtualPlugin::new(
        r#"{
  "id": "ui-only"
}"#,
    )
    .add_root_file("themes/theme.json", br#"{"name":"t"}"#)
    .add_root_file("icon.png", b"icon");

    let (plugin_id, bundle_bytes) = virtual_bundle_tar_xz_bytes(&plugin).unwrap();
    assert_eq!(plugin_id, "ui-only");

    let entries = read_tar_xz_entries_bytes(&bundle_bytes);
    assert!(entries.contains_key("ui-only/openvcs.plugin.json"));
    assert!(entries.contains_key("ui-only/themes/theme.json"));
    assert_eq!(entries.get("ui-only/icon.png").unwrap(), b"icon");
}

#[test]
fn virtual_bundle_errors_when_manifest_has_nothing_to_bundle() {
    let plugin = VirtualPlugin::new(r#"{ "id": "x" }"#);
    let err = virtual_bundle_tar_xz_bytes(&plugin).unwrap_err();
    assert_eq!(err, "manifest has no module.exec or themes/");
}

#[test]
fn virtual_bundle_allows_themes_only_plugins() {
    let plugin = VirtualPlugin::new(r#"{ "id": "x" }"#)
        .add_root_file("themes/theme.json", br#"{"name":"t"}"#);
    let (_plugin_id, bundle_bytes) = virtual_bundle_tar_xz_bytes(&plugin).unwrap();
    let entries = read_tar_xz_entries_bytes(&bundle_bytes);
    assert!(entries.contains_key("x/openvcs.plugin.json"));
    assert!(entries.contains_key("x/themes/theme.json"));
}

#[test]
fn virtual_bundle_rejects_non_node_exec() {
    let plugin = VirtualPlugin::new(r#"{ "id": "x", "module": { "exec": "not-node" } }"#);
    let err = virtual_bundle_tar_xz_bytes(&plugin).unwrap_err();
    assert_eq!(
        err,
        "manifest exec must end with .js/.mjs/.cjs (Node runtime): not-node"
    );
}

#[test]
fn virtual_bundle_allows_manifest_entry_field() {
    let plugin = VirtualPlugin::new(
        r#"{ "id": "x", "entry": "ui/index.html", "module": { "exec": "module.mjs" } }"#,
    )
    .add_module_exec("module.mjs", b"export {};\n");
    let (_plugin_id, bundle_bytes) = virtual_bundle_tar_xz_bytes(&plugin).unwrap();
    let entries = read_tar_xz_entries_bytes(&bundle_bytes);
    assert!(entries.contains_key("x/openvcs.plugin.json"));
    assert_eq!(entries.get("x/bin/module.mjs").unwrap(), b"export {};\n");
}

#[test]
fn virtual_bundle_errors_when_module_missing() {
    let plugin = VirtualPlugin::new(r#"{ "id": "x", "module": { "exec": "module.mjs" } }"#);
    let err = virtual_bundle_tar_xz_bytes(&plugin).unwrap_err();
    assert_eq!(
        err,
        "module entrypoint not found at <memory>/bin/module.mjs"
    );
}

#[test]
fn virtual_bundle_includes_module_exec_in_bin() {
    let plugin = VirtualPlugin::new(r#"{ "id": "x", "module": { "exec": "module.mjs" } }"#)
        .add_module_exec("module.mjs", b"export {};\n");

    let (_plugin_id, bundle_bytes) = virtual_bundle_tar_xz_bytes(&plugin).unwrap();
    let entries = read_tar_xz_entries_bytes(&bundle_bytes);
    assert_eq!(entries.get("x/bin/module.mjs").unwrap(), b"export {};\n");
}

#[test]
fn virtual_bundle_trims_exec_field() {
    let plugin = VirtualPlugin::new(r#"{ "id": "x", "module": { "exec": "  module.mjs  " } }"#)
        .add_module_exec("module.mjs", b"x");

    let (_plugin_id, bundle_bytes) = virtual_bundle_tar_xz_bytes(&plugin).unwrap();
    let entries = read_tar_xz_entries_bytes(&bundle_bytes);
    assert_eq!(entries.get("x/bin/module.mjs").unwrap(), b"x");
}

#[test]
fn virtual_bundle_ignores_functions_field_for_module_selection_only() {
    let plugin = VirtualPlugin::new(
        r#"{ "id": "x", "module": { "exec": "module.mjs" }, "functions": { "exec": "func.mjs" } }"#,
    )
    .add_module_exec("module.mjs", b"export {};\n")
    .add_module_exec("func.mjs", b"export {};\n");
    let (_plugin_id, bundle_bytes) = virtual_bundle_tar_xz_bytes(&plugin).unwrap();
    let entries = read_tar_xz_entries_bytes(&bundle_bytes);
    assert_eq!(entries.get("x/bin/module.mjs").unwrap(), b"export {};\n");
    assert_eq!(entries.get("x/bin/func.mjs").unwrap(), b"export {};\n");
}

#[test]
fn virtual_bundle_prefers_icon_extension_order() {
    let plugin = VirtualPlugin::new(r#"{ "id": "x" }"#)
        .add_root_file("themes/theme.json", br#"{"name":"t"}"#)
        .add_root_file("icon.jpg", b"jpg")
        .add_root_file("icon.png", b"png");

    let (_plugin_id, bundle_bytes) = virtual_bundle_tar_xz_bytes(&plugin).unwrap();
    let entries = read_tar_xz_entries_bytes(&bundle_bytes);
    assert_eq!(entries.get("x/icon.png").unwrap(), b"png");
    assert!(!entries.contains_key("x/icon.jpg"));
}

#[test]
fn virtual_bundle_includes_extra_bin_files() {
    let plugin = VirtualPlugin::new(r#"{ "id": "x", "module": { "exec": "module.mjs" } }"#)
        .add_module_exec("module.mjs", b"export {}\n")
        .add_bin_file("helpers/util.mjs", b"export const x = 1\n");

    let (_plugin_id, bundle_bytes) = virtual_bundle_tar_xz_bytes(&plugin).unwrap();
    let entries = read_tar_xz_entries_bytes(&bundle_bytes);
    assert!(entries.contains_key("x/bin/module.mjs"));
    assert!(entries.contains_key("x/bin/helpers/util.mjs"));
}

#[test]
fn bundle_rejects_module_exec_path_traversal() {
    let tmp = TempDir::new("bundle_exec_traversal");
    let plugin_dir = tmp.path.join("plugin");
    std::fs::create_dir_all(plugin_dir.join("bin")).unwrap();

    write_file(
        &plugin_dir.join("openvcs.plugin.json"),
        br#"{ "id": "x", "module": { "exec": "../secret.js" } }"#,
    );
    write_file(&plugin_dir.join("secret.js"), b"console.log('secret')\n");

    let out_dir = tmp.path.join("out");
    std::fs::create_dir_all(&out_dir).unwrap();

    let args = PluginBuildArgs {
        plugin_dir,
        out_dir,
        verbose: false,
        no_npm_deps: true,
    };

    let err = bundle_plugin(&args).unwrap_err();
    assert!(
        err.contains("module.exec") && err.contains("under bin"),
        "unexpected error: {err}"
    );
}
