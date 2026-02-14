use serde::Deserialize;
use std::path::{Path, PathBuf};
use std::process::Command;

#[derive(Debug, Deserialize)]
pub(crate) struct CargoMetadata {
    pub(crate) target_directory: PathBuf,
    #[serde(default)]
    packages: Vec<CargoMetadataPackage>,
}

#[derive(Debug, Deserialize)]
struct CargoMetadataPackage {
    name: String,
    manifest_path: String,
}

fn cargo_metadata(plugin_dir: &Path) -> Option<CargoMetadata> {
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

pub(crate) fn resolve_target_dir(plugin_dir: &Path) -> PathBuf {
    cargo_metadata(plugin_dir)
        .map(|m| m.target_directory)
        .unwrap_or_else(|| plugin_dir.join("target"))
}

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
