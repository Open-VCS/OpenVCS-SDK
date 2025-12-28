use openvcs_sdk::dist::{bundle_plugin, parse_args};
use std::env;
use std::ffi::OsString;
use std::path::PathBuf;
use std::process::ExitCode;

fn print_usage() {
    eprintln!(
        "Usage: cargo openvcs dist [--plugin-dir <path>] [--out <path>]
Default: current directory, ./dist
"
    );
}

fn run_dist_command(args: &[OsString]) -> Result<PathBuf, String> {
    let mut plugin_dir = env::current_dir()
        .map_err(|e| format!("failed to determine current directory: {e}"))?;
    let mut out_dir = plugin_dir.join("dist");
    let mut iter = args.iter();
    while let Some(arg) = iter.next() {
        let s = arg.to_string_lossy();
        match s.as_ref() {
            "--plugin-dir" => {
                let value = iter
                    .next()
                    .ok_or_else(|| "missing value for --plugin-dir".to_string())?;
                plugin_dir = PathBuf::from(value);
            }
            "--out" => {
                let value = iter
                    .next()
                    .ok_or_else(|| "missing value for --out".to_string())?;
                out_dir = PathBuf::from(value);
            }
            "--help" => {
                print_usage();
                return Err(String::new());
            }
            other => return Err(format!("unknown argument: {other}")),
        }
    }

    let mut parse_args_vec = Vec::new();
    parse_args_vec.push(OsString::from("--plugin-dir"));
    parse_args_vec.push(plugin_dir.into_os_string());
    parse_args_vec.push(OsString::from("--out"));
    parse_args_vec.push(out_dir.into_os_string());

    let parsed = parse_args(parse_args_vec)?;
    bundle_plugin(&parsed)
}

fn main() -> ExitCode {
    let mut args: Vec<OsString> = env::args_os().skip(1).collect();
    match args.first().and_then(|a| a.to_str()) {
        Some("dist") => {
            args.remove(0);
            match run_dist_command(&args) {
                Ok(path) => {
                    println!("{}", path.display());
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
