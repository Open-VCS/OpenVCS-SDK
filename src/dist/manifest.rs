//! Plugin manifest parsing.
//!
//! Provides utilities for reading and validating the OpenVCS plugin manifest
//! (`openvcs.plugin.json`).

use crate::build::read_to_string;
use crate::dist::ManifestResult;
use serde::Deserialize;
use std::path::Path;

/// Represents the `module` section of the plugin manifest.
///
/// Maps to the JSON structure:
/// ```json
/// {
///   "module": {
///     "exec": "path/to/exec.wasm"
///   }
/// }
/// ```
#[derive(Debug, Deserialize)]
struct PluginManifestModule {
    /// Path to the WASM executable (relative to plugin root).
    /// Must end with `.wasm`.
    #[serde(default)]
    exec: Option<String>,
}

/// Root plugin manifest structure.
///
/// Maps to `openvcs.plugin.json`:
/// ```json
/// {
///   "id": "com.example.my-plugin",
///   "module": {
///     "exec": "plugin.wasm"
///   }
/// }
/// ```
#[derive(Debug, Deserialize)]
struct PluginManifest {
    /// Unique identifier for the plugin.
    id: String,
    /// Optional module configuration.
    #[serde(default)]
    module: Option<PluginManifestModule>,
}

/// Parses plugin manifest text into its component parts.
///
/// # Arguments
///
/// * `text` - Raw JSON content of the manifest
/// * `manifest_path` - Path to the manifest file (for error messages)
///
/// # Returns
///
/// Returns `Ok((plugin_id, module_exec))` where:
/// - `plugin_id` - The unique plugin identifier
/// - `module_exec` - The exec path from module.exec, or `None` if not specified
///
/// # Errors
///
/// Returns an error if:
/// - The JSON is malformed
/// - The `id` field is missing or empty
pub(crate) fn parse_manifest_text(text: &str, manifest_path: &Path) -> ManifestResult {
    let manifest: PluginManifest = serde_json::from_str(text)
        .map_err(|e| format!("parse {}: {e}", manifest_path.display()))?;

    let id = manifest.id.trim().to_string();
    if id.is_empty() {
        return Err(format!(
            "manifest {} is missing a string 'id'",
            manifest_path.display()
        ));
    }

    let exec = manifest
        .module
        .and_then(|m| m.exec)
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());

    Ok((id, exec))
}

/// Loads and parses the plugin manifest from the standard location.
///
/// Looks for `openvcs.plugin.json` in the plugin directory and parses it.
///
/// # Arguments
///
/// * `plugin_dir` - Path to the plugin root directory
///
/// # Returns
///
/// Returns `Ok((plugin_id, module_exec))` on success, or `Err(String)` on failure.
///
/// # Errors
///
/// Returns an error if:
/// - The manifest file does not exist
/// - The manifest cannot be parsed
/// - The `id` field is missing or empty
pub(crate) fn manifest_defaults(plugin_dir: &Path) -> ManifestResult {
    let manifest_path = plugin_dir.join("openvcs.plugin.json");
    if !manifest_path.is_file() {
        return Err(format!(
            "missing openvcs.plugin.json at {}",
            manifest_path.display()
        ));
    }
    let text = read_to_string(&manifest_path)?;
    parse_manifest_text(&text, &manifest_path)
}
