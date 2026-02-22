// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

use crate::dist::PluginBuildArgs;
use std::env;
use std::ffi::OsString;
use std::path::PathBuf;

/// Returns the usage string for the plugin CLI.
///
/// This text is displayed when the user passes `--help` or provides
/// invalid arguments.
pub(crate) fn usage() -> &'static str {
    "cargo openvcs dist [args]\n\
\n\
  --plugin-dir <path>   Plugin repository root (contains openvcs.plugin.json)\n\
  --out <path>          Output directory (default: ./dist)\n\
  -V, --verbose         Enable verbose output\n\
\n\
Builds plugin executables and packages them into a single `.ovcsp` tar.xz.\n"
}

fn take_value(args: &mut Vec<OsString>, flag: &str) -> Result<String, String> {
    if args.is_empty() {
        return Err(format!("missing value for {flag}"));
    }
    Ok(args.remove(0).to_string_lossy().to_string())
}

/// Parses command-line arguments into [`PluginBuildArgs`].
///
/// # Arguments
///
/// * `args` - Command-line arguments (typically from `std::env::args_os()`)
///
/// # Supported Flags
///
/// * `--plugin-dir <path>` - Path to the plugin root directory
/// * `--out <path>` - Output directory (default: `./dist`)
/// * `-V, --verbose` - Enable verbose output
/// * `--help` - Display usage information
///
/// # Returns
///
/// Returns `Ok(PluginBuildArgs)` on success, or `Err(String)` containing
/// an error message (which may be the usage text for `--help`).
///
/// # Defaults
///
/// If `--plugin-dir` is not provided, defaults to the current working directory.
/// If `--out` is not provided, defaults to `./dist`.
pub fn parse_args(mut args: Vec<OsString>) -> Result<PluginBuildArgs, String> {
    let mut plugin_dir: Option<PathBuf> = None;
    let mut out_dir = PathBuf::from("dist");
    let mut verbose = false;

    while let Some(arg) = args.first().cloned() {
        let s = arg.to_string_lossy();
        if !s.starts_with("--") && s != "-V" {
            return Err(format!("unexpected argument: {s}"));
        }
        args.remove(0);
        match s.as_ref() {
            "--plugin-dir" => {
                plugin_dir = Some(PathBuf::from(take_value(&mut args, "--plugin-dir")?))
            }
            "--out" => out_dir = PathBuf::from(take_value(&mut args, "--out")?),
            "-V" | "--verbose" => verbose = true,
            "--help" => return Err(usage().to_string()),
            other => return Err(format!("unknown flag: {other}")),
        }
    }

    let plugin_dir =
        plugin_dir.unwrap_or_else(|| env::current_dir().unwrap_or_else(|_| PathBuf::from(".")));
    Ok(PluginBuildArgs {
        plugin_dir,
        out_dir,
        verbose,
    })
}
