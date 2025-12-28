use openvcs_sdk::dist::{bundle_plugin, PluginBuildArgs};
use std::env;
use std::ffi::OsString;
use std::fs;
use std::path::PathBuf;
use std::process::ExitCode;

fn print_usage() {
    eprintln!(
        "Usage: cargo openvcs dist [--plugin-dir <path>] [--out <path>]

Defaults:
- If run inside a plugin folder (contains openvcs.plugin.json), bundles that plugin.
- Otherwise, pass --all to bundle all plugin subfolders (one per subfolder containing openvcs.plugin.json).
Default output directory: ./dist
"
    );
}

fn is_plugin_dir(dir: &PathBuf) -> bool {
    dir.join("openvcs.plugin.json").is_file()
}

fn discover_plugin_dirs(root: &PathBuf) -> Result<Vec<PathBuf>, String> {
    let mut out = Vec::new();
    for entry in fs::read_dir(root).map_err(|e| format!("read_dir {}: {e}", root.display()))? {
        let entry = entry.map_err(|e| format!("read_dir entry: {e}"))?;
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        if is_plugin_dir(&path) {
            out.push(path);
        }
    }
    out.sort();
    Ok(out)
}

fn run_dist_command(args: &[OsString]) -> Result<Vec<PathBuf>, String> {
    let cwd = env::current_dir()
        .map_err(|e| format!("failed to determine current directory: {e}"))?;
    let mut plugin_dir: Option<PathBuf> = None;
    let mut out_dir = cwd.join("dist");
    let mut all = false;
    let mut iter = args.iter();
    while let Some(arg) = iter.next() {
        let s = arg.to_string_lossy();
        match s.as_ref() {
            "--plugin-dir" => {
                let value = iter
                    .next()
                    .ok_or_else(|| "missing value for --plugin-dir".to_string())?;
                plugin_dir = Some(PathBuf::from(value));
            }
            "--out" => {
                let value = iter
                    .next()
                    .ok_or_else(|| "missing value for --out".to_string())?;
                out_dir = PathBuf::from(value);
            }
            "--all" => {
                all = true;
            }
            "--help" => {
                print_usage();
                return Err(String::new());
            }
            other => return Err(format!("unknown argument: {other}")),
        }
    }

    let plugin_dirs = match (all, plugin_dir) {
        (true, Some(p)) => {
            let p = if p.is_absolute() { p } else { cwd.join(p) };
            if is_plugin_dir(&p) {
                vec![p]
            } else {
                discover_plugin_dirs(&p)?
            }
        }
        (true, None) => discover_plugin_dirs(&cwd)?,
        (false, Some(p)) => {
            let p = if p.is_absolute() { p } else { cwd.join(p) };
            vec![p]
        }
        (false, None) => {
            if is_plugin_dir(&cwd) {
                vec![cwd]
            } else {
                print_usage();
                return Err("not in a plugin folder; pass --plugin-dir or --all".to_string());
            }
        }
    };

    if plugin_dirs.is_empty() {
        return Err("no plugins found (expected subfolders containing openvcs.plugin.json)".to_string());
    }

    let mut out_paths = Vec::new();
    for dir in plugin_dirs {
        let parsed = PluginBuildArgs {
            plugin_dir: dir,
            out_dir: out_dir.clone(),
        };
        let path = bundle_plugin(&parsed)?;
        out_paths.push(path);
    }
    Ok(out_paths)
}

fn main() -> ExitCode {
    let mut args: Vec<OsString> = env::args_os().skip(1).collect();
    // Some environments may invoke `cargo-openvcs` as `cargo openvcs ...` but still pass
    // the subcommand name as the first argument. Tolerate both shapes:
    // - ["dist", ...]
    // - ["openvcs", "dist", ...]
    if matches!(args.first().and_then(|a| a.to_str()), Some("openvcs")) {
        args.remove(0);
    }
    match args.first().and_then(|a| a.to_str()) {
        Some("dist") => {
            args.remove(0);
            match run_dist_command(&args) {
                Ok(paths) => {
                    for path in paths {
                        println!("{}", path.display());
                    }
                    ExitCode::SUCCESS
                }
                Err(err) => {
                    if err.is_empty() {
                        ExitCode::SUCCESS
                    } else {
                        eprintln!("{err}");
                        ExitCode::FAILURE
                    }
                }
            }
        }
        _ => {
            print_usage();
            ExitCode::FAILURE
        }
    }
}
