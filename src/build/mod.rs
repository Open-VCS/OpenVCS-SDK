mod compile;
mod metadata;
mod shim;
mod util;
mod wasm;

pub(crate) use compile::build_plugin_wasi;
pub(crate) use metadata::resolve_target_dir;
#[cfg(test)]
pub(crate) use metadata::CargoMetadata;
pub(crate) use util::read_to_string;
#[cfg(test)]
pub(crate) use wasm::built_wasm_bin_path;
pub(crate) use wasm::{ensure_wasm_magic, platform_exec_filename};
