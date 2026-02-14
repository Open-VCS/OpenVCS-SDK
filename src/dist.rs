mod generated_guest_impl;

use generated_guest_impl::GENERATED_COMPONENT_GUEST_IMPL;
use serde::Deserialize;
use std::env;
use std::ffi::OsString;
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, ExitCode};
use std::time::{SystemTime, UNIX_EPOCH};
use wasi_preview1_component_adapter_provider::WASI_SNAPSHOT_PREVIEW1_REACTOR_ADAPTER;
use wasmparser::{Encoding, Parser, Payload};
use wit_component::ComponentEncoder;

fn usage() -> &'static str {
    "openvcs-plugin [args]\n\
\n\
  --plugin-dir <path>   Plugin repository root (contains openvcs.plugin.json)\n\
  --out <path>          Output directory (default: ./dist)\n\
\n\
Builds plugin executables and packages them into a single `.ovcsp` tar.xz.\n"
}

#[derive(Debug)]
pub struct PluginBuildArgs {
    pub plugin_dir: PathBuf,
    pub out_dir: PathBuf,
}

// Reduce clippy type complexity warnings for manifest parsing results.
type ManifestResult = Result<(String, Option<String>), String>;

#[derive(Debug, Deserialize)]
struct CargoMetadata {
    target_directory: PathBuf,
    #[serde(default)]
    packages: Vec<CargoMetadataPackage>,
}

#[derive(Debug, Deserialize)]
struct CargoMetadataPackage {
    name: String,
    manifest_path: String,
}

fn take_value(args: &mut Vec<OsString>, flag: &str) -> Result<String, String> {
    if args.is_empty() {
        return Err(format!("missing value for {flag}"));
    }
    Ok(args.remove(0).to_string_lossy().to_string())
}

pub fn parse_args(mut args: Vec<OsString>) -> Result<PluginBuildArgs, String> {
    let mut plugin_dir: Option<PathBuf> = None;
    let mut out_dir: PathBuf = PathBuf::from("dist");

    while let Some(arg) = args.first().cloned() {
        let s = arg.to_string_lossy();
        if !s.starts_with("--") {
            return Err(format!("unexpected argument: {s}"));
        }
        args.remove(0);
        match s.as_ref() {
            "--plugin-dir" => {
                plugin_dir = Some(PathBuf::from(take_value(&mut args, "--plugin-dir")?))
            }
            "--out" => out_dir = PathBuf::from(take_value(&mut args, "--out")?),
            "--help" => return Err(usage().to_string()),
            other => return Err(format!("unknown flag: {other}")),
        }
    }

    let plugin_dir =
        plugin_dir.unwrap_or_else(|| env::current_dir().unwrap_or_else(|_| PathBuf::from(".")));
    Ok(PluginBuildArgs {
        plugin_dir,
        out_dir,
    })
}

fn run_status(mut cmd: Command) -> Result<(), String> {
    let status = cmd
        .status()
        .map_err(|e| format!("failed to spawn process: {e}"))?;
    if status.success() {
        Ok(())
    } else {
        Err(format!("command failed with {status}"))
    }
}

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

fn cargo_metadata(plugin_dir: &Path) -> Option<CargoMetadata> {
    let manifest_path = plugin_dir.join("Cargo.toml");
    let output = Command::new("cargo")
        .arg("metadata")
        .arg("--format-version")
        .arg("1")
        .arg("--no-deps")
        .arg("--manifest-path")
        .arg(&manifest_path)
        .output();

    let output = match output {
        Ok(output) if output.status.success() => output,
        _ => return None,
    };

    serde_json::from_slice::<CargoMetadata>(&output.stdout).ok()
}

fn resolve_target_dir(plugin_dir: &Path) -> PathBuf {
    cargo_metadata(plugin_dir)
        .map(|m| m.target_directory)
        .unwrap_or_else(|| plugin_dir.join("target"))
}

fn package_name_for_manifest(plugin_dir: &Path) -> Option<String> {
    let manifest_path = plugin_dir.join("Cargo.toml");
    let manifest = manifest_path.to_string_lossy().replace('\\', "/");
    let metadata = cargo_metadata(plugin_dir)?;
    metadata
        .packages
        .iter()
        .find(|p| p.manifest_path.replace('\\', "/") == manifest)
        .map(|p| p.name.clone())
        .or_else(|| metadata.packages.first().map(|p| p.name.clone()))
}

fn has_pub_fn(path: &Path, fn_name: &str) -> bool {
    read_to_string(path)
        .ok()
        .is_some_and(|s| s.contains(&format!("pub fn {fn_name}(")))
}

fn find_local_core_path(plugin_dir: &Path) -> Option<PathBuf> {
    for ancestor in plugin_dir.ancestors() {
        let candidate = ancestor.join("Core").join("Cargo.toml");
        if candidate.is_file() {
            return Some(ancestor.join("Core"));
        }
    }
    None
}

fn toml_escape(value: &str) -> String {
    value.replace('\\', "\\\\").replace('"', "\\\"")
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

fn build_plugin_shim_target(
    plugin_dir: &Path,
    target_dir: &Path,
    target: &str,
) -> Result<PathBuf, String> {
    let plugin_package = package_name_for_manifest(plugin_dir)
        .ok_or_else(|| "unable to determine plugin package name".to_string())?;
    let plugin_entry = plugin_dir.join("src").join("plugin_entry.rs");
    if !plugin_entry.is_file() {
        return Err("missing src/plugin_entry.rs for SDK-generated entry shim".to_string());
    }
    if !has_pub_fn(&plugin_entry, "register_handlers") {
        return Err("plugin_entry.rs must define pub fn register_handlers()".to_string());
    }

    let has_init = has_pub_fn(&plugin_entry, "init");
    let _has_deinit = has_pub_fn(&plugin_entry, "deinit");

    let shim_root = target_dir.join("openvcs-shim");
    let shim_src = shim_root.join("src");
    fs::create_dir_all(&shim_src).map_err(|e| format!("mkdir {}: {e}", shim_src.display()))?;

    let local_core_path = find_local_core_path(plugin_dir)
        .ok_or_else(|| "unable to locate local Core/ for component shim generation".to_string())?;
    let core_path = toml_escape(&local_core_path.to_string_lossy());
    let core_dep =
        format!("openvcs-core = {{ path = \"{core_path}\", features = [\"plugin-protocol\"] }}");
    let core_patch = format!("[patch.crates-io]\nopenvcs-core = {{ path = \"{core_path}\" }}\n");
    let wit_path = toml_escape(&local_core_path.join("wit").to_string_lossy());

    let cargo_toml = format!(
        "[package]\nname = \"openvcs-plugin-entry-shim\"\nversion = \"0.0.0\"\nedition = \"2021\"\n\n[dependencies]\n{core_dep}\nwit-bindgen = \"0.41\"\nserde = {{ version = \"1\", features = [\"derive\"] }}\nserde_json = \"1\"\nplugin_entry_dep = {{ package = \"{}\", path = \"{}\" }}\n\n{core_patch}\n[workspace]\n",
        toml_escape(&plugin_package),
        toml_escape(&plugin_dir.to_string_lossy()),
    );
    fs::write(shim_root.join("Cargo.toml"), cargo_toml)
        .map_err(|e| format!("write {}: {e}", shim_root.join("Cargo.toml").display()))?;

    let shim_main = format!(
        r#"use std::sync::{{Mutex, OnceLock}};

wit_bindgen::generate!({{
    path: "{wit_path}",
    world: "openvcs-plugin",
    additional_derives: [serde::Serialize, serde::Deserialize],
    pub_export_macro: true,
}});

use exports::openvcs::plugin::plugin_api as api;
use openvcs::plugin::host_api;
use openvcs_core::plugin_runtime::PluginCtx;
use plugin_entry_dep::plugin_entry as plugin;

struct PluginState {{
    ctx: PluginCtx,
    inited: bool,
}}

static STATE: OnceLock<Mutex<PluginState>> = OnceLock::new();

fn to_plugin_error(err: openvcs_core::plugin_runtime::PluginError) -> api::PluginError {{
    api::PluginError {{
        code: err.code.unwrap_or_else(|| "plugin.error".to_string()),
        message: err.message,
    }}
}}

fn to_host_error(err: host_api::HostError) -> openvcs_core::plugin_runtime::PluginError {{
    openvcs_core::plugin_runtime::PluginError {{
        code: Some(err.code),
        message: err.message,
        data: None,
    }}
}}

fn init_host_bridge() {{
    let _ = openvcs_core::host::init_component_host(|method, params| {{
        match method {{
            "runtime.info" => {{
                let info = host_api::get_runtime_info().map_err(to_host_error)?;
                serde_json::to_value(info)
                    .map_err(|e| openvcs_core::plugin_runtime::PluginError::code("host.serialize", e.to_string()))
            }}
            "events.subscribe" => {{
                #[derive(serde::Deserialize)]
                struct Params {{
                    name: String,
                }}
                let p: Params = serde_json::from_value(params)
                    .map_err(|e| openvcs_core::plugin_runtime::PluginError::code("host.params", e.to_string()))?;
                host_api::subscribe_event(&p.name).map_err(to_host_error)?;
                Ok(serde_json::Value::Null)
            }}
            "events.emit" => {{
                #[derive(serde::Deserialize)]
                struct Params {{
                    name: String,
                    payload: Vec<u8>,
                }}
                let p: Params = serde_json::from_value(params)
                    .map_err(|e| openvcs_core::plugin_runtime::PluginError::code("host.params", e.to_string()))?;
                host_api::emit_event(&p.name, &p.payload).map_err(to_host_error)?;
                Ok(serde_json::Value::Null)
            }}
            "ui.notify" => {{
                #[derive(serde::Deserialize)]
                struct Params {{
                    message: String,
                }}
                let p: Params = serde_json::from_value(params)
                    .map_err(|e| openvcs_core::plugin_runtime::PluginError::code("host.params", e.to_string()))?;
                host_api::ui_notify(&p.message).map_err(to_host_error)?;
                Ok(serde_json::Value::Null)
            }}
            "workspace.readFile" => {{
                #[derive(serde::Deserialize)]
                struct Params {{
                    path: String,
                }}
                let p: Params = serde_json::from_value(params)
                    .map_err(|e| openvcs_core::plugin_runtime::PluginError::code("host.params", e.to_string()))?;
                let content = host_api::workspace_read_file(&p.path).map_err(to_host_error)?;
                Ok(serde_json::Value::String(String::from_utf8_lossy(&content).to_string()))
            }}
            "workspace.writeFile" => {{
                #[derive(serde::Deserialize)]
                struct Params {{
                    path: String,
                    content: String,
                }}
                let p: Params = serde_json::from_value(params)
                    .map_err(|e| openvcs_core::plugin_runtime::PluginError::code("host.params", e.to_string()))?;
                host_api::workspace_write_file(&p.path, p.content.as_bytes()).map_err(to_host_error)?;
                Ok(serde_json::Value::Null)
            }}
            "process.exec" | "process.execGit" => {{
                #[derive(serde::Deserialize)]
                struct Params {{
                    #[serde(default)]
                    program: String,
                    #[serde(default)]
                    cwd: Option<String>,
                    #[serde(default)]
                    args: Vec<String>,
                    #[serde(default)]
                    env: serde_json::Map<String, serde_json::Value>,
                    #[serde(default)]
                    stdin: Option<String>,
                }}
                let p: Params = serde_json::from_value(params)
                    .map_err(|e| openvcs_core::plugin_runtime::PluginError::code("host.params", e.to_string()))?;
                if !p.program.is_empty() && p.program != "git" {{
                    return Err(openvcs_core::plugin_runtime::PluginError::code(
                        "host.invalid_program",
                        format!("unsupported process program: {{}}", p.program),
                    ));
                }}
                let env: Vec<host_api::EnvVar> = p
                    .env
                    .into_iter()
                    .map(|(key, value)| host_api::EnvVar {{
                        key,
                        value: value.as_str().unwrap_or("").to_string(),
                    }})
                    .collect();
                let cwd = p.cwd.as_deref().filter(|s| !s.is_empty());
                let stdin = p.stdin.as_deref().filter(|s| !s.is_empty());
                let out = host_api::process_exec_git(
                    cwd,
                    &p.args,
                    &env,
                    stdin,
                )
                .map_err(to_host_error)?;
                serde_json::to_value(out)
                    .map_err(|e| openvcs_core::plugin_runtime::PluginError::code("host.serialize", e.to_string()))
            }}
            other => Err(openvcs_core::plugin_runtime::PluginError::code(
                "host.method_not_found",
                format!("unsupported host method: {{other}}"),
            )),
        }}
    }});
}}

fn state() -> &'static Mutex<PluginState> {{
    STATE.get_or_init(|| {{
        init_host_bridge();
        plugin::register_handlers();
        let ctx = PluginCtx::new(|event| {{
            if let Ok(payload) = serde_json::to_vec(&event) {{
                let _ = host_api::emit_event("plugin.event", &payload);
            }}
        }});
        Mutex::new(PluginState {{ ctx, inited: false }})
    }})
}}

fn ensure_init_inner(s: &mut PluginState) -> Result<(), api::PluginError> {{
    if s.inited {{
        return Ok(());
    }}
    {init_call}
    s.inited = true;
    Ok(())
}}

fn call_json(method: &str, params: serde_json::Value) -> Result<serde_json::Value, api::PluginError> {{
    let mut lock = state().lock().map_err(|_| api::PluginError {{
        code: "plugin.state_poisoned".to_string(),
        message: "plugin state lock poisoned".to_string(),
    }})?;
    ensure_init_inner(&mut lock)?;
    let params_json = serde_json::to_string(&params).map_err(|e| api::PluginError {{
        code: "plugin.serialize".to_string(),
        message: e.to_string(),
    }})?;
    let out_json = openvcs_core::plugin_runtime::dispatch_registered_json(&mut lock.ctx, method, &params_json)
        .map_err(to_plugin_error)?;
    serde_json::from_str(&out_json).map_err(|e| api::PluginError {{
        code: "plugin.deserialize".to_string(),
        message: e.to_string(),
    }})
}}

fn call_unit(method: &str, params: serde_json::Value) -> Result<(), api::PluginError> {{
    let _ = call_json(method, params)?;
    Ok(())
}}

fn call_typed<T: serde::de::DeserializeOwned>(method: &str, params: serde_json::Value) -> Result<T, api::PluginError> {{
    let value = call_json(method, params)?;
    serde_json::from_value(value).map_err(|e| api::PluginError {{
        code: "plugin.deserialize".to_string(),
        message: e.to_string(),
    }})
}}

fn call_branches() -> Result<Vec<api::BranchItem>, api::PluginError> {{
    let value = call_json("branches", serde_json::Value::Null)?;
    let list = value.as_array().ok_or_else(|| api::PluginError {{
        code: "plugin.deserialize".to_string(),
        message: "branches result is not an array".to_string(),
    }})?;
    let mut out = Vec::with_capacity(list.len());
    for item in list {{
        let name = item
            .get("name")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string();
        let full_ref = item
            .get("full_ref")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string();
        let current = item
            .get("current")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);
        let kind = match item.get("kind") {{
            Some(kind_obj) => {{
                let ty = kind_obj
                    .get("type")
                    .and_then(|v| v.as_str())
                    .unwrap_or("unknown")
                    .to_ascii_lowercase();
                match ty.as_str() {{
                    "local" => api::BranchKind::Local,
                    "remote" => api::BranchKind::Remote(
                        kind_obj
                            .get("remote")
                            .and_then(|v| v.as_str())
                            .unwrap_or_default()
                            .to_string(),
                    ),
                    _ => api::BranchKind::Unknown,
                }}
            }}
            None => api::BranchKind::Unknown,
        }};
        out.push(api::BranchItem {{
            name,
            full_ref,
            kind,
            current,
        }});
    }}
    Ok(out)
}}

struct Component;

impl api::Guest for Component {{
{guest_impl}
}}

export!(Component);

fn main() {{}}
"#,
        wit_path = wit_path,
        init_call = if has_init {
            "plugin::init(&mut s.ctx).map_err(to_plugin_error)?;"
        } else {
            ""
        },
        guest_impl = GENERATED_COMPONENT_GUEST_IMPL,
    );
    fs::write(shim_src.join("main.rs"), shim_main)
        .map_err(|e| format!("write {}: {e}", shim_src.join("main.rs").display()))?;

    let shim_target_dir = target_dir.join("openvcs-shim-target");
    let mut cmd = Command::new("cargo");
    cmd.current_dir(&shim_root);
    cmd.arg("build");
    cmd.arg("--release");
    cmd.arg("--manifest-path");
    cmd.arg(shim_root.join("Cargo.toml"));
    cmd.arg("--target-dir");
    cmd.arg(&shim_target_dir);
    cmd.args(["--bin", "openvcs-plugin-entry-shim"]);
    cmd.args(["--target", target]);
    run_status(cmd)?;
    Ok(built_wasm_bin_path(
        &shim_target_dir,
        target,
        "openvcs-plugin-entry-shim",
    ))
}

fn build_plugin_wasi(plugin_dir: &Path, target_dir: &Path, bin: &str) -> Result<PathBuf, String> {
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
        // Prefer a plugin-provided bin target when present. This supports
        // component-model plugins that export the WIT ABI directly.
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
            // Compatibility path for older plugin-runtime style crates.
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

fn is_component_module(bytes: &[u8]) -> Result<bool, String> {
    for payload in Parser::new(0).parse_all(bytes) {
        let payload = payload.map_err(|e| format!("parse wasm: {e}"))?;
        if let Payload::Version { encoding, .. } = payload {
            return Ok(matches!(encoding, Encoding::Component));
        }
    }
    Err("unable to detect wasm encoding".to_string())
}

fn ensure_component_module(path: &Path) -> Result<(), String> {
    let module = fs::read(path).map_err(|e| format!("read {}: {e}", path.display()))?;
    if is_component_module(&module)? {
        return Ok(());
    }

    let component = ComponentEncoder::default()
        .module(&module)
        .map_err(|e| format!("componentize module {}: {e}", path.display()))?
        .adapter(
            "wasi_snapshot_preview1",
            WASI_SNAPSHOT_PREVIEW1_REACTOR_ADAPTER,
        )
        .map_err(|e| format!("set preview1 adapter {}: {e}", path.display()))?
        .validate(true)
        .encode()
        .map_err(|e| format!("encode component {}: {e}", path.display()))?;

    fs::write(path, component).map_err(|e| format!("write {}: {e}", path.display()))
}

fn built_wasm_bin_path(target_dir: &Path, target: &str, bin: &str) -> PathBuf {
    let mut p = target_dir.to_path_buf();
    p.push(target);
    p.push("release");
    p.push(format!("{bin}.wasm"));
    p
}

fn ensure_wasm_magic(path: &Path) -> Result<(), String> {
    let mut f = fs::File::open(path).map_err(|e| format!("open {}: {e}", path.display()))?;
    let mut magic = [0u8; 4];
    let n = f
        .read(&mut magic)
        .map_err(|e| format!("read {}: {e}", path.display()))?;
    if n < magic.len() || magic != [0x00, 0x61, 0x73, 0x6d] {
        return Err(format!(
            "built exec is not a wasm module (WASM-only plugins): {}",
            path.display()
        ));
    }
    Ok(())
}

fn platform_exec_filename(exec: &str) -> String {
    let exec = exec.trim();
    if exec.is_empty() {
        return String::new();
    }
    exec.to_string()
}

fn read_to_string(path: &Path) -> Result<String, String> {
    fs::read_to_string(path).map_err(|e| format!("read {}: {e}", path.display()))
}

#[derive(Debug, Deserialize)]
struct PluginManifestModule {
    #[serde(default)]
    exec: Option<String>,
}

#[derive(Debug, Deserialize)]
struct PluginManifest {
    id: String,
    #[serde(default)]
    module: Option<PluginManifestModule>,
}

fn parse_manifest_text(text: &str, manifest_path: &Path) -> ManifestResult {
    let manifest: PluginManifest = serde_json::from_str(text)
        .map_err(|e| format!("parse {}: {e}", manifest_path.display()))?;

    let id = manifest.id.trim().to_string();
    if id.is_empty() {
        return Err(format!(
            "manifest {} is missing a string 'id'",
            manifest_path.display()
        ));
    }

    let exec = manifest
        .module
        .and_then(|m| m.exec)
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());

    Ok((id, exec))
}

fn manifest_defaults(plugin_dir: &Path) -> ManifestResult {
    let manifest_path = plugin_dir.join("openvcs.plugin.json");
    if !manifest_path.is_file() {
        return Err(format!(
            "missing openvcs.plugin.json at {}",
            manifest_path.display()
        ));
    }
    let text = read_to_string(&manifest_path)?;
    parse_manifest_text(&text, &manifest_path)
}

fn unique_staging_dir(out_dir: &Path) -> PathBuf {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    out_dir.join(format!(".openvcs-plugin-staging-{now}"))
}

const ICON_EXTENSIONS: &[&str] = &["png", "jpg", "jpeg", "webp", "avif", "svg"];

fn reject_symlinks_recursive(dir: &Path) -> Result<(), String> {
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

fn write_tar_xz(out_path: &Path, base_dir: &Path, folder_name: &str) -> Result<(), String> {
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

fn copy_dir_recursive(src: &Path, dst: &Path) -> Result<(), String> {
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

fn copy_icon(plugin_dir: &Path, bundle_dir: &Path) -> Result<(), String> {
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

pub fn bundle_plugin(args: &PluginBuildArgs) -> Result<PathBuf, String> {
    let (manifest_id, module_exec) = manifest_defaults(&args.plugin_dir)?;
    let plugin_id = manifest_id;

    let has_wasm = module_exec.is_some();
    let has_ui_or_assets = args.plugin_dir.join("themes").is_dir();
    if !has_wasm && !has_ui_or_assets {
        return Err("manifest has no module.exec or themes/".to_string());
    }

    let manifest_src = args.plugin_dir.join("openvcs.plugin.json");

    fs::create_dir_all(&args.out_dir)
        .map_err(|e| format!("failed to create {}: {e}", args.out_dir.display()))?;

    let staging_root = unique_staging_dir(&args.out_dir);
    let bundle_dir = staging_root.join(&plugin_id);
    let bin_dir = bundle_dir.join("bin");

    fs::create_dir_all(&bin_dir)
        .map_err(|e| format!("failed to create {}: {e}", bin_dir.display()))?;

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

        let bin = exec
            .strip_suffix(".wasm")
            .ok_or_else(|| format!("invalid wasm exec: {exec}"))?
            .to_string();
        let bin_src = build_plugin_wasi(&args.plugin_dir, &target_dir, &bin)?;
        if !bin_src.is_file() {
            return Err(format!(
                "built wasm not found at {} (did cargo build succeed?)",
                bin_src.display()
            ));
        }
        ensure_wasm_magic(&bin_src)?;
        let bin_dst = bin_dir.join(platform_exec_filename(&exec));
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
    write_tar_xz(&out_path, &staging_root, &plugin_id)?;

    let _ = fs::remove_dir_all(&staging_root);

    Ok(out_path)
}

pub fn run_plugin_cli() -> ExitCode {
    let mut args: Vec<OsString> = env::args_os().collect();
    let _exe = args.remove(0);

    let parsed = match parse_args(args) {
        Ok(p) => p,
        Err(msg) => {
            eprintln!("{msg}");
            return ExitCode::from(2);
        }
    };

    match bundle_plugin(&parsed) {
        Ok(path) => {
            println!("{}", path.display());
            ExitCode::SUCCESS
        }
        Err(err) => {
            eprintln!("{err}");
            ExitCode::from(1)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeMap;
    use std::fs;
    use std::io::Cursor;
    use std::io::Read;
    use std::path::PathBuf;

    #[test]
    fn platform_exec_filename_leaves_wasm_unchanged() {
        assert_eq!(platform_exec_filename("plugin.wasm"), "plugin.wasm");
    }

    #[test]
    fn platform_exec_filename_trims_whitespace_and_handles_empty() {
        assert_eq!(platform_exec_filename("  plugin.wasm  "), "plugin.wasm");
        assert_eq!(platform_exec_filename("   "), "");
        assert_eq!(platform_exec_filename(""), "");
    }

    #[test]
    fn parse_args_requires_flags() {
        let err = parse_args(vec![OsString::from("not-a-flag")]).unwrap_err();
        assert!(err.contains("unexpected argument:"), "{err}");
    }

    #[test]
    fn parse_args_rejects_unknown_flag() {
        let err = parse_args(vec![OsString::from("--nope")]).unwrap_err();
        assert_eq!(err, "unknown flag: --nope");
    }

    #[test]
    fn parse_args_requires_flag_values() {
        let err = parse_args(vec![OsString::from("--plugin-dir")]).unwrap_err();
        assert_eq!(err, "missing value for --plugin-dir");

        let err = parse_args(vec![OsString::from("--out")]).unwrap_err();
        assert_eq!(err, "missing value for --out");
    }

    #[test]
    fn parse_args_parses_plugin_dir_and_out_dir() {
        let args = vec![
            OsString::from("--plugin-dir"),
            OsString::from("some/plugin"),
            OsString::from("--out"),
            OsString::from("some/out"),
        ];
        let parsed = parse_args(args).unwrap();
        assert_eq!(parsed.plugin_dir, PathBuf::from("some/plugin"));
        assert_eq!(parsed.out_dir, PathBuf::from("some/out"));
    }

    #[test]
    fn parse_args_defaults_out_dir_to_dist() {
        let args = vec![
            OsString::from("--plugin-dir"),
            OsString::from("some/plugin"),
        ];
        let parsed = parse_args(args).unwrap();
        assert_eq!(parsed.out_dir, PathBuf::from("dist"));
    }

    #[test]
    fn parse_args_defaults_plugin_dir_to_current_dir() {
        let parsed = parse_args(vec![]).unwrap();
        assert_eq!(parsed.out_dir, PathBuf::from("dist"));
        assert_eq!(parsed.plugin_dir, env::current_dir().unwrap());
    }

    #[test]
    fn parse_args_help_prints_usage_via_error() {
        let err = parse_args(vec![OsString::from("--help")]).unwrap_err();
        assert!(err.contains("openvcs-plugin [args]"), "{err}");
    }

    struct VirtualPlugin {
        manifest_json: String,
        root_files: BTreeMap<String, Vec<u8>>,
        wasm_execs: BTreeMap<String, Vec<u8>>,
    }

    impl VirtualPlugin {
        fn new(manifest_json: impl Into<String>) -> Self {
            Self {
                manifest_json: manifest_json.into(),
                root_files: BTreeMap::new(),
                wasm_execs: BTreeMap::new(),
            }
        }

        fn add_root_file(mut self, path: &str, content: impl Into<Vec<u8>>) -> Self {
            self.root_files.insert(path.to_string(), content.into());
            self
        }

        fn add_wasm_exec(mut self, exec: &str, content: impl Into<Vec<u8>>) -> Self {
            self.wasm_execs.insert(exec.to_string(), content.into());
            self
        }
    }

    fn virtual_bundle_tar_xz_bytes(plugin: &VirtualPlugin) -> Result<(String, Vec<u8>), String> {
        let manifest_path = PathBuf::from("<memory>/openvcs.plugin.json");
        let (plugin_id, module_exec) = parse_manifest_text(&plugin.manifest_json, &manifest_path)?;

        let has_themes = plugin
            .root_files
            .keys()
            .any(|k| k == "themes" || k.starts_with("themes/"));
        let has_wasm = module_exec.is_some();
        let has_ui_or_assets = has_themes;
        if !has_wasm && !has_ui_or_assets {
            return Err("manifest has no module.exec or themes/".to_string());
        }

        let cursor = Cursor::new(Vec::<u8>::new());
        let encoder = xz2::write::XzEncoder::new(cursor, 6);
        let mut tar = tar::Builder::new(encoder);

        {
            let mut header = tar::Header::new_gnu();
            let bytes = plugin.manifest_json.as_bytes();
            header.set_size(bytes.len() as u64);
            header.set_cksum();
            tar.append_data(
                &mut header,
                format!("{plugin_id}/openvcs.plugin.json"),
                bytes,
            )
            .map_err(|e| format!("tar append manifest failed: {e}"))?;
        }

        for ext in ICON_EXTENSIONS {
            let name = format!("icon.{ext}");
            if let Some(bytes) = plugin.root_files.get(&name) {
                let mut header = tar::Header::new_gnu();
                header.set_size(bytes.len() as u64);
                header.set_cksum();
                tar.append_data(&mut header, format!("{plugin_id}/{name}"), bytes.as_slice())
                    .map_err(|e| format!("tar append icon failed: {e}"))?;
                break;
            }
        }

        for (path, bytes) in &plugin.root_files {
            if !path.starts_with("themes/") {
                continue;
            }
            let mut header = tar::Header::new_gnu();
            header.set_size(bytes.len() as u64);
            header.set_cksum();
            tar.append_data(&mut header, format!("{plugin_id}/{path}"), bytes.as_slice())
                .map_err(|e| format!("tar append theme failed: {e}"))?;
        }

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

            let bytes = plugin.wasm_execs.get(&exec).ok_or_else(|| {
                format!(
                    "built wasm not found at {} (did cargo build succeed?)",
                    PathBuf::from("<memory>/target/wasm32-wasip1/release")
                        .join(&exec)
                        .display()
                )
            })?;

            let mut header = tar::Header::new_gnu();
            header.set_size(bytes.len() as u64);
            header.set_cksum();
            tar.append_data(
                &mut header,
                format!("{plugin_id}/bin/{exec}"),
                bytes.as_slice(),
            )
            .map_err(|e| format!("tar append wasm failed: {e}"))?;
        }

        let encoder = tar
            .into_inner()
            .map_err(|e| format!("tar finish failed: {e}"))?;
        let cursor = encoder
            .finish()
            .map_err(|e| format!("xz finish failed: {e}"))?;

        Ok((plugin_id, cursor.into_inner()))
    }

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
            let path = env::temp_dir().join(format!("openvcs-sdk-tests-{prefix}-{pid}-{now}"));
            fs::create_dir_all(&path).unwrap();
            Self { path }
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.path);
        }
    }

    fn write_file(path: &Path, content: &[u8]) {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        fs::write(path, content).unwrap();
    }

    #[test]
    fn parse_manifest_text_parses_and_trims_fields() {
        let (id, module_exec) = parse_manifest_text(
            r#"{
  "id": "  my.plugin  ",
  "module": { "exec": "  module.wasm  " }
}"#,
            Path::new("<memory>/openvcs.plugin.json"),
        )
        .unwrap();
        assert_eq!(id, "my.plugin");
        assert_eq!(module_exec.as_deref(), Some("module.wasm"));
    }

    #[test]
    fn parse_manifest_text_errors_when_id_is_empty() {
        let err = parse_manifest_text(
            r#"{ "id": "   " }"#,
            Path::new("<memory>/openvcs.plugin.json"),
        )
        .unwrap_err();
        assert!(err.contains("missing a string 'id'"), "{err}");
    }

    #[test]
    fn parse_manifest_text_errors_on_invalid_json_with_path_context() {
        let err = parse_manifest_text("{", Path::new("some/path/openvcs.plugin.json")).unwrap_err();
        assert!(
            err.contains("parse some/path/openvcs.plugin.json:"),
            "{err}"
        );
    }

    #[test]
    fn parse_manifest_text_treats_whitespace_only_optional_fields_as_none() {
        let (id, module_exec) = parse_manifest_text(
            r#"{ "id": "x", "module": { "exec": "   " } }"#,
            Path::new("<memory>/openvcs.plugin.json"),
        )
        .unwrap();
        assert_eq!(id, "x");
        assert_eq!(module_exec, None);
    }

    #[test]
    fn parse_manifest_text_ignores_functions_field() {
        let (id, module_exec) = parse_manifest_text(
            r#"{ "id": "x", "module": { "exec": "m.wasm" }, "functions": { "exec": "f.wasm" } }"#,
            Path::new("<memory>/openvcs.plugin.json"),
        )
        .unwrap();
        assert_eq!(id, "x");
        assert_eq!(module_exec.as_deref(), Some("m.wasm"));
    }

    #[test]
    fn copy_dir_recursive_copies_nested_files() {
        let tmp = TempDir::new("copy_dir_recursive");
        let src = tmp.path.join("src");
        let dst = tmp.path.join("dst");
        write_file(&src.join("a.txt"), b"a");
        write_file(&src.join("nested/b.txt"), b"b");

        copy_dir_recursive(&src, &dst).unwrap();

        assert_eq!(fs::read(dst.join("a.txt")).unwrap(), b"a");
        assert_eq!(fs::read(dst.join("nested/b.txt")).unwrap(), b"b");
    }

    #[test]
    fn virtual_bundle_packages_themes_only_plugins() {
        let plugin = VirtualPlugin::new(
            r#"{
  "id": "ui-only"
}"#,
        )
        .add_root_file("themes/theme.json", br#"{"name":"t"}"#)
        .add_root_file("icon.png", b"icon");

        let (plugin_id, bundle_bytes) = virtual_bundle_tar_xz_bytes(&plugin).unwrap();
        assert_eq!(plugin_id, "ui-only");

        let entries = read_tar_xz_entries_bytes(&bundle_bytes);
        assert!(entries.contains_key("ui-only/openvcs.plugin.json"));
        assert!(entries.contains_key("ui-only/themes/theme.json"));
        assert_eq!(entries.get("ui-only/icon.png").unwrap(), b"icon");
    }

    #[test]
    fn virtual_bundle_errors_when_manifest_has_nothing_to_bundle() {
        let plugin = VirtualPlugin::new(r#"{ "id": "x" }"#);
        let err = virtual_bundle_tar_xz_bytes(&plugin).unwrap_err();
        assert_eq!(err, "manifest has no module.exec or themes/");
    }

    #[test]
    fn virtual_bundle_allows_themes_only_plugins() {
        let plugin = VirtualPlugin::new(r#"{ "id": "x" }"#)
            .add_root_file("themes/theme.json", br#"{"name":"t"}"#);
        let (_plugin_id, bundle_bytes) = virtual_bundle_tar_xz_bytes(&plugin).unwrap();
        let entries = read_tar_xz_entries_bytes(&bundle_bytes);
        assert!(entries.contains_key("x/openvcs.plugin.json"));
        assert!(entries.contains_key("x/themes/theme.json"));
    }

    #[test]
    fn virtual_bundle_rejects_non_wasm_exec() {
        let plugin = VirtualPlugin::new(r#"{ "id": "x", "module": { "exec": "not-wasm" } }"#);
        let err = virtual_bundle_tar_xz_bytes(&plugin).unwrap_err();
        assert_eq!(
            err,
            "manifest exec must end with .wasm (OpenVCS is WASM-only): not-wasm"
        );
    }

    #[test]
    fn virtual_bundle_allows_manifest_entry_field() {
        let plugin = VirtualPlugin::new(
            r#"{ "id": "x", "entry": "ui/index.html", "module": { "exec": "module.wasm" } }"#,
        )
        .add_wasm_exec("module.wasm", b"\0asm");
        let (_plugin_id, bundle_bytes) = virtual_bundle_tar_xz_bytes(&plugin).unwrap();
        let entries = read_tar_xz_entries_bytes(&bundle_bytes);
        assert!(entries.contains_key("x/openvcs.plugin.json"));
        assert_eq!(entries.get("x/bin/module.wasm").unwrap(), b"\0asm");
    }

    #[test]
    fn virtual_bundle_errors_when_wasm_missing() {
        let plugin = VirtualPlugin::new(r#"{ "id": "x", "module": { "exec": "module.wasm" } }"#);
        let err = virtual_bundle_tar_xz_bytes(&plugin).unwrap_err();
        assert_eq!(
            err,
            "built wasm not found at <memory>/target/wasm32-wasip1/release/module.wasm (did cargo build succeed?)"
        );
    }

    #[test]
    fn virtual_bundle_includes_wasm_exec_in_bin() {
        let plugin = VirtualPlugin::new(r#"{ "id": "x", "module": { "exec": "module.wasm" } }"#)
            .add_wasm_exec("module.wasm", b"\0asm");

        let (_plugin_id, bundle_bytes) = virtual_bundle_tar_xz_bytes(&plugin).unwrap();
        let entries = read_tar_xz_entries_bytes(&bundle_bytes);
        assert_eq!(entries.get("x/bin/module.wasm").unwrap(), b"\0asm");
    }

    #[test]
    fn virtual_bundle_trims_exec_field() {
        let plugin =
            VirtualPlugin::new(r#"{ "id": "x", "module": { "exec": "  module.wasm  " } }"#)
                .add_wasm_exec("module.wasm", b"x");

        let (_plugin_id, bundle_bytes) = virtual_bundle_tar_xz_bytes(&plugin).unwrap();
        let entries = read_tar_xz_entries_bytes(&bundle_bytes);
        assert_eq!(entries.get("x/bin/module.wasm").unwrap(), b"x");
    }

    #[test]
    fn virtual_bundle_ignores_functions_field() {
        let plugin = VirtualPlugin::new(
            r#"{ "id": "x", "module": { "exec": "module.wasm" }, "functions": { "exec": "func.wasm" } }"#,
        )
        .add_wasm_exec("module.wasm", b"\0asm")
        .add_wasm_exec("func.wasm", b"\0asm2");
        let (_plugin_id, bundle_bytes) = virtual_bundle_tar_xz_bytes(&plugin).unwrap();
        let entries = read_tar_xz_entries_bytes(&bundle_bytes);
        assert_eq!(entries.get("x/bin/module.wasm").unwrap(), b"\0asm");
        assert!(!entries.contains_key("x/bin/func.wasm"));
    }

    #[test]
    fn virtual_bundle_prefers_icon_extension_order() {
        let plugin = VirtualPlugin::new(r#"{ "id": "x" }"#)
            .add_root_file("themes/theme.json", br#"{"name":"t"}"#)
            .add_root_file("icon.jpg", b"jpg")
            .add_root_file("icon.png", b"png");

        let (_plugin_id, bundle_bytes) = virtual_bundle_tar_xz_bytes(&plugin).unwrap();
        let entries = read_tar_xz_entries_bytes(&bundle_bytes);
        assert_eq!(entries.get("x/icon.png").unwrap(), b"png");
        assert!(!entries.contains_key("x/icon.jpg"));
    }

    fn read_tar_xz_entries_bytes(bundle_bytes: &[u8]) -> BTreeMap<String, Vec<u8>> {
        let cursor = Cursor::new(bundle_bytes);
        let decoder = xz2::read::XzDecoder::new(cursor);
        let mut tar = tar::Archive::new(decoder);
        let mut out = BTreeMap::new();
        for entry in tar.entries().unwrap() {
            let mut entry = entry.unwrap();
            if !entry.header().entry_type().is_file() {
                continue;
            }
            let name = entry.path().unwrap().to_string_lossy().to_string();
            let mut buf = Vec::new();
            entry.read_to_end(&mut buf).unwrap();
            out.insert(name, buf);
        }
        out
    }

    #[test]
    fn manifest_defaults_errors_when_missing_manifest() {
        let tmp = TempDir::new("manifest_defaults_missing_manifest");
        let plugin_dir = tmp.path.join("plugin");
        fs::create_dir_all(&plugin_dir).unwrap();
        let err = manifest_defaults(&plugin_dir).unwrap_err();
        assert!(err.contains("missing openvcs.plugin.json"), "{err}");
    }

    #[test]
    fn resolve_target_dir_parses_metadata_target_directory() {
        let metadata = br#"{"target_directory":"/tmp/openvcs-target"}"#;
        let parsed: CargoMetadata = serde_json::from_slice(metadata).unwrap();
        assert_eq!(
            parsed.target_directory,
            PathBuf::from("/tmp/openvcs-target")
        );
    }

    #[test]
    fn built_wasm_bin_path_uses_resolved_target_directory() {
        let path = built_wasm_bin_path(
            Path::new("/tmp/workspace-target"),
            "wasm32-wasip1",
            "openvcs-git-plugin",
        );
        assert_eq!(
            path,
            PathBuf::from("/tmp/workspace-target/wasm32-wasip1/release/openvcs-git-plugin.wasm")
        );
    }
}
