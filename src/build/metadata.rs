// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

//! Cargo metadata extraction.
//!
//! Provides utilities for reading and parsing `cargo metadata` output
//! to extract package information and target directories.

use serde::Deserialize;
use std::path::{Path, PathBuf};
use std::process::Command;

/// Represents the JSON output of `cargo metadata`.
#[derive(Debug, Deserialize)]
pub(crate) struct CargoMetadata {
    /// Path to the cargo target directory.
    pub(crate) target_directory: PathBuf,
    /// List of packages in the workspace.
    #[serde(default)]
    pub(crate) packages: Vec<CargoMetadataPackage>,
}

/// Represents a package in cargo metadata.
#[derive(Debug, Deserialize)]
pub(crate) struct CargoMetadataPackage {
    /// Name of the package.
    pub(crate) name: String,
    /// Path to the package manifest.
    #[cfg(test)]
    #[serde(default)]
    pub(crate) manifest_path: String,
}

/// Runs `cargo metadata` for a plugin and parses the output.
///
/// # Arguments
///
/// * `plugin_dir` - Path to the plugin root (must contain `Cargo.toml`)
///
/// # Returns
///
/// Returns `Some(CargoMetadata)` on success, or `None` if the command fails.
pub(crate) fn cargo_metadata(plugin_dir: &Path) -> Option<CargoMetadata> {
    let manifest_path = plugin_dir.join("Cargo.toml");
    let output = Command::new("cargo")
        .arg("metadata")
        .arg("--format-version")
        .arg("1")
        .arg("--no-deps")
        .arg("--manifest-path")
        .arg(&manifest_path)
        .output();

    let output = match output {
        Ok(output) if output.status.success() => output,
        _ => return None,
    };

    serde_json::from_slice::<CargoMetadata>(&output.stdout).ok()
}

/// Resolves the cargo target directory for a plugin.
///
/// Queries cargo metadata for the target directory, falling back to
/// `./target` in the plugin directory if metadata is unavailable.
///
/// # Arguments
///
/// * `plugin_dir` - Path to the plugin root
///
/// # Returns
///
/// Path to the cargo target directory.
pub(crate) fn resolve_target_dir(plugin_dir: &Path) -> PathBuf {
    cargo_metadata(plugin_dir)
        .map(|m| m.target_directory)
        .unwrap_or_else(|| plugin_dir.join("target"))
}

#[cfg(test)]
/// Finds the package name for a specific manifest path.
///
/// Used in tests to match packages by their Cargo.toml location.
pub(crate) fn package_name_for_manifest(plugin_dir: &Path) -> Option<String> {
    let manifest_path = plugin_dir.join("Cargo.toml");
    let manifest = manifest_path.to_string_lossy().replace('\\', "/");
    let metadata = cargo_metadata(plugin_dir)?;
    metadata
        .packages
        .iter()
        .find(|p| p.manifest_path.replace('\\', "/") == manifest)
        .map(|p| p.name.clone())
        .or_else(|| metadata.packages.first().map(|p| p.name.clone()))
}
