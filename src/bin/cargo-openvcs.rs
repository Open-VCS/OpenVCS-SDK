//! `cargo openvcs` subcommand binary.
//!
//! This binary provides the `cargo openvcs dist` command for bundling OpenVCS plugins.
//! It can be invoked as either `cargo openvcs dist` or `cargo-openvcs dist`.
//!
//! # Usage
//!
//! ```text
//! cargo openvcs dist [--plugin-dir <path>] [--out <path>] [--all] [--fix]
//! ```
//!
//! # Options
//!
//! - `--plugin-dir <path>` - Bundle a specific plugin directory
//! - `--out <path>` - Output directory (default: `./dist`)
//! - `--all` - Bundle all plugins found in subdirectories
//! - `--fix` - Run `cargo fix` before bundling (Rust plugins only)
//!
//! # Exit Codes
//!
//! - `0` - Success
//! - `1` - Error

use openvcs_sdk::dist::{PluginBuildArgs, bundle_plugin};
use std::env;
use std::ffi::OsString;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::ExitCode;

/// Prints usage information to stderr.
fn print_usage() {
    eprintln!(
        "Usage: cargo openvcs dist [--plugin-dir <path>] [--out <path>] [--fix]

Defaults:
- If run inside a plugin folder (contains openvcs.plugin.json), bundles that plugin.
- Otherwise, pass --all to bundle all plugin subfolders (one per subfolder containing openvcs.plugin.json).
Default output directory: ./dist

Options:
- --all: bundle all plugins in the target directory
- --fix: run `cargo fix` in Rust plugin directories before bundling
"
    );
}

/// Checks if a directory contains a plugin manifest.
///
/// Returns true if `openvcs.plugin.json` exists in the directory.
fn is_plugin_dir(dir: &Path) -> bool {
    dir.join("openvcs.plugin.json").is_file()
}

/// Checks if a directory contains a Rust plugin.
///
/// Returns true if `Cargo.toml` exists in the directory,
/// indicating this is a Rust-based plugin that can be built.
fn is_rust_plugin_dir(dir: &Path) -> bool {
    dir.join("Cargo.toml").is_file()
}

/// Discovers all plugin directories in a root directory.
///
/// Scans subdirectories of the given root and returns paths that
/// contain valid plugin manifests (`openvcs.plugin.json`).
///
/// # Arguments
///
/// * `root` - Root directory to scan
///
/// # Returns
///
/// Returns `Ok(Vec<PathBuf>)` with sorted list of plugin directories,
/// or `Err(String)` if scanning fails.
fn discover_plugin_dirs(root: &Path) -> Result<Vec<PathBuf>, String> {
    let mut out = Vec::new();
    for entry in fs::read_dir(root).map_err(|e| format!("read_dir {}: {e}", root.display()))? {
        let entry = entry.map_err(|e| format!("read_dir entry: {e}"))?;
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        if is_plugin_dir(path.as_path()) {
            out.push(path);
        }
    }
    out.sort();
    Ok(out)
}

/// Runs `cargo fix` in the specified plugin directory.
///
/// Attempts to fix the plugin code before bundling. First tries
/// `wasm32-wasip1` target, then falls back to host target if unavailable.
///
/// # Arguments
///
/// * `dir` - Path to the plugin directory
///
/// # Returns
///
/// Returns `Ok(())` if cargo fix succeeds, or `Err(String)` on failure.
fn run_cargo_fix(dir: &Path) -> Result<(), String> {
    let mut cmd = std::process::Command::new("cargo");
    cmd.current_dir(dir);
    cmd.arg("fix");
    cmd.arg("--allow-dirty");
    cmd.arg("--allow-staged");

    // Prefer fixing in the wasm32-wasip1 configuration (plugins are compiled to WASI).
    // If the target isn't available, fall back to a host-target fix.
    let status = cmd
        .arg("--target")
        .arg("wasm32-wasip1")
        .status()
        .map_err(|e| format!("failed to spawn cargo fix: {e}"))?;
    if status.success() {
        return Ok(());
    }

    let status = std::process::Command::new("cargo")
        .current_dir(dir)
        .arg("fix")
        .arg("--allow-dirty")
        .arg("--allow-staged")
        .status()
        .map_err(|e| format!("failed to spawn cargo fix: {e}"))?;
    if status.success() {
        Ok(())
    } else {
        Err(format!(
            "cargo fix failed in {} (code {:?})",
            dir.display(),
            status.code()
        ))
    }
}

/// Processes the `dist` command arguments and bundles plugins.
///
/// # Arguments
///
/// * `args` - Command-line arguments following `dist`
///
/// # Returns
///
/// Returns `Ok(Vec<PathBuf>)` containing paths to created bundles,
/// or `Err(String)` on failure.
fn run_dist_command(args: &[OsString]) -> Result<Vec<PathBuf>, String> {
    let cwd =
        env::current_dir().map_err(|e| format!("failed to determine current directory: {e}"))?;
    let mut plugin_dir: Option<PathBuf> = None;
    let mut out_dir = cwd.join("dist");
    let mut all = false;
    let mut fix = false;
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
            "--fix" => {
                fix = true;
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
        return Err(
            "no plugins found (expected subfolders containing openvcs.plugin.json)".to_string(),
        );
    }

    let mut out_paths = Vec::new();
    for dir in plugin_dirs {
        if fix && is_rust_plugin_dir(&dir) {
            run_cargo_fix(&dir)?;
        }
        let parsed = PluginBuildArgs {
            plugin_dir: dir,
            out_dir: out_dir.clone(),
        };
        let path = bundle_plugin(&parsed)?;
        out_paths.push(path);
    }
    Ok(out_paths)
}

/// Entry point for the `cargo openvcs` subcommand.
///
/// Handles the `dist` subcommand and routes to [`run_dist_command`].
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
