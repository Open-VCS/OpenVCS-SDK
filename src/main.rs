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
    "openvcs-plugin <command> [args]\n\
\n\
Commands:\n\
  package   Build a plugin and assemble a bundle directory\n\
  bundle    Build a plugin and assemble a single .ovcsp zip\n\
\n\
Package args:\n\
  --plugin-dir <path>   Plugin repository root (contains openvcs.plugin.json)\n\
  --plugin-id <id>      Optional plugin id (default: manifest id)\n\
  --bin <name>          Optional cargo binary name to build (default: manifest backend.exec)\n\
  --exec <name>         Executable name in manifest (default: --bin)\n\
  --profile <name>      debug|release (default: release)\n\
  --out <path>          Output directory (default: ./dist)\n\
  --target <triple>     Optional cargo --target (repeatable)\n\
  --package <name>      Optional cargo -p <name>\n"
}

#[derive(Debug)]
struct PackageArgs {
    plugin_dir: PathBuf,
    plugin_id: String,
    package: Option<String>,
    bin: String,
    exec: String,
    profile: String,
    out_dir: PathBuf,
    target: Option<String>,
}

#[derive(Debug)]
struct BundleArgs {
    plugin_dir: PathBuf,
    plugin_id: Option<String>,
    package: Option<String>,
    bin: Option<String>,
    exec: Option<String>,
    profile: String,
    out_dir: PathBuf,
    targets: Vec<String>,
}

fn take_value(args: &mut Vec<OsString>, flag: &str) -> Result<String, String> {
    if args.is_empty() {
        return Err(format!("missing value for {flag}"));
    }
    Ok(args.remove(0).to_string_lossy().to_string())
}

fn parse_package_args(mut args: Vec<OsString>) -> Result<PackageArgs, String> {
    let mut plugin_dir: Option<PathBuf> = None;
    let mut plugin_id: Option<String> = None;
    let mut package: Option<String> = None;
    let mut bin: Option<String> = None;
    let mut exec: Option<String> = None;
    let mut profile: String = "release".to_string();
    let mut out_dir: PathBuf = PathBuf::from("dist");
    let mut target: Option<String> = None;

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
            "--plugin-id" => plugin_id = Some(take_value(&mut args, "--plugin-id")?),
            "--package" => package = Some(take_value(&mut args, "--package")?),
            "--bin" => bin = Some(take_value(&mut args, "--bin")?),
            "--exec" => exec = Some(take_value(&mut args, "--exec")?),
            "--profile" => profile = take_value(&mut args, "--profile")?,
            "--out" => out_dir = PathBuf::from(take_value(&mut args, "--out")?),
            "--target" => target = Some(take_value(&mut args, "--target")?),
            "--help" => return Err(usage().to_string()),
            other => return Err(format!("unknown flag: {other}")),
        }
    }

    let plugin_dir = plugin_dir.ok_or_else(|| "missing required flag: --plugin-dir".to_string())?;
    let plugin_id = plugin_id.ok_or_else(|| "missing required flag: --plugin-id".to_string())?;
    let bin = bin.ok_or_else(|| "missing required flag: --bin".to_string())?;
    let exec = exec.unwrap_or_else(|| bin.clone());

    match profile.as_str() {
        "debug" | "release" => {}
        other => {
            return Err(format!(
                "unsupported --profile '{other}' (expected debug|release)"
            ));
        }
    }

    Ok(PackageArgs {
        plugin_dir,
        plugin_id,
        package,
        bin,
        exec,
        profile,
        out_dir,
        target,
    })
}

fn parse_bundle_args(mut args: Vec<OsString>) -> Result<BundleArgs, String> {
    let mut plugin_dir: Option<PathBuf> = None;
    let mut plugin_id: Option<String> = None;
    let mut package: Option<String> = None;
    let mut bin: Option<String> = None;
    let mut exec: Option<String> = None;
    let mut profile: String = "release".to_string();
    let mut out_dir: PathBuf = PathBuf::from("dist");
    let mut targets: Vec<String> = Vec::new();

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
            "--plugin-id" => plugin_id = Some(take_value(&mut args, "--plugin-id")?),
            "--package" => package = Some(take_value(&mut args, "--package")?),
            "--bin" => bin = Some(take_value(&mut args, "--bin")?),
            "--exec" => exec = Some(take_value(&mut args, "--exec")?),
            "--profile" => profile = take_value(&mut args, "--profile")?,
            "--out" => out_dir = PathBuf::from(take_value(&mut args, "--out")?),
            "--target" => targets.push(take_value(&mut args, "--target")?),
            "--help" => return Err(usage().to_string()),
            other => return Err(format!("unknown flag: {other}")),
        }
    }

    let plugin_dir = plugin_dir.ok_or_else(|| "missing required flag: --plugin-dir".to_string())?;

    match profile.as_str() {
        "debug" | "release" => {}
        other => {
            return Err(format!(
                "unsupported --profile '{other}' (expected debug|release)"
            ));
        }
    }

    Ok(BundleArgs {
        plugin_dir,
        plugin_id,
        package,
        bin,
        exec,
        profile,
        out_dir,
        targets,
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

fn build_plugin(args: &PackageArgs) -> Result<(), String> {
    let mut cmd = Command::new("cargo");
    cmd.current_dir(&args.plugin_dir);
    cmd.arg("build");
    if args.profile == "release" {
        cmd.arg("--release");
    }
    if let Some(target) = &args.target {
        cmd.args(["--target", target]);
    }
    if let Some(pkg) = &args.package {
        cmd.args(["-p", pkg]);
    }
    cmd.args(["--bin", &args.bin]);
    run_status(cmd)
}

fn built_binary_path(plugin_dir: &Path, profile: &str, bin: &str, target: Option<&str>) -> PathBuf {
    let mut p = plugin_dir.to_path_buf();
    p.push("target");
    if let Some(target) = target {
        p.push(target);
    }
    p.push(profile);
    p.push(bin);
    if target.map(|t| t.contains("windows")).unwrap_or(cfg!(windows)) {
        p.set_extension("exe");
    }
    p
}

fn copy_with_permissions(src: &Path, dst: &Path) -> io::Result<()> {
    fs::copy(src, dst)?;
    let perm = fs::metadata(src)?.permissions();
    fs::set_permissions(dst, perm)?;
    Ok(())
}

fn package_plugin(args: &PackageArgs) -> Result<PathBuf, String> {
    let manifest_src = args.plugin_dir.join("openvcs.plugin.json");
    if !manifest_src.is_file() {
        return Err(format!(
            "missing openvcs.plugin.json at {}",
            manifest_src.display()
        ));
    }

    build_plugin(args)?;

    let bin_src = built_binary_path(&args.plugin_dir, &args.profile, &args.bin, args.target.as_deref());
    if !bin_src.is_file() {
        return Err(format!(
            "built binary not found at {} (did cargo build succeed?)",
            bin_src.display()
        ));
    }

    let bundle_dir = args.out_dir.join(&args.plugin_id);
    let bin_dir = bundle_dir.join("bin");
    fs::create_dir_all(&bin_dir)
        .map_err(|e| format!("failed to create {}: {e}", bin_dir.display()))?;

    let manifest_dst = bundle_dir.join("openvcs.plugin.json");
    fs::copy(&manifest_src, &manifest_dst).map_err(|e| {
        format!(
            "failed to copy manifest {} -> {}: {e}",
            manifest_src.display(),
            manifest_dst.display()
        )
    })?;

    let bin_dst = bin_dir.join(&args.exec);
    copy_with_permissions(&bin_src, &bin_dst).map_err(|e| {
        format!(
            "failed to copy binary {} -> {}: {e}",
            bin_src.display(),
            bin_dst.display()
        )
    })?;

    Ok(bundle_dir)
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

fn build_plugin_once(
    plugin_dir: &Path,
    profile: &str,
    bin: &str,
    package: Option<&str>,
    target: Option<&str>,
) -> Result<(), String> {
    let mut cmd = Command::new("cargo");
    cmd.current_dir(plugin_dir);
    cmd.arg("build");
    if profile == "release" {
        cmd.arg("--release");
    }
    if let Some(target) = target {
        cmd.args(["--target", target]);
    }
    if let Some(pkg) = package {
        cmd.args(["-p", pkg]);
    }
    cmd.args(["--bin", bin]);
    run_status(cmd)
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

fn bundle_plugin(args: &BundleArgs) -> Result<PathBuf, String> {
    let (manifest_id, manifest_exec) = manifest_defaults(&args.plugin_dir)?;
    let plugin_id = args
        .plugin_id
        .as_deref()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or(manifest_id);

    let bin = args
        .bin
        .as_deref()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .or_else(|| manifest_exec.clone())
        .ok_or_else(|| {
            "unable to infer --bin (manifest has no backend.exec); pass --bin explicitly".to_string()
        })?;

    let exec = args
        .exec
        .as_deref()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| bin.clone());

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

    if args.targets.is_empty() {
        build_plugin_once(
            &args.plugin_dir,
            &args.profile,
            &bin,
            args.package.as_deref(),
            None,
        )?;
        let bin_src = built_binary_path(&args.plugin_dir, &args.profile, &bin, None);
        if !bin_src.is_file() {
            return Err(format!(
                "built binary not found at {} (did cargo build succeed?)",
                bin_src.display()
            ));
        }
        copy_with_permissions(&bin_src, &bin_dir.join(&exec)).map_err(|e| {
            format!(
                "failed to copy binary {} -> {}: {e}",
                bin_src.display(),
                bin_dir.join(&exec).display()
            )
        })?;
    } else if args.targets.len() == 1 {
        let target = args.targets[0].trim();
        build_plugin_once(
            &args.plugin_dir,
            &args.profile,
            &bin,
            args.package.as_deref(),
            Some(target),
        )?;
        let bin_src = built_binary_path(&args.plugin_dir, &args.profile, &bin, Some(target));
        if !bin_src.is_file() {
            return Err(format!(
                "built binary not found at {} (did cargo build succeed?)",
                bin_src.display()
            ));
        }
        // Keep backward-compatible bin/ layout for single-target bundles.
        copy_with_permissions(&bin_src, &bin_dir.join(&exec)).map_err(|e| {
            format!(
                "failed to copy binary {} -> {}: {e}",
                bin_src.display(),
                bin_dir.join(&exec).display()
            )
        })?;
    } else {
        for target in &args.targets {
            let target = target.trim();
            if target.is_empty() {
                continue;
            }
            build_plugin_once(
                &args.plugin_dir,
                &args.profile,
                &bin,
                args.package.as_deref(),
                Some(target),
            )?;
            let bin_src = built_binary_path(&args.plugin_dir, &args.profile, &bin, Some(target));
            if !bin_src.is_file() {
                return Err(format!(
                    "built binary not found at {} (did cargo build succeed?)",
                    bin_src.display()
                ));
            }
            let target_dir = bin_dir.join(target);
            fs::create_dir_all(&target_dir)
                .map_err(|e| format!("failed to create {}: {e}", target_dir.display()))?;
            copy_with_permissions(&bin_src, &target_dir.join(&exec)).map_err(|e| {
                format!(
                    "failed to copy binary {} -> {}: {e}",
                    bin_src.display(),
                    target_dir.join(&exec).display()
                )
            })?;
        }
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

    let cmd = args
        .first()
        .cloned()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_default();

    // Convenience: allow `openvcs-plugin --plugin-dir ...` (defaults to `bundle`).
    let (command, rest) = if cmd.starts_with("--") {
        ("bundle".to_string(), args)
    } else if cmd.is_empty() {
        eprintln!("{}", usage());
        return ExitCode::from(2);
    } else {
        let mut a = args;
        a.remove(0);
        (cmd, a)
    };

    match command.as_str() {
        "package" => {
            let parsed = match parse_package_args(rest) {
                Ok(p) => p,
                Err(msg) => {
                    eprintln!("{msg}");
                    return ExitCode::from(2);
                }
            };
            match package_plugin(&parsed) {
                Ok(dir) => {
                    println!("{}", dir.display());
                    ExitCode::SUCCESS
                }
                Err(err) => {
                    eprintln!("{err}");
                    ExitCode::from(1)
                }
            }
        }
        "bundle" => {
            let parsed = match parse_bundle_args(rest) {
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
        "--help" | "help" => {
            print!("{}", usage());
            ExitCode::SUCCESS
        }
        other => {
            eprintln!("unknown command: {other}\n\n{}", usage());
            ExitCode::from(2)
        }
    }
}
