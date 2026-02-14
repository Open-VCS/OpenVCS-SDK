use crate::dist::metadata::package_name_for_manifest;
use crate::dist::util::{find_local_core_path, has_pub_fn, run_status, toml_escape};
use crate::generated_guest_impl::GENERATED_COMPONENT_GUEST_IMPL;
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::Command;
use wasi_preview1_component_adapter_provider::WASI_SNAPSHOT_PREVIEW1_REACTOR_ADAPTER;
use wasmparser::{Encoding, Parser, Payload};
use wit_component::ComponentEncoder;

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
        "[package]\nname = \"openvcs-plugin-entry-shim\"\nversion = \"0.0.0\"\nedition = \"2021\"\n\n[dependencies]\n{core_dep}\nwit-bindgen = \"0.41\"\nserde = {{ version = \"1\", features = [\"derive\"] }}\nserde_json = \"1\"\nplugin_entry_dep = {{ package = \"{}\", path = \"{}\" }}\n\n{core_patch}[workspace]\n",
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

pub(crate) fn built_wasm_bin_path(target_dir: &Path, target: &str, bin: &str) -> PathBuf {
    let mut p = target_dir.to_path_buf();
    p.push(target);
    p.push("release");
    p.push(format!("{bin}.wasm"));
    p
}

pub(crate) fn ensure_wasm_magic(path: &Path) -> Result<(), String> {
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

pub(crate) fn platform_exec_filename(exec: &str) -> String {
    let exec = exec.trim();
    if exec.is_empty() {
        return String::new();
    }
    exec.to_string()
}
