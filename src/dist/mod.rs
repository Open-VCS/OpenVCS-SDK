mod args;
mod build;
mod bundle;
mod fsops;
mod manifest;
mod metadata;
mod util;

use std::env;
use std::ffi::OsString;
use std::path::PathBuf;
use std::process::ExitCode;

pub use args::parse_args;
pub use bundle::bundle_plugin;

#[cfg(test)]
pub(crate) use build::{built_wasm_bin_path, platform_exec_filename};
#[cfg(test)]
pub(crate) use fsops::{copy_dir_recursive, ICON_EXTENSIONS};
#[cfg(test)]
pub(crate) use manifest::{manifest_defaults, parse_manifest_text};
#[cfg(test)]
pub(crate) use metadata::CargoMetadata;

#[derive(Debug)]
pub struct PluginBuildArgs {
    pub plugin_dir: PathBuf,
    pub out_dir: PathBuf,
}

// Reduce clippy type complexity warnings for manifest parsing results.
type ManifestResult = Result<(String, Option<String>), String>;

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
mod tests;
