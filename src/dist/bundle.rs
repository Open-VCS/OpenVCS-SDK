// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

use crate::build::resolve_target_dir;
use crate::build::{build_plugin_wasi, ensure_wasm_magic};
use crate::dist::PluginBuildArgs;
use crate::dist::fsops::{copy_dir_recursive, copy_icon, unique_staging_dir, write_tar_xz};
use crate::dist::manifest::manifest_defaults;
use std::fs;
use std::path::PathBuf;

/// Builds and bundles a plugin into a distributable `.ovcsp` archive.
///
/// This function performs the complete bundling workflow:
///
/// 1. **Parse manifest** - Reads `openvcs.plugin.json` to get plugin ID and exec path
/// 2. **Build WASM** - Compiles `src/lib.rs` to `wasm32-wasip1` (if module.exec is set)
/// 3. **Validate** - Ensures the built WASM is a valid component module
/// 4. **Copy assets** - Copies icon (if present) and themes directory (if present)
/// 5. **Create archive** - Packages everything into a tar.xz archive
///
/// # Arguments
///
/// * `args` - Build arguments containing `plugin_dir` and `out_dir`
///
/// # Returns
///
/// Returns `Ok(PathBuf)` pointing to the created `.ovcsp` bundle, or `Err(String)` on failure.
///
/// # Errors
///
/// Returns an error if:
/// - The manifest is missing or has no `id` field
/// - The manifest has no `module.exec` and no `themes/` directory
/// - WASM build fails
/// - The built WASM is not a valid component
/// - Asset copying fails
/// - Archive creation fails
///
/// # Output Format
///
/// The bundle is a tar.xz archive containing:
///
/// ```text
/// {plugin-id}/
///   openvcs.plugin.json
///   icon.{ext}           # if present
///   themes/              # if present
///   bin/
///     {exec}              # if module.exec was specified
/// ```
pub fn bundle_plugin(args: &PluginBuildArgs) -> Result<PathBuf, String> {
    let verbose = args.verbose;

    if verbose {
        eprintln!("Bundling plugin from: {}", args.plugin_dir.display());
    }

    let (manifest_id, module_exec) = manifest_defaults(&args.plugin_dir)?;
    let plugin_id = manifest_id;

    if verbose {
        eprintln!("Plugin ID: {}", plugin_id);
    }

    let has_wasm = module_exec.is_some();
    let has_ui_or_assets = args.plugin_dir.join("themes").is_dir();
    if !has_wasm && !has_ui_or_assets {
        return Err("manifest has no module.exec or themes/".to_string());
    }

    let manifest_src = args.plugin_dir.join("openvcs.plugin.json");

    if verbose {
        eprintln!("Creating output directory: {}", args.out_dir.display());
    }
    fs::create_dir_all(&args.out_dir)
        .map_err(|e| format!("failed to create {}: {e}", args.out_dir.display()))?;

    let staging_root = unique_staging_dir(&args.out_dir);
    let bundle_dir = staging_root.join(&plugin_id);
    let bin_dir = bundle_dir.join("bin");

    if verbose {
        eprintln!("Creating staging directory: {}", staging_root.display());
    }

    fs::create_dir_all(&bin_dir)
        .map_err(|e| format!("failed to create {}: {e}", bin_dir.display()))?;

    if verbose {
        eprintln!("Copying manifest: {}", manifest_src.display());
    }
    fs::copy(&manifest_src, bundle_dir.join("openvcs.plugin.json")).map_err(|e| {
        format!(
            "failed to copy manifest {} -> {}: {e}",
            manifest_src.display(),
            bundle_dir.join("openvcs.plugin.json").display()
        )
    })?;

    copy_icon(&args.plugin_dir, &bundle_dir)?;

    let themes_src = args.plugin_dir.join("themes");
    if themes_src.is_dir() {
        if verbose {
            eprintln!("Copying themes directory");
        }
        copy_dir_recursive(&themes_src, &bundle_dir.join("themes"))?;
    }

    let target_dir = resolve_target_dir(&args.plugin_dir);

    for exec in [module_exec].into_iter().flatten() {
        let exec = exec.trim().to_string();
        if exec.is_empty() {
            continue;
        }

        if !exec.ends_with(".wasm") {
            return Err(format!(
                "manifest exec must end with .wasm (OpenVCS is WASM-only): {exec}"
            ));
        }

        let _bin = exec
            .strip_suffix(".wasm")
            .ok_or_else(|| format!("invalid wasm exec: {exec}"))?;

        if verbose {
            eprintln!("Building WASM module: {}", exec);
        }
        let bin_src = build_plugin_wasi(&args.plugin_dir, &target_dir, "libplugin", verbose)?;
        if !bin_src.is_file() {
            return Err(format!(
                "built wasm not found at {} (did cargo build succeed?)",
                bin_src.display()
            ));
        }
        ensure_wasm_magic(&bin_src)?;
        let bin_dst = bin_dir.join(&exec);

        if verbose {
            eprintln!("Copying WASM to bundle: {}", bin_dst.display());
        }
        fs::copy(&bin_src, &bin_dst).map_err(|e| {
            format!(
                "failed to copy wasm {} -> {}: {e}",
                bin_src.display(),
                bin_dst.display()
            )
        })?;
    }

    let out_path = args.out_dir.join(format!("{plugin_id}.ovcsp"));
    if out_path.exists() {
        fs::remove_file(&out_path)
            .map_err(|e| format!("failed to remove existing {}: {e}", out_path.display()))?;
    }

    if verbose {
        eprintln!("Creating archive: {}", out_path.display());
    }
    write_tar_xz(&out_path, &staging_root, &plugin_id)?;

    let _ = fs::remove_dir_all(&staging_root);

    if verbose {
        eprintln!("Bundle created successfully: {}", out_path.display());
    }

    Ok(out_path)
}
