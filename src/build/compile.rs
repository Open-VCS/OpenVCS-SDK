use crate::build::metadata::cargo_metadata;
use crate::build::wasm::ensure_component_module;
use std::path::{Path, PathBuf};
use std::process::Command;

fn rustc_target_list() -> Option<Vec<String>> {
    let out = Command::new("rustc")
        .args(["--print", "target-list"])
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    let s = String::from_utf8_lossy(&out.stdout);
    Some(
        s.lines()
            .map(str::trim)
            .filter(|l| !l.is_empty())
            .map(|l| l.to_string())
            .collect(),
    )
}

pub(crate) fn build_plugin_wasi(
    plugin_dir: &Path,
    target_dir: &Path,
    _bin: &str,
) -> Result<PathBuf, String> {
    let available = rustc_target_list().unwrap_or_default();
    let supports_wasip1 = available.is_empty() || available.iter().any(|t| t == "wasm32-wasip1");
    let supports_legacy = available.is_empty() || available.iter().any(|t| t == "wasm32-wasi");

    let mut targets: Vec<&str> = Vec::new();
    if supports_wasip1 {
        targets.push("wasm32-wasip1");
    }
    if supports_legacy {
        targets.push("wasm32-wasi");
    }
    if targets.is_empty() {
        return Err("no supported WASI targets found (expected wasm32-wasip1)".to_string());
    }

    let has_lib = plugin_dir.join("src").join("lib.rs").is_file();
    if !has_lib {
        return Err("missing src/lib.rs - plugins must be libraries with lib.rs".to_string());
    }

    for target in targets {
        let result = build_plugin_lib(plugin_dir, target_dir, target);
        if let Ok(wasm_path) = result {
            ensure_component_module(&wasm_path)?;
            return Ok(wasm_path);
        }
    }

    Err(format!(
        "failed to build plugin for wasm32-wasip1 or wasm32-wasi"
    ))
}

fn build_plugin_lib(plugin_dir: &Path, target_dir: &Path, target: &str) -> Result<PathBuf, String> {
    let pkg_name = get_crate_name(plugin_dir)?;
    let wasm_name = format!("{}.wasm", pkg_name.replace('-', "_"));
    let release_dir = target_dir.join(target).join("release");
    let wasm_path = release_dir.join(&wasm_name);

    let mut cmd = Command::new("cargo");
    cmd.current_dir(plugin_dir);
    cmd.arg("build");
    cmd.arg("--lib");
    cmd.arg("--release");
    cmd.arg("--target");
    cmd.arg(target);
    cmd.arg("--manifest-path");
    cmd.arg(plugin_dir.join("Cargo.toml"));

    let output = cmd
        .output()
        .map_err(|e| format!("cargo build failed: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("build failed: {}", stderr));
    }

    if !wasm_path.exists() {
        return Err(format!("expected wasm at {}", wasm_path.display()));
    }

    Ok(wasm_path)
}

fn get_crate_name(plugin_dir: &Path) -> Result<String, String> {
    let metadata =
        cargo_metadata(plugin_dir).ok_or_else(|| "failed to get cargo metadata".to_string())?;

    metadata
        .packages
        .into_iter()
        .next()
        .map(|p| p.name)
        .ok_or_else(|| "no packages found in cargo metadata".to_string())
}
