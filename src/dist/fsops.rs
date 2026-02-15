//! Filesystem operations for plugin bundling.
//!
//! Provides utilities for staging, copying, and archiving plugin files.

use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

/// Supported icon file extensions.
///
/// Plugins may include an icon file named `icon.{ext}` where ext is one
/// of these values.
pub(crate) const ICON_EXTENSIONS: &[&str] = &["png", "jpg", "jpeg", "webp", "avif", "svg"];

/// Creates a unique staging directory for bundle creation.
///
/// Uses the current timestamp in milliseconds to create a directory
/// that is unlikely to conflict with concurrent builds.
///
/// # Arguments
///
/// * `out_dir` - Parent directory for the staging directory
///
/// # Returns
///
/// Path to the created staging directory (e.g., `.openvcs-plugin-staging-1234567890`)
pub(crate) fn unique_staging_dir(out_dir: &Path) -> PathBuf {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    out_dir.join(format!(".openvcs-plugin-staging-{now}"))
}

/// Recursively checks that a directory contains no symlinks.
///
/// This is a security measure to prevent symlink attacks in plugin bundles.
///
/// # Arguments
///
/// * `dir` - Directory to check
///
/// # Returns
///
/// Returns `Ok(())` if no symlinks are found, or `Err(String)` if a symlink exists.
///
/// # Errors
///
/// Returns an error if any file or subdirectory is a symbolic link.
pub(crate) fn reject_symlinks_recursive(dir: &Path) -> Result<(), String> {
    let entries = fs::read_dir(dir).map_err(|e| format!("read_dir {}: {e}", dir.display()))?;
    for entry in entries {
        let entry = entry.map_err(|e| format!("read_dir entry: {e}"))?;
        let path = entry.path();
        let meta =
            fs::symlink_metadata(&path).map_err(|e| format!("metadata {}: {e}", path.display()))?;
        if meta.file_type().is_symlink() {
            return Err(format!("plugin contains a symlink: {}", path.display()));
        }
        if meta.is_dir() {
            reject_symlinks_recursive(&path)?;
        }
    }
    Ok(())
}

/// Creates a tar.xz archive from a directory.
///
/// # Arguments
///
/// * `out_path` - Path for the output `.tar.xz` file
/// * `base_dir` - Base directory containing the folder to archive
/// * `folder_name` - Name of the folder to archive (relative to base_dir)
///
/// # Returns
///
/// Returns `Ok(())` on success, or `Err(String)` on failure.
///
/// # Errors
///
/// Returns an error if:
/// - The directory contains symlinks (security check)
/// - File operations fail
/// - Tar or xz encoding fails
pub(crate) fn write_tar_xz(
    out_path: &Path,
    base_dir: &Path,
    folder_name: &str,
) -> Result<(), String> {
    let root = base_dir.join(folder_name);
    reject_symlinks_recursive(&root)?;

    let out = fs::File::create(out_path)
        .map_err(|e| format!("failed to create {}: {e}", out_path.display()))?;
    let encoder = xz2::write::XzEncoder::new(out, 6);
    let mut builder = tar::Builder::new(encoder);
    builder
        .append_dir_all(folder_name, &root)
        .map_err(|e| format!("tar append_dir_all failed: {e}"))?;

    let encoder = builder
        .into_inner()
        .map_err(|e| format!("tar finish failed: {e}"))?;
    encoder
        .finish()
        .map_err(|e| format!("xz finish failed: {e}"))?;
    Ok(())
}

/// Recursively copies a directory tree.
///
/// # Arguments
///
/// * `src` - Source directory to copy from
/// * `dst` - Destination directory to copy to
///
/// # Returns
///
/// Returns `Ok(())` on success, or `Err(String)` on failure.
///
/// # Behavior
///
/// - Creates the destination directory if it doesn't exist
/// - Copies all files and subdirectories recursively
/// - Does nothing if source doesn't exist
/// - Returns an error if source is not a directory
pub(crate) fn copy_dir_recursive(src: &Path, dst: &Path) -> Result<(), String> {
    if !src.exists() {
        return Ok(());
    }
    if !src.is_dir() {
        return Err(format!("expected directory: {}", src.display()));
    }
    fs::create_dir_all(dst).map_err(|e| format!("mkdir {}: {e}", dst.display()))?;
    for entry in fs::read_dir(src).map_err(|e| format!("read_dir {}: {e}", src.display()))? {
        let entry = entry.map_err(|e| format!("read_dir entry: {e}"))?;
        let path = entry.path();
        let name = entry.file_name();
        let dst_path = dst.join(name);
        if path.is_dir() {
            copy_dir_recursive(&path, &dst_path)?;
        } else if path.is_file() {
            fs::copy(&path, &dst_path).map_err(|e| {
                format!(
                    "failed to copy {} -> {}: {e}",
                    path.display(),
                    dst_path.display()
                )
            })?;
        }
    }
    Ok(())
}

/// Copies the plugin icon to the bundle directory.
///
/// Searches for an icon file in the plugin root using supported extensions
/// (`icon.png`, `icon.jpg`, etc.) and copies the first found to the bundle.
///
/// # Arguments
///
/// * `plugin_dir` - Path to the plugin root directory
/// * `bundle_dir` - Path to the bundle staging directory
///
/// # Returns
///
/// Returns `Ok(())` on success (or if no icon found), or `Err(String)` on failure.
///
/// # Note
///
/// If no icon is found, this function succeeds silently. This allows plugins
/// to be bundled without icons.
pub(crate) fn copy_icon(plugin_dir: &Path, bundle_dir: &Path) -> Result<(), String> {
    for ext in ICON_EXTENSIONS {
        let name = format!("icon.{ext}");
        let src = plugin_dir.join(&name);
        if !src.is_file() {
            continue;
        }
        let dst = bundle_dir.join(&name);
        fs::copy(&src, &dst).map_err(|e| {
            format!(
                "failed to copy icon {} -> {}: {e}",
                src.display(),
                dst.display()
            )
        })?;
        break;
    }
    Ok(())
}
