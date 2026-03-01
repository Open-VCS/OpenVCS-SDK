// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

//! Standalone OpenVCS SDK CLI for npm workflows.
//!
//! This binary provides commands intended to be used from npm scripts:
//! - `openvcs-sdk dist` to build `.ovcsp` bundles
//! - `openvcs-sdk init` to scaffold interactive plugin templates

use openvcs_sdk::dist::{PluginBuildArgs, bundle_plugin, parse_args};
use serde_json::json;
use std::env;
use std::ffi::OsString;
use std::fs;
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, ExitCode};

/// Represents the plugin template kind selected during initialization.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum TemplateKind {
    /// Plugin with a Node module entrypoint under `bin/`.
    Module,
    /// Theme-only plugin that ships files under `themes/`.
    Theme,
}

/// Answers gathered from interactive `init` prompts.
#[derive(Debug)]
struct InitAnswers {
    /// Target directory where plugin files will be written.
    target_dir: PathBuf,
    /// Selected template kind.
    kind: TemplateKind,
    /// Plugin manifest id.
    plugin_id: String,
    /// Plugin display name.
    plugin_name: String,
    /// Plugin version string.
    plugin_version: String,
    /// Initial default-enabled value in the manifest.
    default_enabled: bool,
    /// Whether to run npm install after scaffolding.
    run_npm_install: bool,
}

/// Prints top-level CLI usage text.
fn print_usage() {
    eprintln!(
        "Usage: openvcs-sdk <command> [options]

Commands:
  dist [args]            Package plugin into .ovcsp
  init [--theme] [dir]   Interactively scaffold a plugin project
  -v, --version          Show version information

dist args:
  --plugin-dir <path>    Plugin root containing openvcs.plugin.json
  --out <path>           Output directory (default: ./dist)
  --no-npm-deps          Skip npm dependency bundling
  -V, --verbose          Verbose output
"
    );
}

/// Prints usage text for the `init` command.
fn print_init_usage() {
    eprintln!(
        "Usage: openvcs-sdk init [--theme] [target-dir]

Options:
  --theme                Start with a theme-only plugin template
"
    );
}

/// Returns npm executable name for current platform.
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

/// Reads one interactive text input line with an optional default.
fn prompt_line(label: &str, default: Option<&str>) -> Result<String, String> {
    let mut stdout = io::stdout();
    match default {
        Some(value) if !value.is_empty() => {
            write!(stdout, "{label} [{value}]: ").map_err(|e| format!("stdout write: {e}"))?
        }
        _ => write!(stdout, "{label}: ").map_err(|e| format!("stdout write: {e}"))?,
    }
    stdout.flush().map_err(|e| format!("stdout flush: {e}"))?;

    let mut line = String::new();
    io::stdin()
        .read_line(&mut line)
        .map_err(|e| format!("stdin read_line: {e}"))?;
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return Ok(default.unwrap_or_default().to_string());
    }
    Ok(trimmed.to_string())
}

/// Reads one interactive yes/no answer with a default value.
fn prompt_bool(label: &str, default: bool) -> Result<bool, String> {
    let suffix = if default { "Y/n" } else { "y/N" };
    loop {
        let answer = prompt_line(&format!("{label} ({suffix})"), None)?;
        let normalized = answer.trim().to_ascii_lowercase();
        if normalized.is_empty() {
            return Ok(default);
        }
        if normalized == "y" || normalized == "yes" {
            return Ok(true);
        }
        if normalized == "n" || normalized == "no" {
            return Ok(false);
        }
        eprintln!("Please answer yes or no.");
    }
}

/// Converts a path-ish name into a safe default plugin id token.
fn sanitize_id_token(raw: &str) -> String {
    let mut out = String::new();
    let mut last_was_sep = false;
    for c in raw.chars() {
        let valid = c.is_ascii_alphanumeric() || c == '.' || c == '-' || c == '_';
        if valid {
            out.push(c.to_ascii_lowercase());
            last_was_sep = false;
            continue;
        }
        if !last_was_sep {
            out.push('-');
            last_was_sep = true;
        }
    }
    out.trim_matches('-').to_string()
}

/// Derives a default plugin id from directory name.
fn default_plugin_id_from_dir(dir: &Path) -> String {
    let stem = dir
        .file_name()
        .and_then(|name| name.to_str())
        .filter(|name| !name.trim().is_empty())
        .unwrap_or("openvcs-plugin");
    let token = sanitize_id_token(stem);
    if token.is_empty() {
        "openvcs.plugin".to_string()
    } else {
        token
    }
}

/// Derives a display name from a plugin id.
fn default_plugin_name_from_id(plugin_id: &str) -> String {
    let mut out = String::new();
    let mut capitalize = true;
    for c in plugin_id.chars() {
        let is_sep = c == '.' || c == '-' || c == '_';
        if is_sep {
            if !out.ends_with(' ') {
                out.push(' ');
            }
            capitalize = true;
            continue;
        }
        if capitalize {
            out.push(c.to_ascii_uppercase());
            capitalize = false;
        } else {
            out.push(c);
        }
    }
    let value = out.trim().to_string();
    if value.is_empty() {
        "OpenVCS Plugin".to_string()
    } else {
        value
    }
}

/// Collects interactive answers for the plugin scaffolding workflow.
fn collect_init_answers(
    force_theme: bool,
    target_hint: Option<PathBuf>,
) -> Result<InitAnswers, String> {
    let cwd = env::current_dir().map_err(|e| format!("current_dir: {e}"))?;
    let default_target = target_hint.unwrap_or_else(|| cwd.join("openvcs-plugin"));
    let default_target_text = default_target.to_string_lossy().to_string();
    let target_text = prompt_line("Target directory", Some(&default_target_text))?;
    let target_dir = PathBuf::from(target_text);

    let kind = if force_theme {
        TemplateKind::Theme
    } else {
        loop {
            let choice = prompt_line("Template type (module/theme)", Some("module"))?;
            let normalized = choice.trim().to_ascii_lowercase();
            if normalized == "module" || normalized == "m" {
                break TemplateKind::Module;
            }
            if normalized == "theme" || normalized == "t" {
                break TemplateKind::Theme;
            }
            eprintln!("Please choose 'module' or 'theme'.");
        }
    };

    let default_id = default_plugin_id_from_dir(&target_dir);
    let plugin_id = loop {
        let value = prompt_line("Plugin id", Some(&default_id))?;
        let trimmed = value.trim();
        if trimmed.is_empty() {
            eprintln!("Plugin id is required.");
            continue;
        }
        break trimmed.to_string();
    };

    let default_name = default_plugin_name_from_id(&plugin_id);
    let plugin_name = loop {
        let value = prompt_line("Plugin name", Some(&default_name))?;
        let trimmed = value.trim();
        if trimmed.is_empty() {
            eprintln!("Plugin name is required.");
            continue;
        }
        break trimmed.to_string();
    };

    let plugin_version = loop {
        let value = prompt_line("Version", Some("0.1.0"))?;
        let trimmed = value.trim();
        if trimmed.is_empty() {
            eprintln!("Version is required.");
            continue;
        }
        break trimmed.to_string();
    };

    let default_enabled = prompt_bool("Default enabled", true)?;
    let run_npm_install = prompt_bool("Run npm install now", true)?;

    Ok(InitAnswers {
        target_dir,
        kind,
        plugin_id,
        plugin_name,
        plugin_version,
        default_enabled,
        run_npm_install,
    })
}

/// Returns true when a directory has at least one filesystem entry.
fn directory_is_non_empty(path: &Path) -> Result<bool, String> {
    let mut entries =
        fs::read_dir(path).map_err(|e| format!("read_dir {}: {e}", path.display()))?;
    Ok(entries
        .next()
        .transpose()
        .map_err(|e| format!("read_dir entry: {e}"))?
        .is_some())
}

/// Ensures the target directory can be used for scaffolding.
fn ensure_target_directory_ready(target_dir: &Path) -> Result<(), String> {
    if !target_dir.exists() {
        fs::create_dir_all(target_dir)
            .map_err(|e| format!("failed to create {}: {e}", target_dir.display()))?;
        return Ok(());
    }

    if !target_dir.is_dir() {
        return Err(format!(
            "target path exists but is not a directory: {}",
            target_dir.display()
        ));
    }

    if !directory_is_non_empty(target_dir)? {
        return Ok(());
    }

    let proceed = prompt_bool(
        &format!(
            "Directory {} is not empty. Continue and overwrite known files",
            target_dir.display()
        ),
        false,
    )?;
    if proceed {
        Ok(())
    } else {
        Err("aborted by user".to_string())
    }
}

/// Writes a UTF-8 text file, creating parent directories when needed.
fn write_text_file(path: &Path, content: &str) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("failed to create {}: {e}", parent.display()))?;
    }
    fs::write(path, content.as_bytes()).map_err(|e| format!("write {}: {e}", path.display()))
}

/// Returns the generated manifest JSON text.
fn manifest_json(answers: &InitAnswers) -> Result<String, String> {
    let manifest = match answers.kind {
        TemplateKind::Module => json!({
            "id": answers.plugin_id,
            "name": answers.plugin_name,
            "version": answers.plugin_version,
            "default_enabled": answers.default_enabled,
            "module": { "exec": "plugin.js" }
        }),
        TemplateKind::Theme => json!({
            "id": answers.plugin_id,
            "name": answers.plugin_name,
            "version": answers.plugin_version,
            "default_enabled": answers.default_enabled
        }),
    };
    serde_json::to_string_pretty(&manifest)
        .map(|value| format!("{value}\n"))
        .map_err(|e| format!("serialize manifest json: {e}"))
}

/// Returns package.json text for a module plugin template.
fn module_package_json(answers: &InitAnswers) -> Result<String, String> {
    let package = json!({
        "name": answers.plugin_id,
        "version": answers.plugin_version,
        "private": true,
        "type": "module",
        "scripts": {
            "build:ts": "tsc -p tsconfig.json",
            "build": "npm run build:ts && openvcs-sdk dist --plugin-dir . --out dist",
            "test": "openvcs-sdk dist --plugin-dir . --out dist --no-npm-deps"
        },
        "devDependencies": {
            "@openvcs/sdk": format!("^{}", env!("CARGO_PKG_VERSION")),
            "@types/node": "^22.0.0",
            "typescript": "^5.8.2"
        }
    });
    serde_json::to_string_pretty(&package)
        .map(|value| format!("{value}\n"))
        .map_err(|e| format!("serialize package.json: {e}"))
}

/// Returns package.json text for a theme plugin template.
fn theme_package_json(answers: &InitAnswers) -> Result<String, String> {
    let package = json!({
        "name": answers.plugin_id,
        "version": answers.plugin_version,
        "private": true,
        "scripts": {
            "build": "openvcs-sdk dist --plugin-dir . --out dist",
            "test": "openvcs-sdk dist --plugin-dir . --out dist --no-npm-deps"
        },
        "devDependencies": {
            "@openvcs/sdk": format!("^{}", env!("CARGO_PKG_VERSION"))
        }
    });
    serde_json::to_string_pretty(&package)
        .map(|value| format!("{value}\n"))
        .map_err(|e| format!("serialize package.json: {e}"))
}

/// Returns a TypeScript configuration for module plugin templates.
fn module_tsconfig_json() -> &'static str {
    "{\n  \"compilerOptions\": {\n    \"target\": \"ES2022\",\n    \"module\": \"NodeNext\",\n    \"moduleResolution\": \"NodeNext\",\n    \"types\": [\"node\"],\n    \"strict\": true,\n    \"skipLibCheck\": true,\n    \"outDir\": \"bin\",\n    \"rootDir\": \"src\"\n  },\n  \"include\": [\"src/**/*.ts\"]\n}\n"
}

/// Returns the default TypeScript module plugin runtime implementation.
fn module_plugin_ts() -> &'static str {
    "type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };\n\ninterface RpcRequest {\n  jsonrpc?: string;\n  id?: number | string | null;\n  method?: string;\n  params?: JsonValue;\n}\n\ninterface SettingKv {\n  key: string;\n  value: JsonValue;\n}\n\nconst PROTOCOL_VERSION = 1;\nlet inputBuffer = Buffer.alloc(0);\n\nprocess.stdin.on(\"data\", (chunk: Buffer) => {\n  inputBuffer = Buffer.concat([inputBuffer, chunk]);\n  processInputBuffer();\n});\n\nprocess.stdin.resume();\n\nfunction processInputBuffer(): void {\n  while (true) {\n    const headerEnd = inputBuffer.indexOf(\"\\r\\n\\r\\n\");\n    if (headerEnd < 0) {\n      return;\n    }\n\n    const headerText = inputBuffer.slice(0, headerEnd).toString(\"utf8\");\n    const contentLength = parseContentLength(headerText);\n    if (contentLength <= 0) {\n      inputBuffer = Buffer.alloc(0);\n      return;\n    }\n\n    const bodyStart = headerEnd + 4;\n    const bodyEnd = bodyStart + contentLength;\n    if (inputBuffer.length < bodyEnd) {\n      return;\n    }\n\n    const body = inputBuffer.slice(bodyStart, bodyEnd).toString(\"utf8\");\n    inputBuffer = inputBuffer.slice(bodyEnd);\n    handleMessage(body);\n  }\n}\n\nfunction parseContentLength(headerText: string): number {\n  const lines = headerText.split(\"\\r\\n\");\n  for (const line of lines) {\n    const separator = line.indexOf(\":\");\n    if (separator < 0) {\n      continue;\n    }\n    const key = line.slice(0, separator).trim().toLowerCase();\n    if (key !== \"content-length\") {\n      continue;\n    }\n    const raw = line.slice(separator + 1).trim();\n    const value = Number.parseInt(raw, 10);\n    return Number.isFinite(value) ? value : 0;\n  }\n  return 0;\n}\n\nfunction writeResponse(id: number | string | null | undefined, result: JsonValue): void {\n  if (id === undefined) {\n    return;\n  }\n  const payload = JSON.stringify({\n    jsonrpc: \"2.0\",\n    id,\n    result,\n  });\n  const bytes = Buffer.from(payload, \"utf8\");\n  process.stdout.write(`Content-Length: ${bytes.length}\\r\\n\\r\\n`);\n  process.stdout.write(bytes);\n}\n\nfunction handleMessage(rawText: string): void {\n  let message: RpcRequest;\n  try {\n    message = JSON.parse(rawText) as RpcRequest;\n  } catch {\n    return;\n  }\n\n  const method = message.method;\n  if (!method) {\n    return;\n  }\n\n  switch (method) {\n    case \"plugin.initialize\":\n      writeResponse(message.id, { protocol_version: PROTOCOL_VERSION });\n      return;\n    case \"plugin.init\":\n    case \"plugin.deinit\":\n    case \"plugin.handle_action\":\n    case \"plugin.settings.on_apply\":\n    case \"plugin.settings.on_reset\":\n      writeResponse(message.id, null);\n      return;\n    case \"plugin.get_menus\":\n      writeResponse(message.id, []);\n      return;\n    case \"plugin.settings.defaults\":\n      writeResponse(message.id, []);\n      return;\n    case \"plugin.settings.on_load\":\n    case \"plugin.settings.on_save\": {\n      const values = ((message.params as { values?: SettingKv[] } | undefined)?.values ?? []) as JsonValue;\n      writeResponse(message.id, values);\n      return;\n    }\n    default:\n      writeResponse(message.id, null);\n  }\n}\n"
}

/// Returns a minimal theme definition file for theme plugin templates.
fn theme_definition_json(answers: &InitAnswers) -> Result<String, String> {
    let mut name = answers.plugin_name.trim().to_string();
    if name.is_empty() {
        name = "Default Theme".to_string();
    }
    let value = json!({
        "name": name,
        "description": "Starter OpenVCS theme generated by @openvcs/sdk",
        "tokens": {
            "accent": "#2a7fff",
            "background": "#0f172a",
            "foreground": "#e2e8f0"
        }
    });
    serde_json::to_string_pretty(&value)
        .map(|text| format!("{text}\n"))
        .map_err(|e| format!("serialize theme json: {e}"))
}

/// Writes common files used by all scaffold templates.
fn write_common_files(target_dir: &Path, manifest_text: &str) -> Result<(), String> {
    write_text_file(&target_dir.join("openvcs.plugin.json"), manifest_text)?;
    write_text_file(&target_dir.join(".gitignore"), "node_modules/\ndist/\n")
}

/// Writes module plugin scaffold files.
fn write_module_template(answers: &InitAnswers) -> Result<(), String> {
    let target_dir = &answers.target_dir;
    let manifest_text = manifest_json(answers)?;
    write_common_files(target_dir, &manifest_text)?;
    write_text_file(
        &target_dir.join("package.json"),
        &module_package_json(answers)?,
    )?;
    write_text_file(&target_dir.join("tsconfig.json"), module_tsconfig_json())?;
    write_text_file(
        &target_dir.join("src").join("plugin.ts"),
        module_plugin_ts(),
    )
}

/// Writes theme plugin scaffold files.
fn write_theme_template(answers: &InitAnswers) -> Result<(), String> {
    let target_dir = &answers.target_dir;
    let manifest_text = manifest_json(answers)?;
    write_common_files(target_dir, &manifest_text)?;
    write_text_file(
        &target_dir.join("package.json"),
        &theme_package_json(answers)?,
    )?;
    write_text_file(
        &target_dir.join("themes").join("default").join("theme.json"),
        &theme_definition_json(answers)?,
    )
}

/// Runs `npm install` in the generated plugin directory.
fn run_npm_install(target_dir: &Path) -> Result<(), String> {
    let status = Command::new(npm_executable())
        .arg("install")
        .current_dir(target_dir)
        .status()
        .map_err(|e| {
            format!(
                "failed to spawn npm install in {}: {e}",
                target_dir.display()
            )
        })?;
    if status.success() {
        Ok(())
    } else {
        Err(format!(
            "npm install failed in {} (code {:?})",
            target_dir.display(),
            status.code()
        ))
    }
}

/// Runs the `dist` command through the shared bundler implementation.
fn run_dist_command(args: &[OsString]) -> Result<PathBuf, String> {
    let parsed: PluginBuildArgs = parse_args(args.to_vec())?;
    bundle_plugin(&parsed)
}

/// Parses and executes the `init` command.
fn run_init_command(args: &[OsString]) -> Result<PathBuf, String> {
    let mut force_theme = false;
    let mut target_dir: Option<PathBuf> = None;

    for arg in args {
        let value = arg.to_string_lossy();
        match value.as_ref() {
            "--theme" => force_theme = true,
            "--help" => {
                print_init_usage();
                return Err(String::new());
            }
            other if other.starts_with('-') => {
                return Err(format!("unknown argument for init: {other}"));
            }
            other => {
                if target_dir.is_some() {
                    return Err("init accepts at most one target directory".to_string());
                }
                target_dir = Some(PathBuf::from(other));
            }
        }
    }

    let answers = collect_init_answers(force_theme, target_dir)?;
    ensure_target_directory_ready(&answers.target_dir)?;

    match answers.kind {
        TemplateKind::Module => write_module_template(&answers)?,
        TemplateKind::Theme => write_theme_template(&answers)?,
    }

    if answers.run_npm_install {
        run_npm_install(&answers.target_dir)?;
    }

    Ok(answers.target_dir)
}

/// CLI entrypoint for standalone OpenVCS SDK commands.
fn main() -> ExitCode {
    let mut args: Vec<OsString> = env::args_os().skip(1).collect();

    if args.iter().any(|arg| {
        let value = arg.to_string_lossy();
        value == "-v" || value == "--version"
    }) {
        println!("openvcs-sdk {}", env!("CARGO_PKG_VERSION"));
        return ExitCode::SUCCESS;
    }

    let Some(command) = args
        .first()
        .and_then(|value| value.to_str())
        .map(|value| value.to_string())
    else {
        print_usage();
        return ExitCode::FAILURE;
    };

    args.remove(0);

    let result = match command.as_str() {
        "dist" => run_dist_command(&args).map(|path| {
            println!("{}", path.display());
        }),
        "init" => run_init_command(&args).map(|path| {
            println!("Initialized plugin at {}", path.display());
        }),
        "help" | "--help" | "-h" => {
            print_usage();
            Ok(())
        }
        other => Err(format!("unknown command: {other}")),
    };

    match result {
        Ok(()) => ExitCode::SUCCESS,
        Err(err) if err.is_empty() => ExitCode::SUCCESS,
        Err(err) => {
            eprintln!("{err}");
            ExitCode::FAILURE
        }
    }
}
