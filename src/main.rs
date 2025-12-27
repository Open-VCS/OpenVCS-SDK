use std::env;
use std::ffi::OsString;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::process::{Command, ExitCode};

fn usage() -> &'static str {
    "openvcs-plugin <command> [args]\n\
\n\
Commands:\n\
  package   Build a plugin and assemble a bundle directory\n\
\n\
Package args:\n\
  --plugin-dir <path>   Plugin repository root (contains openvcs.plugin.json)\n\
  --plugin-id <id>      Plugin id (bundle folder name)\n\
  --bin <name>          Cargo binary name to build\n\
  --exec <name>         Executable name in manifest (default: --bin)\n\
  --profile <name>      debug|release (default: release)\n\
  --out <path>          Output directory (default: ./dist)\n\
  --target <triple>     Optional cargo --target\n\
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
            "--plugin-dir" => plugin_dir = Some(PathBuf::from(take_value(&mut args, "--plugin-dir")?)),
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
        other => return Err(format!("unsupported --profile '{other}' (expected debug|release)")),
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

fn built_binary_path(args: &PackageArgs) -> PathBuf {
    let mut p = args.plugin_dir.clone();
    p.push("target");
    if let Some(target) = &args.target {
        p.push(target);
    }
    p.push(&args.profile);
    p.push(&args.bin);
    if cfg!(windows) {
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

    let bin_src = built_binary_path(args);
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

fn main() -> ExitCode {
    let mut args: Vec<OsString> = env::args_os().collect();
    let _exe = args.remove(0);

    let Some(command) = args.first().cloned() else {
        eprintln!("{}", usage());
        return ExitCode::from(2);
    };
    args.remove(0);

    let cmd = command.to_string_lossy().to_string();
    match cmd.as_str() {
        "package" => {
            let parsed = match parse_package_args(args) {
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

