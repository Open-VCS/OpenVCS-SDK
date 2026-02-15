// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

use crate::dist::fsops::{
    ICON_EXTENSIONS, copy_dir_recursive, copy_icon, unique_staging_dir, write_tar_xz,
};
use std::collections::BTreeMap;
use std::fs;
use std::io::Cursor;
use std::io::Read;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

struct TempDir {
    path: PathBuf,
}

impl TempDir {
    fn new(prefix: &str) -> Self {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_micros();
        let pid = std::process::id();
        let path = std::env::temp_dir().join(format!("openvcs-sdk-tests-{prefix}-{pid}-{now}"));
        fs::create_dir_all(&path).unwrap();
        Self { path }
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.path);
    }
}

#[test]
fn unique_staging_dir_creates_valid_path() {
    let out_dir = PathBuf::from("/tmp/output");
    let staging = unique_staging_dir(&out_dir);

    assert!(staging.starts_with(&out_dir));
    assert!(
        staging
            .file_name()
            .and_then(|n| n.to_str())
            .map(|n| n.starts_with(".openvcs-plugin-staging-"))
            .unwrap_or(false)
    );
}

#[test]
fn reject_symlinks_recursive_rejects_file_symlink() {
    let tmp = TempDir::new("reject_file_symlink");
    let target = tmp.path.join("target.txt");
    fs::write(&target, b"target").unwrap();
    let link = tmp.path.join("link.txt");
    #[cfg(unix)]
    std::os::unix::fs::symlink(&target, &link).unwrap();
    #[cfg(windows)]
    std::os::windows::fs::symlink_file(&target, &link).unwrap();

    let err = crate::dist::fsops::reject_symlinks_recursive(&tmp.path).unwrap_err();
    assert!(err.contains("symlink"), "{err}");
}

#[test]
fn reject_symlinks_recursive_rejects_dir_symlink() {
    let tmp = TempDir::new("reject_dir_symlink");
    let target_dir = tmp.path.join("target_dir");
    fs::create_dir_all(&target_dir).unwrap();
    let link = tmp.path.join("link_dir");
    #[cfg(unix)]
    std::os::unix::fs::symlink(&target_dir, &link).unwrap();
    #[cfg(windows)]
    std::os::windows::fs::symlink_dir(&target_dir, &link).unwrap();

    let err = crate::dist::fsops::reject_symlinks_recursive(&tmp.path).unwrap_err();
    assert!(err.contains("symlink"), "{err}");
}

#[test]
fn reject_symlinks_recursive_allows_regular_files() {
    let tmp = TempDir::new("allow_regular_files");
    fs::write(tmp.path.join("file.txt"), b"content").unwrap();
    let subdir = tmp.path.join("subdir");
    fs::create_dir_all(&subdir).unwrap();
    fs::write(subdir.join("nested.txt"), b"nested").unwrap();

    crate::dist::fsops::reject_symlinks_recursive(&tmp.path).unwrap();
}

#[test]
fn copy_icon_prefers_png_over_jpg() {
    let tmp = TempDir::new("copy_icon_priority");
    let plugin_dir = tmp.path.join("plugin");
    let bundle_dir = tmp.path.join("bundle");
    fs::create_dir_all(&plugin_dir).unwrap();
    fs::create_dir_all(&bundle_dir).unwrap();

    fs::write(plugin_dir.join("icon.jpg"), b"jpg").unwrap();
    fs::write(plugin_dir.join("icon.png"), b"png").unwrap();

    copy_icon(&plugin_dir, &bundle_dir).unwrap();

    assert_eq!(fs::read(bundle_dir.join("icon.png")).unwrap(), b"png");
    assert!(!bundle_dir.join("icon.jpg").is_file());
}

#[test]
fn copy_icon_returns_ok_when_no_icon() {
    let tmp = TempDir::new("copy_icon_missing");
    let plugin_dir = tmp.path.join("plugin");
    let bundle_dir = tmp.path.join("bundle");
    fs::create_dir_all(&plugin_dir).unwrap();
    fs::create_dir_all(&bundle_dir).unwrap();

    copy_icon(&plugin_dir, &bundle_dir).unwrap();

    let icon_files: Vec<_> = ICON_EXTENSIONS
        .iter()
        .filter(|ext| bundle_dir.join(format!("icon.{ext}")).is_file())
        .collect();
    assert!(icon_files.is_empty());
}

#[test]
fn write_tar_xz_creates_valid_archive() {
    let tmp = TempDir::new("write_tar_valid");
    let out_dir = tmp.path.join("out");
    let base_dir = tmp.path.join("base");
    fs::create_dir_all(&out_dir).unwrap();
    fs::create_dir_all(&base_dir).unwrap();

    let folder_name = "myplugin";
    let folder_path = base_dir.join(folder_name);
    let sub_dir = folder_path.join("sub");
    fs::create_dir_all(&sub_dir).unwrap();
    fs::write(folder_path.join("file.txt"), b"content").unwrap();
    fs::write(sub_dir.join("nested.txt"), b"nested").unwrap();

    let out_path = out_dir.join("bundle.tar.xz");
    write_tar_xz(&out_path, &base_dir, folder_name).unwrap();

    assert!(out_path.is_file());

    let cursor = Cursor::new(fs::read(&out_path).unwrap());
    let decoder = xz2::read::XzDecoder::new(cursor);
    let mut tar = tar::Archive::new(decoder);
    let mut entries = BTreeMap::new();
    for entry in tar.entries().unwrap() {
        let mut entry = entry.unwrap();
        let name = entry.path().unwrap().to_string_lossy().to_string();
        let mut buf = Vec::new();
        entry.read_to_end(&mut buf).unwrap();
        entries.insert(name, buf);
    }

    assert!(entries.contains_key("myplugin/file.txt"));
    assert_eq!(entries.get("myplugin/file.txt").unwrap(), b"content");
    assert!(entries.contains_key("myplugin/sub/nested.txt"));
}

#[test]
fn write_tar_xz_rejects_symlinks_in_archive() {
    let tmp = TempDir::new("write_tar_reject_symlink");
    let out_dir = tmp.path.join("out");
    let base_dir = tmp.path.join("base");
    fs::create_dir_all(&out_dir).unwrap();
    fs::create_dir_all(&base_dir).unwrap();

    let folder_name = "myplugin";
    let folder_path = base_dir.join(folder_name);
    fs::create_dir_all(&folder_path).unwrap();

    let target = folder_path.join("target.txt");
    fs::write(&target, b"target").unwrap();
    let link = folder_path.join("link.txt");
    #[cfg(unix)]
    std::os::unix::fs::symlink(&target, &link).unwrap();
    #[cfg(windows)]
    std::os::windows::fs::symlink_file(&target, &link).unwrap();

    let out_path = out_dir.join("bundle.tar.xz");
    let err = write_tar_xz(&out_path, &base_dir, folder_name).unwrap_err();
    assert!(err.contains("symlink"), "{err}");
}

#[test]
fn copy_dir_recursive_errors_when_source_is_not_directory() {
    let tmp = TempDir::new("copy_dir_not_dir");
    let src = tmp.path.join("file.txt");
    let dst = tmp.path.join("dst");
    fs::write(&src, b"content").unwrap();

    let err = copy_dir_recursive(&src, &dst).unwrap_err();
    assert!(err.contains("expected directory"), "{err}");
}
