use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use wasi_preview1_component_adapter_provider::WASI_SNAPSHOT_PREVIEW1_REACTOR_ADAPTER;
use wasmparser::{Encoding, Parser, Payload};
use wit_component::ComponentEncoder;

pub(crate) fn is_component_module(bytes: &[u8]) -> Result<bool, String> {
    for payload in Parser::new(0).parse_all(bytes) {
        let payload = payload.map_err(|e| format!("parse wasm: {e}"))?;
        if let Payload::Version { encoding, .. } = payload {
            return Ok(matches!(encoding, Encoding::Component));
        }
    }
    Err("unable to detect wasm encoding".to_string())
}

pub(crate) fn ensure_component_module(path: &Path) -> Result<(), String> {
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
