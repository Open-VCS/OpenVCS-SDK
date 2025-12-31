use serde::Deserialize;
use std::env;
use std::ffi::OsString;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, ExitCode};
use std::time::{SystemTime, UNIX_EPOCH};

fn usage() -> &'static str {
    "openvcs-plugin [args]\n\
\n\
  --plugin-dir <path>   Plugin repository root (contains openvcs.plugin.json)\n\
  --out <path>          Output directory (default: ./dist)\n\
\n\
Builds plugin executables and packages them into a single `.ovcsp` tar.xz.\n"
}

#[derive(Debug)]
pub struct PluginBuildArgs {
    pub plugin_dir: PathBuf,
    pub out_dir: PathBuf,
}

fn take_value(args: &mut Vec<OsString>, flag: &str) -> Result<String, String> {
    if args.is_empty() {
        return Err(format!("missing value for {flag}"));
    }
    Ok(args.remove(0).to_string_lossy().to_string())
}

pub fn parse_args(mut args: Vec<OsString>) -> Result<PluginBuildArgs, String> {
    let mut plugin_dir: Option<PathBuf> = None;
    let mut out_dir: PathBuf = PathBuf::from("dist");

    while let Some(arg) = args.first().cloned() {
        let s = arg.to_string_lossy();
        if !s.starts_with("--") {
            return Err(format!("unexpected argument: {s}"));
        }
        args.remove(0);
        match s.as_ref() {
            "--plugin-dir" => {
                plugin_dir = Some(PathBuf::from(take_value(&mut args, "--plugin-dir")?))
            }
            "--out" => out_dir = PathBuf::from(take_value(&mut args, "--out")?),
            "--help" => return Err(usage().to_string()),
            other => return Err(format!("unknown flag: {other}")),
        }
    }

    let plugin_dir =
        plugin_dir.unwrap_or_else(|| env::current_dir().unwrap_or_else(|_| PathBuf::from(".")));
    Ok(PluginBuildArgs {
        plugin_dir,
        out_dir,
    })
}

fn run_status(mut cmd: Command) -> Result<(), String> {
    let status = cmd
        .status()
        .map_err(|e| format!("failed to spawn process: {e}"))?;
    if status.success() {
        Ok(())
    } else {
        Err(format!("command failed with {status}"))
    }
}

fn build_plugin_wasi(plugin_dir: &Path, bin: &str) -> Result<String, String> {
    for target in ["wasm32-wasip1", "wasm32-wasi"] {
        let mut cmd = Command::new("cargo");
        cmd.current_dir(plugin_dir);
        cmd.arg("build");
        cmd.arg("--release");
        cmd.args(["--bin", bin]);
        cmd.args(["--target", target]);
        match run_status(cmd) {
            Ok(()) => return Ok(target.to_string()),
            Err(e) => eprintln!("openvcs-plugin: build for {target} failed: {e}"),
        }
    }
    Err("failed to build plugin for wasm32-wasip1 or wasm32-wasi".to_string())
}

fn built_wasm_bin_path(plugin_dir: &Path, target: &str, bin: &str) -> PathBuf {
    let mut p = plugin_dir.to_path_buf();
    p.push("target");
    p.push(target);
    p.push("release");
    p.push(format!("{bin}.wasm"));
    p
}

fn platform_exec_filename(exec: &str) -> String {
    let exec = exec.trim();
    if exec.is_empty() {
        return String::new();
    }
    exec.to_string()
}

fn read_to_string(path: &Path) -> Result<String, String> {
    fs::read_to_string(path).map_err(|e| format!("read {}: {e}", path.display()))
}

#[derive(Debug, Deserialize)]
struct PluginManifestModule {
    #[serde(default)]
    exec: Option<String>,
}

#[derive(Debug, Deserialize)]
struct PluginManifestFunctions {
    #[serde(default)]
    exec: Option<String>,
}

#[derive(Debug, Deserialize)]
struct PluginManifest {
    id: String,
    #[serde(default)]
    entry: Option<String>,
    #[serde(default)]
    module: Option<PluginManifestModule>,
    #[serde(default)]
    functions: Option<PluginManifestFunctions>,
}

fn parse_manifest_text(
    text: &str,
    manifest_path: &Path,
) -> Result<(String, Option<String>, Option<String>, Option<String>), String> {
    let manifest: PluginManifest = serde_json::from_str(text)
        .map_err(|e| format!("parse {}: {e}", manifest_path.display()))?;

    let id = manifest.id.trim().to_string();
    if id.is_empty() {
        return Err(format!(
            "manifest {} is missing a string 'id'",
            manifest_path.display()
        ));
    }

    let exec = manifest
        .module
        .and_then(|m| m.exec)
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());

    let functions_exec = manifest
        .functions
        .and_then(|f| f.exec)
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());

    let entry = manifest
        .entry
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());

    Ok((id, exec, functions_exec, entry))
}

fn manifest_defaults(
    plugin_dir: &Path,
) -> Result<(String, Option<String>, Option<String>, Option<String>), String> {
    let manifest_path = plugin_dir.join("openvcs.plugin.json");
    if !manifest_path.is_file() {
        return Err(format!(
            "missing openvcs.plugin.json at {}",
            manifest_path.display()
        ));
    }
    let text = read_to_string(&manifest_path)?;
    parse_manifest_text(&text, &manifest_path)
}

fn unique_staging_dir(out_dir: &Path) -> PathBuf {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    out_dir.join(format!(".openvcs-plugin-staging-{now}"))
}

const ICON_EXTENSIONS: &[&str] = &["png", "jpg", "jpeg", "webp", "avif", "svg"];

fn reject_symlinks_recursive(dir: &Path) -> Result<(), String> {
    let entries = fs::read_dir(dir).map_err(|e| format!("read_dir {}: {e}", dir.display()))?;
    for entry in entries {
        let entry = entry.map_err(|e| format!("read_dir entry: {e}"))?;
        let path = entry.path();
        let meta = fs::symlink_metadata(&path)
            .map_err(|e| format!("metadata {}: {e}", path.display()))?;
        if meta.file_type().is_symlink() {
            return Err(format!("plugin contains a symlink: {}", path.display()));
        }
        if meta.is_dir() {
            reject_symlinks_recursive(&path)?;
        }
    }
    Ok(())
}

fn write_tar_xz(out_path: &Path, base_dir: &Path, folder_name: &str) -> Result<(), String> {
    let root = base_dir.join(folder_name);
    reject_symlinks_recursive(&root)?;

    let out = fs::File::create(out_path)
        .map_err(|e| format!("failed to create {}: {e}", out_path.display()))?;
    let encoder = xz2::write::XzEncoder::new(out, 6);
    let mut builder = tar::Builder::new(encoder);
    builder
        .append_dir_all(folder_name, &root)
        .map_err(|e| format!("tar append_dir_all failed: {e}"))?;

    let encoder = builder
        .into_inner()
        .map_err(|e| format!("tar finish failed: {e}"))?;
    encoder
        .finish()
        .map_err(|e| format!("xz finish failed: {e}"))?;
    Ok(())
}

fn copy_dir_recursive(src: &Path, dst: &Path) -> Result<(), String> {
    if !src.exists() {
        return Ok(());
    }
    if !src.is_dir() {
        return Err(format!("expected directory: {}", src.display()));
    }
    fs::create_dir_all(dst).map_err(|e| format!("mkdir {}: {e}", dst.display()))?;
    for entry in fs::read_dir(src).map_err(|e| format!("read_dir {}: {e}", src.display()))? {
        let entry = entry.map_err(|e| format!("read_dir entry: {e}"))?;
        let path = entry.path();
        let name = entry.file_name();
        let dst_path = dst.join(name);
        if path.is_dir() {
            copy_dir_recursive(&path, &dst_path)?;
        } else if path.is_file() {
            fs::copy(&path, &dst_path).map_err(|e| {
                format!(
                    "failed to copy {} -> {}: {e}",
                    path.display(),
                    dst_path.display()
                )
            })?;
        }
    }
    Ok(())
}

fn copy_icon(plugin_dir: &Path, bundle_dir: &Path) -> Result<(), String> {
    for ext in ICON_EXTENSIONS {
        let name = format!("icon.{ext}");
        let src = plugin_dir.join(&name);
        if !src.is_file() {
            continue;
        }
        let dst = bundle_dir.join(&name);
        fs::copy(&src, &dst).map_err(|e| {
            format!(
                "failed to copy icon {} -> {}: {e}",
                src.display(),
                dst.display()
            )
        })?;
        break;
    }
    Ok(())
}

pub fn bundle_plugin(args: &PluginBuildArgs) -> Result<PathBuf, String> {
    let (manifest_id, module_exec, functions_exec, entry) = manifest_defaults(&args.plugin_dir)?;
    let plugin_id = manifest_id;

    let has_wasm = module_exec.is_some() || functions_exec.is_some();
    let has_ui_or_assets = entry.is_some() || args.plugin_dir.join("themes").is_dir();
    if !has_wasm && !has_ui_or_assets {
        return Err("manifest has no module.exec, functions.exec, entry, or themes/".to_string());
    }

    let manifest_src = args.plugin_dir.join("openvcs.plugin.json");

    fs::create_dir_all(&args.out_dir)
        .map_err(|e| format!("failed to create {}: {e}", args.out_dir.display()))?;

    let staging_root = unique_staging_dir(&args.out_dir);
    let bundle_dir = staging_root.join(&plugin_id);
    let bin_dir = bundle_dir.join("bin");

    fs::create_dir_all(&bin_dir)
        .map_err(|e| format!("failed to create {}: {e}", bin_dir.display()))?;

    fs::copy(&manifest_src, bundle_dir.join("openvcs.plugin.json")).map_err(|e| {
        format!(
            "failed to copy manifest {} -> {}: {e}",
            manifest_src.display(),
            bundle_dir.join("openvcs.plugin.json").display()
        )
    })?;

    copy_icon(&args.plugin_dir, &bundle_dir)?;

    if let Some(entry) = entry {
        let entry_src = args.plugin_dir.join(&entry);
        if !entry_src.is_file() {
            return Err(format!(
                "manifest entry not found at {}",
                entry_src.display()
            ));
        }
        let entry_dst = bundle_dir.join(&entry);
        if let Some(parent) = entry_dst.parent() {
            fs::create_dir_all(parent)
                .map_err(|e| format!("failed to create {}: {e}", parent.display()))?;
        }
        fs::copy(&entry_src, &entry_dst).map_err(|e| {
            format!(
                "failed to copy entry {} -> {}: {e}",
                entry_src.display(),
                entry_dst.display()
            )
        })?;
    }

    let themes_src = args.plugin_dir.join("themes");
    if themes_src.is_dir() {
        copy_dir_recursive(&themes_src, &bundle_dir.join("themes"))?;
    }

    for exec in [module_exec, functions_exec].into_iter().flatten() {
        let exec = exec.trim().to_string();
        if exec.is_empty() {
            continue;
        }

        if !exec.ends_with(".wasm") {
            return Err(format!(
                "manifest exec must end with .wasm (OpenVCS is WASM-only): {exec}"
            ));
        }

        let bin = exec
            .strip_suffix(".wasm")
            .ok_or_else(|| format!("invalid wasm exec: {exec}"))?
            .to_string();
        let target = build_plugin_wasi(&args.plugin_dir, &bin)?;
        let bin_src = built_wasm_bin_path(&args.plugin_dir, &target, &bin);
        if !bin_src.is_file() {
            return Err(format!(
                "built wasm not found at {} (did cargo build succeed?)",
                bin_src.display()
            ));
        }
        let bin_dst = bin_dir.join(platform_exec_filename(&exec));
        fs::copy(&bin_src, &bin_dst).map_err(|e| {
            format!(
                "failed to copy wasm {} -> {}: {e}",
                bin_src.display(),
                bin_dst.display()
            )
        })?;
    }

    let out_path = args.out_dir.join(format!("{plugin_id}.ovcsp"));
    if out_path.exists() {
        fs::remove_file(&out_path)
            .map_err(|e| format!("failed to remove existing {}: {e}", out_path.display()))?;
    }
    write_tar_xz(&out_path, &staging_root, &plugin_id)?;

    let _ = fs::remove_dir_all(&staging_root);

    Ok(out_path)
}

pub fn run_plugin_cli() -> ExitCode {
    let mut args: Vec<OsString> = env::args_os().collect();
    let _exe = args.remove(0);

    let parsed = match parse_args(args) {
        Ok(p) => p,
        Err(msg) => {
            eprintln!("{msg}");
            return ExitCode::from(2);
        }
    };

    match bundle_plugin(&parsed) {
        Ok(path) => {
            println!("{}", path.display());
            ExitCode::SUCCESS
        }
        Err(err) => {
            eprintln!("{err}");
            ExitCode::from(1)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeMap;
    use std::fs;
    use std::io::Read;
    use std::io::Cursor;
    use std::path::PathBuf;

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
        let (plugin_id, module_exec, functions_exec, entry) =
            parse_manifest_text(&plugin.manifest_json, &manifest_path)?;

        let has_themes = plugin
            .root_files
            .keys()
            .any(|k| k == "themes" || k.starts_with("themes/"));
        let has_wasm = module_exec.is_some() || functions_exec.is_some();
        let has_ui_or_assets = entry.is_some() || has_themes;
        if !has_wasm && !has_ui_or_assets {
            return Err(
                "manifest has no module.exec, functions.exec, entry, or themes/".to_string(),
            );
        }

        let cursor = Cursor::new(Vec::<u8>::new());
        let encoder = xz2::write::XzEncoder::new(cursor, 6);
        let mut tar = tar::Builder::new(encoder);

        {
            let mut header = tar::Header::new_gnu();
            let bytes = plugin.manifest_json.as_bytes();
            header.set_size(bytes.len() as u64);
            header.set_cksum();
            tar.append_data(&mut header, format!("{plugin_id}/openvcs.plugin.json"), bytes)
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

        if let Some(entry) = entry {
            let bytes = plugin.root_files.get(&entry).ok_or_else(|| {
                format!(
                    "manifest entry not found at {}",
                    PathBuf::from("<memory>").join(&entry).display()
                )
            })?;
            let mut header = tar::Header::new_gnu();
            header.set_size(bytes.len() as u64);
            header.set_cksum();
            tar.append_data(&mut header, format!("{plugin_id}/{entry}"), bytes.as_slice())
                .map_err(|e| format!("tar append entry failed: {e}"))?;
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

        for exec in [module_exec, functions_exec].into_iter().flatten() {
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
            tar.append_data(&mut header, format!("{plugin_id}/bin/{exec}"), bytes.as_slice())
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
        let (id, module_exec, functions_exec, entry) = parse_manifest_text(
            r#"{
  "id": "  my.plugin  ",
  "entry": "  ui/index.html  ",
  "module": { "exec": "  module.wasm  " },
  "functions": { "exec": "  functions.wasm  " }
}"#,
            Path::new("<memory>/openvcs.plugin.json"),
        )
        .unwrap();
        assert_eq!(id, "my.plugin");
        assert_eq!(module_exec.as_deref(), Some("module.wasm"));
        assert_eq!(functions_exec.as_deref(), Some("functions.wasm"));
        assert_eq!(entry.as_deref(), Some("ui/index.html"));
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
        let (id, module_exec, functions_exec, entry) = parse_manifest_text(
            r#"{ "id": "x", "entry": "   ", "module": { "exec": "   " }, "functions": { "exec": "" } }"#,
            Path::new("<memory>/openvcs.plugin.json"),
        )
        .unwrap();
        assert_eq!(id, "x");
        assert_eq!(entry, None);
        assert_eq!(module_exec, None);
        assert_eq!(functions_exec, None);
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
    fn virtual_bundle_packages_ui_only_plugins() {
        let plugin = VirtualPlugin::new(
            r#"{
  "id": "ui-only",
  "entry": "ui/index.html"
}"#,
        )
        .add_root_file("ui/index.html", b"<html></html>")
        .add_root_file("themes/theme.json", br#"{"name":"t"}"#)
        .add_root_file("icon.png", b"icon");

        let (plugin_id, bundle_bytes) = virtual_bundle_tar_xz_bytes(&plugin).unwrap();
        assert_eq!(plugin_id, "ui-only");

        let entries = read_tar_xz_entries_bytes(&bundle_bytes);
        assert!(entries.contains_key("ui-only/openvcs.plugin.json"));
        assert_eq!(
            entries.get("ui-only/ui/index.html").unwrap(),
            b"<html></html>"
        );
        assert!(entries.contains_key("ui-only/themes/theme.json"));
        assert_eq!(entries.get("ui-only/icon.png").unwrap(), b"icon");
    }

    #[test]
    fn virtual_bundle_errors_when_manifest_has_nothing_to_bundle() {
        let plugin = VirtualPlugin::new(r#"{ "id": "x" }"#);
        let err = virtual_bundle_tar_xz_bytes(&plugin).unwrap_err();
        assert_eq!(
            err,
            "manifest has no module.exec, functions.exec, entry, or themes/"
        );
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
    fn virtual_bundle_errors_when_entry_missing() {
        let plugin = VirtualPlugin::new(r#"{ "id": "x", "entry": "ui/index.html" }"#);
        let err = virtual_bundle_tar_xz_bytes(&plugin).unwrap_err();
        assert_eq!(err, "manifest entry not found at <memory>/ui/index.html");
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
    fn virtual_bundle_includes_wasm_execs_in_bin() {
        let plugin = VirtualPlugin::new(
            r#"{ "id": "x", "module": { "exec": "module.wasm" }, "functions": { "exec": "func.wasm" } }"#,
        )
        .add_wasm_exec("module.wasm", b"\0asm")
        .add_wasm_exec("func.wasm", b"\0asm2");

        let (_plugin_id, bundle_bytes) = virtual_bundle_tar_xz_bytes(&plugin).unwrap();
        let entries = read_tar_xz_entries_bytes(&bundle_bytes);
        assert_eq!(entries.get("x/bin/module.wasm").unwrap(), b"\0asm");
        assert_eq!(entries.get("x/bin/func.wasm").unwrap(), b"\0asm2");
    }

    #[test]
    fn virtual_bundle_trims_and_ignores_empty_exec_fields() {
        let plugin = VirtualPlugin::new(
            r#"{ "id": "x", "module": { "exec": "  module.wasm  " }, "functions": { "exec": "   " } }"#,
        )
        .add_wasm_exec("module.wasm", b"x");

        let (_plugin_id, bundle_bytes) = virtual_bundle_tar_xz_bytes(&plugin).unwrap();
        let entries = read_tar_xz_entries_bytes(&bundle_bytes);
        assert_eq!(entries.get("x/bin/module.wasm").unwrap(), b"x");
        assert_eq!(entries.contains_key("x/bin/   "), false);
    }

    #[test]
    fn virtual_bundle_prefers_icon_extension_order() {
        let plugin = VirtualPlugin::new(r#"{ "id": "x", "entry": "ui/index.html" }"#)
            .add_root_file("ui/index.html", b"x")
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
}
