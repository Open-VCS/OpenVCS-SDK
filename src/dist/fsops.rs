use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

pub(crate) const ICON_EXTENSIONS: &[&str] = &["png", "jpg", "jpeg", "webp", "avif", "svg"];

pub(crate) fn unique_staging_dir(out_dir: &Path) -> PathBuf {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    out_dir.join(format!(".openvcs-plugin-staging-{now}"))
}

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
