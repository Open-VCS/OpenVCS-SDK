use crate::build::read_to_string;
use crate::dist::ManifestResult;
use serde::Deserialize;
use std::path::Path;

#[derive(Debug, Deserialize)]
struct PluginManifestModule {
    #[serde(default)]
    exec: Option<String>,
}

#[derive(Debug, Deserialize)]
struct PluginManifest {
    id: String,
    #[serde(default)]
    module: Option<PluginManifestModule>,
}

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
