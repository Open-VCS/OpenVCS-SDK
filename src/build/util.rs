// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

//! Shared utility functions.
//!
//! Provides helper functions used across the build pipeline.

use std::fs;
use std::path::Path;

/// Reads a file into a string, with improved error messages.
///
/// # Arguments
///
/// * `path` - Path to the file to read
///
/// # Returns
///
/// Returns `Ok(String)` with file contents, or `Err(String)` with error details.
pub(crate) fn read_to_string(path: &Path) -> Result<String, String> {
    fs::read_to_string(path).map_err(|e| format!("read {}: {e}", path.display()))
}
#[cfg(test)]
use std::path::PathBuf;

/// Checks if a source file contains a public function with the given name.
///
/// Used in tests to verify plugin source code structure.
#[cfg(test)]
pub(crate) fn has_pub_fn(path: &Path, fn_name: &str) -> bool {
    read_to_string(path)
        .ok()
        .is_some_and(|s| s.contains(&format!("pub fn {fn_name}(")))
}

/// Finds the path to the local OpenVCS Core crate.
///
/// Searches from the plugin directory upward to find a `Core/Cargo.toml`.
#[cfg(test)]
pub(crate) fn find_local_core_path(plugin_dir: &Path) -> Option<PathBuf> {
    for ancestor in plugin_dir.ancestors() {
        let candidate = ancestor.join("Core").join("Cargo.toml");
        if candidate.is_file() {
            return Some(ancestor.join("Core"));
        }
    }
    None
}

/// Escapes a string for use in TOML values.
///
/// Escapes backslashes and double quotes.
#[cfg(test)]
pub(crate) fn toml_escape(value: &str) -> String {
    value.replace('\\', "\\\\").replace('"', "\\\"")
}
