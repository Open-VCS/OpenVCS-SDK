// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

//! Plugin distribution and bundling utilities.
//!
//! This module provides the core functionality for packaging OpenVCS plugins
//! into distributable `.ovcsp` archives. It handles:
//!
//! - Parsing plugin manifests (`openvcs.plugin.json`)
//! - Validating Node module entrypoints under `bin/`
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

use std::path::PathBuf;

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
/// * `verbose` - Enable verbose output
#[derive(Debug)]
pub struct PluginBuildArgs {
    /// Path to the plugin repository root.
    ///
    /// This directory must contain:
    /// - `openvcs.plugin.json` (plugin manifest)
    /// - `bin/<module.exec>` (for runtime plugins)
    /// - Optional: `themes/` directory, icon files
    pub plugin_dir: PathBuf,

    /// Output directory for the generated `.ovcsp` bundle.
    ///
    /// Defaults to `./dist` if not specified.
    pub out_dir: PathBuf,

    /// Enable verbose output.
    ///
    /// When enabled, prints additional information about build steps,
    /// file operations, and progress.
    pub verbose: bool,
}

// Reduce clippy type complexity warnings for manifest parsing results.
type ManifestResult = Result<(String, Option<String>), String>;
