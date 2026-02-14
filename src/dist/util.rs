use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

pub(crate) fn run_status(mut cmd: Command) -> Result<(), String> {
    let status = cmd
        .status()
        .map_err(|e| format!("failed to spawn process: {e}"))?;
    if status.success() {
        Ok(())
    } else {
        Err(format!("command failed with {status}"))
    }
}

pub(crate) fn read_to_string(path: &Path) -> Result<String, String> {
    fs::read_to_string(path).map_err(|e| format!("read {}: {e}", path.display()))
}

pub(crate) fn has_pub_fn(path: &Path, fn_name: &str) -> bool {
    read_to_string(path)
        .ok()
        .is_some_and(|s| s.contains(&format!("pub fn {fn_name}(")))
}

pub(crate) fn find_local_core_path(plugin_dir: &Path) -> Option<PathBuf> {
    for ancestor in plugin_dir.ancestors() {
        let candidate = ancestor.join("Core").join("Cargo.toml");
        if candidate.is_file() {
            return Some(ancestor.join("Core"));
        }
    }
    None
}

pub(crate) fn toml_escape(value: &str) -> String {
    value.replace('\\', "\\\\").replace('"', "\\\"")
}
