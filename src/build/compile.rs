use crate::build::shim::build_plugin_shim_target;
use crate::build::util::run_status;
use crate::build::wasm::{built_wasm_bin_path, ensure_component_module};
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

fn build_plugin_bin_target(
    plugin_dir: &Path,
    target_dir: &Path,
    bin: &str,
    target: &str,
) -> Result<PathBuf, String> {
    let manifest_path = plugin_dir.join("Cargo.toml");
    let mut cmd = Command::new("cargo");
    cmd.current_dir(plugin_dir);
    cmd.arg("build");
    cmd.arg("--release");
    cmd.arg("--locked");
    cmd.arg("--manifest-path");
    cmd.arg(&manifest_path);
    cmd.arg("--target-dir");
    cmd.arg(target_dir);
    cmd.args(["--bin", bin]);
    cmd.args(["--target", target]);
    run_status(cmd)?;
    Ok(built_wasm_bin_path(target_dir, target, bin))
}

pub(crate) fn build_plugin_wasi(
    plugin_dir: &Path,
    target_dir: &Path,
    bin: &str,
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
    let has_bin_target = plugin_dir.join("src").join("main.rs").is_file()
        || plugin_dir
            .join("src")
            .join("bin")
            .join(format!("{bin}.rs"))
            .is_file();
    let mut errors = Vec::new();
    for target in targets {
        if has_bin_target {
            match build_plugin_bin_target(plugin_dir, target_dir, bin, target) {
                Ok(path) => {
                    ensure_component_module(&path)?;
                    return Ok(path);
                }
                Err(bin_err) => {
                    errors.push(format!("{target}: bin: {bin_err}"));
                }
            }
        }

        if has_plugin_entry {
            match build_plugin_shim_target(plugin_dir, target_dir, target) {
                Ok(path) => {
                    ensure_component_module(&path)?;
                    return Ok(path);
                }
                Err(shim_err) => errors.push(format!("{target}: shim: {shim_err}")),
            };
        }
    }

    if errors.is_empty() {
        Err("failed to build plugin for wasm32-wasip1 or wasm32-wasi".to_string())
    } else {
        Err(format!(
            "failed to build plugin for wasm32-wasip1 or wasm32-wasi ({})",
            errors.join(" | ")
        ))
    }
}
