use std::env;
use std::ffi::OsString;
use std::fs;
use std::io;
use std::io::Read;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, ExitCode};
use std::time::{SystemTime, UNIX_EPOCH};
use zip::write::FileOptions;
use zip::CompressionMethod;

fn usage() -> &'static str {
    "openvcs-plugin [args]\n\
\n\
  --plugin-dir <path>   Plugin repository root (contains openvcs.plugin.json)\n\
  --out <path>          Output directory (default: ./dist)\n\
\n\
Builds a WASI plugin binary (`wasm32-wasip2`) and packages it into a single `.ovcsp` zip.\n"
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

fn build_plugin_wasi(plugin_dir: &Path, bin: &str) -> Result<(), String> {
    let mut cmd = Command::new("cargo");
    cmd.current_dir(plugin_dir);
    cmd.arg("build");
    cmd.arg("--release");
    cmd.args(["--target", "wasm32-wasip2"]);
    cmd.args(["--bin", bin]);
    run_status(cmd)
}

fn built_wasi_wasm_path(plugin_dir: &Path, bin: &str) -> PathBuf {
    let mut p = plugin_dir.to_path_buf();
    p.push("target");
    p.push("wasm32-wasip2");
    p.push("release");
    p.push(format!("{bin}.wasm"));
    p
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

fn json_extract_string_value(text: &str, key: &str) -> Option<String> {
    let needle = format!("\"{key}\"");
    let mut i = text.find(&needle)?;
    i += needle.len();
    let bytes = text.as_bytes();
    while i < text.len() && bytes[i].is_ascii_whitespace() {
        i += 1;
    }
    if i >= text.len() || bytes[i] != b':' {
        return None;
    }
    i += 1;
    while i < text.len() && bytes[i].is_ascii_whitespace() {
        i += 1;
    }
    if i >= text.len() || bytes[i] != b'"' {
        return None;
    }
    i += 1;

    let mut out = String::new();
    let mut esc = false;
    while i < text.len() {
        let b = bytes[i];
        i += 1;
        if esc {
            match b {
                b'"' => out.push('"'),
                b'\\' => out.push('\\'),
                b'/' => out.push('/'),
                b'b' => out.push('\u{0008}'),
                b'f' => out.push('\u{000C}'),
                b'n' => out.push('\n'),
                b'r' => out.push('\r'),
                b't' => out.push('\t'),
                _ => return None,
            }
            esc = false;
            continue;
        }
        match b {
            b'\\' => esc = true,
            b'"' => return Some(out),
            _ => out.push(b as char),
        }
    }
    None
}

fn json_extract_object_slice<'a>(text: &'a str, key: &str) -> Option<&'a str> {
    let needle = format!("\"{key}\"");
    let mut i = text.find(&needle)?;
    i += needle.len();
    let bytes = text.as_bytes();
    while i < text.len() && bytes[i].is_ascii_whitespace() {
        i += 1;
    }
    if i >= text.len() || bytes[i] != b':' {
        return None;
    }
    i += 1;
    while i < text.len() && bytes[i].is_ascii_whitespace() {
        i += 1;
    }
    if i >= text.len() || bytes[i] != b'{' {
        return None;
    }

    let start = i;
    let mut depth = 0usize;
    let mut in_string = false;
    let mut esc = false;

    while i < text.len() {
        let b = bytes[i];
        if in_string {
            if esc {
                esc = false;
            } else if b == b'\\' {
                esc = true;
            } else if b == b'"' {
                in_string = false;
            }
            i += 1;
            continue;
        }

        match b {
            b'"' => {
                in_string = true;
                i += 1;
            }
            b'{' => {
                depth += 1;
                i += 1;
            }
            b'}' => {
                depth -= 1;
                i += 1;
                if depth == 0 {
                    return Some(&text[start..i]);
                }
            }
            _ => i += 1,
        }
    }
    None
}

fn manifest_defaults(plugin_dir: &Path) -> Result<(String, Option<String>), String> {
    let manifest_path = plugin_dir.join("openvcs.plugin.json");
    if !manifest_path.is_file() {
        return Err(format!(
            "missing openvcs.plugin.json at {}",
            manifest_path.display()
        ));
    }
    let text = read_to_string(&manifest_path)?;
    let id = json_extract_string_value(&text, "id")
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .ok_or_else(|| format!("manifest {} is missing a string 'id'", manifest_path.display()))?;

    let exec = json_extract_object_slice(&text, "backend")
        .and_then(|backend| json_extract_string_value(backend, "exec"))
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());

    Ok((id, exec))
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
    let (manifest_id, manifest_exec) = manifest_defaults(&args.plugin_dir)?;
    let plugin_id = manifest_id;

    let exec = manifest_exec.clone().ok_or_else(|| {
        "unable to infer plugin backend.exec from openvcs.plugin.json".to_string()
    })?;
    let bin = exec.clone();

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

    build_plugin_wasi(&args.plugin_dir, &bin)?;
    let wasm_src = built_wasi_wasm_path(&args.plugin_dir, &bin);
    if !wasm_src.is_file() {
        return Err(format!(
            "built wasm not found at {} (did cargo build succeed?)",
            wasm_src.display()
        ));
    }

    let wasm_dst = bin_dir.join(format!("{exec}.wasm"));
    copy_with_permissions(&wasm_src, &wasm_dst).map_err(|e| {
        format!(
            "failed to copy wasm {} -> {}: {e}",
            wasm_src.display(),
            wasm_dst.display()
        )
    })?;

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
