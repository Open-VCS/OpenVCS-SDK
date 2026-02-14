use crate::build::metadata::package_name_for_manifest;
use crate::build::util::{find_local_core_path, has_pub_fn, run_status, toml_escape};
use crate::build::wasm::built_wasm_bin_path;
use crate::generated_guest_impl::GENERATED_COMPONENT_GUEST_IMPL;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

pub(crate) fn build_plugin_shim_target(
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
