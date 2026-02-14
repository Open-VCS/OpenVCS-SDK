use super::*;
use std::collections::BTreeMap;
use std::fs;
use std::io::Cursor;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

#[test]
fn platform_exec_filename_leaves_wasm_unchanged() {
    assert_eq!(platform_exec_filename("plugin.wasm"), "plugin.wasm");
}

#[test]
fn platform_exec_filename_trims_whitespace_and_handles_empty() {
    assert_eq!(platform_exec_filename("  plugin.wasm  "), "plugin.wasm");
    assert_eq!(platform_exec_filename("   "), "");
    assert_eq!(platform_exec_filename(""), "");
}

#[test]
fn parse_args_requires_flags() {
    let err = parse_args(vec![OsString::from("not-a-flag")]).unwrap_err();
    assert!(err.contains("unexpected argument:"), "{err}");
}

#[test]
fn parse_args_rejects_unknown_flag() {
    let err = parse_args(vec![OsString::from("--nope")]).unwrap_err();
    assert_eq!(err, "unknown flag: --nope");
}

#[test]
fn parse_args_requires_flag_values() {
    let err = parse_args(vec![OsString::from("--plugin-dir")]).unwrap_err();
    assert_eq!(err, "missing value for --plugin-dir");

    let err = parse_args(vec![OsString::from("--out")]).unwrap_err();
    assert_eq!(err, "missing value for --out");
}

#[test]
fn parse_args_parses_plugin_dir_and_out_dir() {
    let args = vec![
        OsString::from("--plugin-dir"),
        OsString::from("some/plugin"),
        OsString::from("--out"),
        OsString::from("some/out"),
    ];
    let parsed = parse_args(args).unwrap();
    assert_eq!(parsed.plugin_dir, PathBuf::from("some/plugin"));
    assert_eq!(parsed.out_dir, PathBuf::from("some/out"));
}

#[test]
fn parse_args_defaults_out_dir_to_dist() {
    let args = vec![
        OsString::from("--plugin-dir"),
        OsString::from("some/plugin"),
    ];
    let parsed = parse_args(args).unwrap();
    assert_eq!(parsed.out_dir, PathBuf::from("dist"));
}

#[test]
fn parse_args_defaults_plugin_dir_to_current_dir() {
    let parsed = parse_args(vec![]).unwrap();
    assert_eq!(parsed.out_dir, PathBuf::from("dist"));
    assert_eq!(parsed.plugin_dir, env::current_dir().unwrap());
}

#[test]
fn parse_args_help_prints_usage_via_error() {
    let err = parse_args(vec![OsString::from("--help")]).unwrap_err();
    assert!(err.contains("openvcs-plugin [args]"), "{err}");
}

struct VirtualPlugin {
    manifest_json: String,
    root_files: BTreeMap<String, Vec<u8>>,
    wasm_execs: BTreeMap<String, Vec<u8>>,
}

impl VirtualPlugin {
    fn new(manifest_json: impl Into<String>) -> Self {
        Self {
            manifest_json: manifest_json.into(),
            root_files: BTreeMap::new(),
            wasm_execs: BTreeMap::new(),
        }
    }

    fn add_root_file(mut self, path: &str, content: impl Into<Vec<u8>>) -> Self {
        self.root_files.insert(path.to_string(), content.into());
        self
    }

    fn add_wasm_exec(mut self, exec: &str, content: impl Into<Vec<u8>>) -> Self {
        self.wasm_execs.insert(exec.to_string(), content.into());
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
    let has_wasm = module_exec.is_some();
    let has_ui_or_assets = has_themes;
    if !has_wasm && !has_ui_or_assets {
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

    for exec in [module_exec].into_iter().flatten() {
        let exec = exec.trim().to_string();
        if exec.is_empty() {
            continue;
        }

        if !exec.ends_with(".wasm") {
            return Err(format!(
                "manifest exec must end with .wasm (OpenVCS is WASM-only): {exec}"
            ));
        }

        let bytes = plugin.wasm_execs.get(&exec).ok_or_else(|| {
            format!(
                "built wasm not found at {} (did cargo build succeed?)",
                PathBuf::from("<memory>/target/wasm32-wasip1/release")
                    .join(&exec)
                    .display()
            )
        })?;

        let mut header = tar::Header::new_gnu();
        header.set_size(bytes.len() as u64);
        header.set_cksum();
        tar.append_data(
            &mut header,
            format!("{plugin_id}/bin/{exec}"),
            bytes.as_slice(),
        )
        .map_err(|e| format!("tar append wasm failed: {e}"))?;
    }

    let encoder = tar
        .into_inner()
        .map_err(|e| format!("tar finish failed: {e}"))?;
    let cursor = encoder
        .finish()
        .map_err(|e| format!("xz finish failed: {e}"))?;

    Ok((plugin_id, cursor.into_inner()))
}

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

fn write_file(path: &Path, content: &[u8]) {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).unwrap();
    }
    fs::write(path, content).unwrap();
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
fn copy_dir_recursive_copies_nested_files() {
    let tmp = TempDir::new("copy_dir_recursive");
    let src = tmp.path.join("src");
    let dst = tmp.path.join("dst");
    write_file(&src.join("a.txt"), b"a");
    write_file(&src.join("nested/b.txt"), b"b");

    copy_dir_recursive(&src, &dst).unwrap();

    assert_eq!(fs::read(dst.join("a.txt")).unwrap(), b"a");
    assert_eq!(fs::read(dst.join("nested/b.txt")).unwrap(), b"b");
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
fn virtual_bundle_rejects_non_wasm_exec() {
    let plugin = VirtualPlugin::new(r#"{ "id": "x", "module": { "exec": "not-wasm" } }"#);
    let err = virtual_bundle_tar_xz_bytes(&plugin).unwrap_err();
    assert_eq!(
        err,
        "manifest exec must end with .wasm (OpenVCS is WASM-only): not-wasm"
    );
}

#[test]
fn virtual_bundle_allows_manifest_entry_field() {
    let plugin = VirtualPlugin::new(
        r#"{ "id": "x", "entry": "ui/index.html", "module": { "exec": "module.wasm" } }"#,
    )
    .add_wasm_exec("module.wasm", b"\0asm");
    let (_plugin_id, bundle_bytes) = virtual_bundle_tar_xz_bytes(&plugin).unwrap();
    let entries = read_tar_xz_entries_bytes(&bundle_bytes);
    assert!(entries.contains_key("x/openvcs.plugin.json"));
    assert_eq!(entries.get("x/bin/module.wasm").unwrap(), b"\0asm");
}

#[test]
fn virtual_bundle_errors_when_wasm_missing() {
    let plugin = VirtualPlugin::new(r#"{ "id": "x", "module": { "exec": "module.wasm" } }"#);
    let err = virtual_bundle_tar_xz_bytes(&plugin).unwrap_err();
    assert_eq!(
        err,
        "built wasm not found at <memory>/target/wasm32-wasip1/release/module.wasm (did cargo build succeed?)"
    );
}

#[test]
fn virtual_bundle_includes_wasm_exec_in_bin() {
    let plugin = VirtualPlugin::new(r#"{ "id": "x", "module": { "exec": "module.wasm" } }"#)
        .add_wasm_exec("module.wasm", b"\0asm");

    let (_plugin_id, bundle_bytes) = virtual_bundle_tar_xz_bytes(&plugin).unwrap();
    let entries = read_tar_xz_entries_bytes(&bundle_bytes);
    assert_eq!(entries.get("x/bin/module.wasm").unwrap(), b"\0asm");
}

#[test]
fn virtual_bundle_trims_exec_field() {
    let plugin = VirtualPlugin::new(r#"{ "id": "x", "module": { "exec": "  module.wasm  " } }"#)
        .add_wasm_exec("module.wasm", b"x");

    let (_plugin_id, bundle_bytes) = virtual_bundle_tar_xz_bytes(&plugin).unwrap();
    let entries = read_tar_xz_entries_bytes(&bundle_bytes);
    assert_eq!(entries.get("x/bin/module.wasm").unwrap(), b"x");
}

#[test]
fn virtual_bundle_ignores_functions_field() {
    let plugin = VirtualPlugin::new(
        r#"{ "id": "x", "module": { "exec": "module.wasm" }, "functions": { "exec": "func.wasm" } }"#,
    )
    .add_wasm_exec("module.wasm", b"\0asm")
    .add_wasm_exec("func.wasm", b"\0asm2");
    let (_plugin_id, bundle_bytes) = virtual_bundle_tar_xz_bytes(&plugin).unwrap();
    let entries = read_tar_xz_entries_bytes(&bundle_bytes);
    assert_eq!(entries.get("x/bin/module.wasm").unwrap(), b"\0asm");
    assert!(!entries.contains_key("x/bin/func.wasm"));
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
fn manifest_defaults_errors_when_missing_manifest() {
    let tmp = TempDir::new("manifest_defaults_missing_manifest");
    let plugin_dir = tmp.path.join("plugin");
    fs::create_dir_all(&plugin_dir).unwrap();
    let err = manifest_defaults(&plugin_dir).unwrap_err();
    assert!(err.contains("missing openvcs.plugin.json"), "{err}");
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
