pub(crate) mod compile;
pub(crate) mod metadata;
pub(crate) mod util;
pub(crate) mod wasm;

pub(crate) use compile::build_plugin_wasi;
pub(crate) use metadata::resolve_target_dir;
pub(crate) use util::read_to_string;
pub(crate) use wasm::{ensure_wasm_magic, platform_exec_filename};
