use std::env;
use std::ffi::OsString;
use std::fs;
use std::io;
use std::io::Read;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, ExitCode};
use std::time::{SystemTime, UNIX_EPOCH};
use serde::Deserialize;
use zip::write::FileOptions;
use zip::CompressionMethod;

fn usage() -> &'static str {
    "openvcs-plugin [args]\n\
\n\
  --plugin-dir <path>   Plugin repository root (contains openvcs.plugin.json)\n\
  --out <path>          Output directory (default: ./dist)\n\
\n\
Builds plugin executables and packages them into a single `.ovcsp` zip.\n"
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

    let plugin_dir = plugin_dir.unwrap_or_else(|| {
        env::current_dir().unwrap_or_else(|_| PathBuf::from("."))
    });
    Ok(PluginBuildArgs { plugin_dir, out_dir })
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
struct PluginManifestBackend {
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
    backend: Option<PluginManifestBackend>,
    #[serde(default)]
    functions: Option<PluginManifestFunctions>,
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
    let manifest: PluginManifest = serde_json::from_str(&text)
        .map_err(|e| format!("parse {}: {e}", manifest_path.display()))?;

    let id = manifest.id.trim().to_string();
    if id.is_empty() {
        return Err(format!(
            "manifest {} is missing a string 'id'",
            manifest_path.display()
        ));
    }

    let exec = manifest
        .backend
        .and_then(|b| b.exec)
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

fn unique_staging_dir(out_dir: &Path) -> PathBuf {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    out_dir.join(format!(".openvcs-plugin-staging-{now}"))
}

fn zip_dir(zip_path: &Path, base_dir: &Path, folder_name: &str) -> Result<(), String> {
    let root = base_dir.join(folder_name);
    write_zip(zip_path, base_dir, &root)
}

fn collect_files_recursive(dir: &Path, out: &mut Vec<PathBuf>) -> io::Result<()> {
    let entries = fs::read_dir(dir)?;
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            collect_files_recursive(&path, out)?;
        } else if path.is_file() {
            out.push(path);
        }
    }
    Ok(())
}

fn path_to_zip_name(base_dir: &Path, path: &Path) -> Result<String, String> {
    let rel = path
        .strip_prefix(base_dir)
        .map_err(|e| format!("zip path error for {}: {e}", path.display()))?;
    let s = rel.to_string_lossy().replace('\\', "/");
    Ok(s)
}

fn write_zip(zip_path: &Path, base_dir: &Path, root: &Path) -> Result<(), String> {
    let mut files: Vec<PathBuf> = Vec::new();
    collect_files_recursive(root, &mut files)
        .map_err(|e| format!("failed to list {}: {e}", root.display()))?;
    files.sort();

    let out = fs::File::create(zip_path)
        .map_err(|e| format!("failed to create {}: {e}", zip_path.display()))?;
    let mut zip = zip::ZipWriter::new(out);
    let options: FileOptions<'_, ()> = FileOptions::default().compression_method(CompressionMethod::Stored);

    for path in files {
        let zip_name = path_to_zip_name(base_dir, &path)?;
        zip.start_file(zip_name, options)
            .map_err(|e| format!("zip start_file failed: {e}"))?;
        let mut f = fs::File::open(&path).map_err(|e| format!("open {}: {e}", path.display()))?;
        let mut buf = Vec::new();
        f.read_to_end(&mut buf)
            .map_err(|e| format!("read {}: {e}", path.display()))?;
        zip.write_all(&buf)
            .map_err(|e| format!("zip write failed: {e}"))?;
    }

    zip.finish().map_err(|e| format!("zip finish failed: {e}"))?;
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

pub fn bundle_plugin(args: &PluginBuildArgs) -> Result<PathBuf, String> {
    let (manifest_id, backend_exec, functions_exec, entry) = manifest_defaults(&args.plugin_dir)?;
    let plugin_id = manifest_id;

    let has_wasm = backend_exec.is_some() || functions_exec.is_some();
    let has_ui_or_assets = entry.is_some() || args.plugin_dir.join("themes").is_dir();
    if !has_wasm && !has_ui_or_assets {
        return Err("manifest has no backend.exec, functions.exec, entry, or themes/".to_string());
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

    for exec in [backend_exec, functions_exec].into_iter().flatten() {
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
    zip_dir(&out_path, &staging_root, &plugin_id)?;

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

    #[test]
    fn platform_exec_filename_leaves_wasm_unchanged() {
        assert_eq!(platform_exec_filename("plugin.wasm"), "plugin.wasm");
    }
}
