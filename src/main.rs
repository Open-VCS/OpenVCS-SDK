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
struct Args {
    plugin_dir: PathBuf,
    out_dir: PathBuf,
}

fn take_value(args: &mut Vec<OsString>, flag: &str) -> Result<String, String> {
    if args.is_empty() {
        return Err(format!("missing value for {flag}"));
    }
    Ok(args.remove(0).to_string_lossy().to_string())
}

fn parse_args(mut args: Vec<OsString>) -> Result<Args, String> {
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

    let plugin_dir = plugin_dir.ok_or_else(|| "missing required flag: --plugin-dir".to_string())?;
    Ok(Args { plugin_dir, out_dir })
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

fn build_plugin_native(plugin_dir: &Path, bin: &str) -> Result<(), String> {
    let mut cmd = Command::new("cargo");
    cmd.current_dir(plugin_dir);
    cmd.arg("build");
    cmd.arg("--release");
    cmd.args(["-p", bin]);
    cmd.args(["--bin", bin]);
    run_status(cmd)
}

fn built_native_bin_path(plugin_dir: &Path, bin: &str) -> PathBuf {
    let mut p = plugin_dir.to_path_buf();
    p.push("target");
    p.push("release");
    p.push(format!("{bin}{}", std::env::consts::EXE_SUFFIX));
    p
}

fn platform_exec_filename(exec: &str) -> String {
    let exec = exec.trim();
    if exec.is_empty() {
        return String::new();
    }
    let suffix = std::env::consts::EXE_SUFFIX;
    if !suffix.is_empty() && exec.ends_with(suffix) {
        exec.to_string()
    } else {
        format!("{exec}{suffix}")
    }
}

fn copy_with_permissions(src: &Path, dst: &Path) -> io::Result<()> {
    fs::copy(src, dst)?;
    let perm = fs::metadata(src)?.permissions();
    fs::set_permissions(dst, perm)?;
    Ok(())
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
    backend: Option<PluginManifestBackend>,
    #[serde(default)]
    functions: Option<PluginManifestFunctions>,
}

fn manifest_defaults(plugin_dir: &Path) -> Result<(String, Option<String>, Option<String>), String> {
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

    Ok((id, exec, functions_exec))
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

fn bundle_plugin(args: &Args) -> Result<PathBuf, String> {
    let (manifest_id, backend_exec, functions_exec) = manifest_defaults(&args.plugin_dir)?;
    let plugin_id = manifest_id;

    if backend_exec.is_none() && functions_exec.is_none() {
        return Err("manifest has no backend.exec or functions.exec".to_string());
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

    for exec in [backend_exec, functions_exec].into_iter().flatten() {
        let bin = exec.clone();
        build_plugin_native(&args.plugin_dir, &bin)?;
        let bin_src = built_native_bin_path(&args.plugin_dir, &bin);
        if !bin_src.is_file() {
            return Err(format!(
                "built executable not found at {} (did cargo build succeed?)",
                bin_src.display()
            ));
        }
        let bin_dst = bin_dir.join(platform_exec_filename(&exec));
        copy_with_permissions(&bin_src, &bin_dst).map_err(|e| {
            format!(
                "failed to copy executable {} -> {}: {e}",
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

fn main() -> ExitCode {
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
