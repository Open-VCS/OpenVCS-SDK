// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

//! Plugin distribution and bundling utilities.
//!
//! This module provides the core functionality for packaging OpenVCS plugins
//! into distributable `.ovcsp` archives. It handles:
//!
//! - Parsing plugin manifests (`openvcs.plugin.json`)
//! - Building WASM modules for the `wasm32-wasip1` target
//! - Validating and copying plugin assets (icons, themes)
//! - Creating tar.xz archives suitable for distribution
//!
//! # Example
//!
//! ```ignore
//! use openvcs_sdk::dist::{bundle_plugin, parse_args, PluginBuildArgs};
//!
//! // Parse command-line arguments
//! let args = parse_args(std::env::args_os().collect()).unwrap();
//!
//! // Bundle the plugin
//! let output_path = bundle_plugin(&args).unwrap();
//! println!("Bundled to: {}", output_path.display());
//! ```

pub mod args;
pub mod bundle;
pub(crate) mod fsops;
pub(crate) mod manifest;

use std::env;
use std::ffi::OsString;
use std::path::PathBuf;
use std::process::ExitCode;

pub use args::parse_args;
pub use bundle::bundle_plugin;

/// Arguments required to build and bundle a plugin.
///
/// This struct contains all the necessary paths and configuration
/// needed by [`bundle_plugin`] to create a distributable plugin archive.
///
/// # Fields
///
/// * `plugin_dir` - Path to the plugin root directory (must contain `openvcs.plugin.json`)
/// * `out_dir` - Directory where the `.ovcsp` bundle will be written (default: `./dist`)
#[derive(Debug)]
pub struct PluginBuildArgs {
    /// Path to the plugin repository root.
    ///
    /// This directory must contain:
    /// - `openvcs.plugin.json` (plugin manifest)
    /// - `src/lib.rs` (for WASM plugins)
    /// - Optional: `themes/` directory, icon files
    pub plugin_dir: PathBuf,

    /// Output directory for the generated `.ovcsp` bundle.
    ///
    /// Defaults to `./dist` if not specified.
    pub out_dir: PathBuf,
}

// Reduce clippy type complexity warnings for manifest parsing results.
type ManifestResult = Result<(String, Option<String>), String>;

/// Runs the plugin CLI workflow.
///
/// This function parses command-line arguments, builds the plugin WASM module
/// (if present), copies assets, and creates a distributable `.ovcsp` archive.
///
/// # Arguments
///
/// Expects command-line arguments in the format:
/// ```text
/// openvcs-plugin --plugin-dir <path> --out <path>
/// ```
///
/// # Returns
///
/// Returns [`ExitCode::SUCCESS`] on successful bundling,
/// [`ExitCode::FAILURE`] (1) on build errors, or
/// [`ExitCode::FAILURE`] (2) on argument parsing errors.
///
/// # Errors
///
/// Returns an error if:
/// - The plugin manifest is missing or invalid
/// - WASM build fails
/// - Asset copying fails
/// - Archive creation fails
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
