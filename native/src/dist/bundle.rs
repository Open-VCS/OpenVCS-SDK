// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

use crate::dist::PluginBuildArgs;
use crate::dist::fsops::{copy_dir_recursive, copy_icon, unique_staging_dir, write_tar_xz};
use crate::dist::manifest::manifest_defaults;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

/// Returns the npm executable name for the current platform.
///
/// # Returns
/// - `npm` on Unix-like systems.
/// - `npm.cmd` on Windows.
fn npm_executable() -> &'static str {
    #[cfg(windows)]
    {
        "npm.cmd"
    }
    #[cfg(not(windows))]
    {
        "npm"
    }
}

/// Runs a command and returns a detailed error when it fails.
///
/// # Parameters
/// - `program`: Program name to execute.
/// - `args`: Command arguments.
/// - `cwd`: Working directory.
/// - `verbose`: Whether to print command execution details.
///
/// # Returns
/// - `Ok(())` when the command exits with status code 0.
/// - `Err(String)` with stdout/stderr context when execution fails.
fn run_command(program: &str, args: &[&str], cwd: &Path, verbose: bool) -> Result<(), String> {
    if verbose {
        eprintln!(
            "Running command in {}: {} {}",
            cwd.display(),
            program,
            args.join(" ")
        );
    }

    let output = Command::new(program)
        .args(args)
        .current_dir(cwd)
        .output()
        .map_err(|e| format!("failed to spawn '{}' in {}: {e}", program, cwd.display()))?;

    if output.status.success() {
        if verbose {
            let stdout = String::from_utf8_lossy(&output.stdout);
            let stderr = String::from_utf8_lossy(&output.stderr);
            if !stdout.trim().is_empty() {
                eprintln!("{}", stdout.trim());
            }
            if !stderr.trim().is_empty() {
                eprintln!("{}", stderr.trim());
            }
        }
        return Ok(());
    }

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    Err(format!(
        "command failed ({} {}), exit code {:?}, stdout='{}', stderr='{}'",
        program,
        args.join(" "),
        output.status.code(),
        stdout,
        stderr
    ))
}

/// Returns whether the plugin repository declares npm dependencies.
///
/// # Parameters
/// - `plugin_dir`: Plugin repository root path.
///
/// # Returns
/// - `true` when `package.json` exists.
/// - `false` otherwise.
fn has_package_json(plugin_dir: &Path) -> bool {
    plugin_dir.join("package.json").is_file()
}

/// Ensures `package-lock.json` exists in the plugin repository.
///
/// If the lockfile is missing and `package.json` exists, this function creates
/// the lockfile in the plugin worktree using npm.
///
/// # Parameters
/// - `plugin_dir`: Plugin repository root path.
/// - `verbose`: Whether to print command execution details.
///
/// # Returns
/// - `Ok(())` when lockfile already exists or is created successfully.
/// - `Err(String)` when lockfile generation fails.
fn ensure_package_lock(plugin_dir: &Path, verbose: bool) -> Result<(), String> {
    if !has_package_json(plugin_dir) {
        return Ok(());
    }
    if plugin_dir.join("package-lock.json").is_file() {
        return Ok(());
    }

    if verbose {
        eprintln!("Generating package-lock.json in {}", plugin_dir.display());
    }

    run_command(
        npm_executable(),
        &[
            "install",
            "--package-lock-only",
            "--ignore-scripts",
            "--no-audit",
            "--no-fund",
        ],
        plugin_dir,
        verbose,
    )
    .map_err(|e| format!("failed to create package-lock.json: {e}"))
}

/// Copies npm manifest files into the bundle staging directory.
///
/// # Parameters
/// - `plugin_dir`: Plugin repository root path.
/// - `bundle_dir`: Bundle staging directory (`<staging>/<plugin-id>`).
///
/// # Returns
/// - `Ok(())` when files are copied.
/// - `Err(String)` when required files are missing or copy fails.
fn copy_npm_files_to_staging(plugin_dir: &Path, bundle_dir: &Path) -> Result<(), String> {
    let package_json_src = plugin_dir.join("package.json");
    let package_lock_src = plugin_dir.join("package-lock.json");

    if !package_json_src.is_file() {
        return Err(format!(
            "missing package.json at {}",
            package_json_src.display()
        ));
    }
    if !package_lock_src.is_file() {
        return Err(format!(
            "missing package-lock.json at {}",
            package_lock_src.display()
        ));
    }

    fs::copy(&package_json_src, bundle_dir.join("package.json")).map_err(|e| {
        format!(
            "failed to copy {} -> {}: {e}",
            package_json_src.display(),
            bundle_dir.join("package.json").display()
        )
    })?;
    fs::copy(&package_lock_src, bundle_dir.join("package-lock.json")).map_err(|e| {
        format!(
            "failed to copy {} -> {}: {e}",
            package_lock_src.display(),
            bundle_dir.join("package-lock.json").display()
        )
    })?;

    Ok(())
}

/// Rejects native Node.js addons (`.node`) recursively.
///
/// # Parameters
/// - `dir`: Directory tree to scan.
///
/// # Returns
/// - `Ok(())` when no native addons are found.
/// - `Err(String)` naming the first offending file.
fn reject_native_addons_recursive(dir: &Path) -> Result<(), String> {
    let entries = fs::read_dir(dir).map_err(|e| format!("read_dir {}: {e}", dir.display()))?;
    for entry in entries {
        let entry = entry.map_err(|e| format!("read_dir entry: {e}"))?;
        let path = entry.path();
        let meta =
            fs::symlink_metadata(&path).map_err(|e| format!("metadata {}: {e}", path.display()))?;
        if meta.is_dir() {
            reject_native_addons_recursive(&path)?;
            continue;
        }
        if !meta.is_file() {
            continue;
        }
        let name = path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or_default();
        if name.to_ascii_lowercase().ends_with(".node") {
            return Err(format!(
                "native Node addon files are not supported in portable bundles: {}",
                path.display()
            ));
        }
    }
    Ok(())
}

/// Installs production npm dependencies into the bundle staging directory.
///
/// # Parameters
/// - `plugin_dir`: Plugin repository root path.
/// - `bundle_dir`: Bundle staging directory (`<staging>/<plugin-id>`).
/// - `verbose`: Whether to print command execution details.
///
/// # Returns
/// - `Ok(())` when dependencies are installed and validated.
/// - `Err(String)` when npm execution or validation fails.
fn install_npm_dependencies(
    plugin_dir: &Path,
    bundle_dir: &Path,
    verbose: bool,
) -> Result<(), String> {
    copy_npm_files_to_staging(plugin_dir, bundle_dir)?;
    run_command(
        npm_executable(),
        &[
            "ci",
            "--omit=dev",
            "--ignore-scripts",
            "--no-bin-links",
            "--no-audit",
            "--no-fund",
        ],
        bundle_dir,
        verbose,
    )
    .map_err(|e| format!("failed to install npm dependencies for bundle staging: {e}"))?;

    let node_modules_dir = bundle_dir.join("node_modules");
    if !node_modules_dir.is_dir() {
        return Err(format!(
            "npm install did not produce node_modules at {}",
            node_modules_dir.display()
        ));
    }
    reject_native_addons_recursive(&node_modules_dir)?;
    Ok(())
}

/// Validates the module entrypoint declared in the plugin manifest.
///
/// # Parameters
/// - `plugin_dir`: Plugin repository root path.
/// - `module_exec`: Optional `module.exec` value from the manifest.
///
/// # Returns
/// - `Ok(())` when no module is declared or when the declared module is valid.
/// - `Err(String)` when the module declaration is invalid.
fn validate_declared_module_exec(
    plugin_dir: &Path,
    module_exec: Option<&str>,
) -> Result<(), String> {
    let Some(exec) = module_exec else {
        return Ok(());
    };

    let exec = exec.trim();
    if exec.is_empty() {
        return Ok(());
    }

    let lower = exec.to_ascii_lowercase();
    let supported = lower.ends_with(".js") || lower.ends_with(".mjs") || lower.ends_with(".cjs");
    if !supported {
        return Err(format!(
            "manifest exec must end with .js/.mjs/.cjs (Node runtime): {exec}"
        ));
    }

    let exec_path = Path::new(exec);
    if exec_path.is_absolute() {
        return Err(format!(
            "manifest module.exec must be a relative path under bin/: {exec}"
        ));
    }
    if exec_path
        .components()
        .any(|c| matches!(c, std::path::Component::Prefix(_)))
    {
        return Err(format!(
            "manifest module.exec must be a relative path under bin/: {exec}"
        ));
    }

    let bin_dir = plugin_dir.join("bin");
    let bin_dir_canon = fs::canonicalize(&bin_dir)
        .map_err(|e| format!("failed to resolve bin directory {}: {e}", bin_dir.display()))?;

    let bin_src = bin_dir.join(exec_path);
    if !bin_src.is_file() {
        return Err(format!(
            "module entrypoint not found at {}",
            bin_src.display()
        ));
    }

    let bin_src_canon = fs::canonicalize(&bin_src).map_err(|e| {
        format!(
            "failed to resolve module entrypoint {}: {e}",
            bin_src.display()
        )
    })?;
    if !bin_src_canon.starts_with(&bin_dir_canon) {
        return Err(format!(
            "manifest module.exec must point to a file under bin/: {exec}"
        ));
    }

    Ok(())
}

/// Builds and bundles a plugin into a distributable `.ovcsp` archive.
///
/// This function performs the complete bundling workflow:
///
/// 1. **Parse manifest** - Reads `openvcs.plugin.json` to get plugin ID and exec path.
/// 2. **Validate module entry** - Ensures `bin/<module.exec>` exists for Node plugins.
/// 3. **Copy assets** - Copies icon and themes directories when present.
/// 4. **Copy runtime files** - Copies all files under `bin/` when present.
/// 5. **Resolve npm deps** - Installs production npm dependencies by default.
/// 6. **Create archive** - Packages everything into a tar.xz archive.
///
/// # Arguments
/// * `args` - Build arguments containing plugin path, output path, and options.
///
/// # Returns
/// Returns `Ok(PathBuf)` pointing to the created `.ovcsp` bundle.
///
/// # Errors
/// Returns an error when manifest validation, file operations, npm dependency
/// installation, or archive creation fails.
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

    let has_module = module_exec.is_some();
    let has_ui_or_assets = args.plugin_dir.join("themes").is_dir();
    if !has_module && !has_ui_or_assets {
        return Err("manifest has no module.exec or themes/".to_string());
    }

    validate_declared_module_exec(&args.plugin_dir, module_exec.as_deref())?;

    let manifest_src = args.plugin_dir.join("openvcs.plugin.json");

    if verbose {
        eprintln!("Creating output directory: {}", args.out_dir.display());
    }
    fs::create_dir_all(&args.out_dir)
        .map_err(|e| format!("failed to create {}: {e}", args.out_dir.display()))?;

    let staging_root = unique_staging_dir(&args.out_dir);
    let bundle_dir = staging_root.join(&plugin_id);

    if verbose {
        eprintln!("Creating staging directory: {}", staging_root.display());
    }
    fs::create_dir_all(&bundle_dir)
        .map_err(|e| format!("failed to create {}: {e}", bundle_dir.display()))?;

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

    let bin_src = args.plugin_dir.join("bin");
    if bin_src.is_dir() {
        if verbose {
            eprintln!("Copying bin directory");
        }
        copy_dir_recursive(&bin_src, &bundle_dir.join("bin"))?;
    }

    if !args.no_npm_deps && has_package_json(&args.plugin_dir) {
        ensure_package_lock(&args.plugin_dir, verbose)?;
        install_npm_dependencies(&args.plugin_dir, &bundle_dir, verbose)?;
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
