use crate::build::shim::build_plugin_shim_target;
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

    let has_plugin_entry = plugin_dir.join("src").join("plugin_entry.rs").is_file();
    if !has_plugin_entry {
        return Err(
            "missing src/plugin_entry.rs - plugins must be libraries with plugin_entry.rs"
                .to_string(),
        );
    }

    let mut errors = Vec::new();
    for target in targets {
        match build_plugin_shim_target(plugin_dir, target_dir, target) {
            Ok(path) => {
                ensure_component_module(&path)?;
                return Ok(path);
            }
            Err(shim_err) => errors.push(format!("{target}: shim: {shim_err}")),
        };
    }

    Err(format!(
        "failed to build plugin for wasm32-wasip1 or wasm32-wasi ({})",
        errors.join(" | ")
    ))
}
