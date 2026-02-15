// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

//! Plugin build pipeline utilities.
//!
//! This module provides internal utilities for building plugin WASM modules,
//! resolving cargo metadata, and validating WASM binaries.
//!
//! # Modules
//!
//! - `compile` - WASM compilation and build orchestration
//! - `metadata` - Cargo metadata extraction
//! - `util` - Shared helper functions
//! - `wasm` - WASM validation and component encoding

pub(crate) mod compile;
pub(crate) mod metadata;
pub(crate) mod util;
pub(crate) mod wasm;

pub(crate) use compile::build_plugin_wasi;
pub(crate) use metadata::resolve_target_dir;
pub(crate) use util::read_to_string;
pub(crate) use wasm::ensure_wasm_magic;
