// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

//! OpenVCS Plugin SDK.
//!
//! This crate provides the core functionality for building and bundling
//! OpenVCS plugins. It is used by the `cargo openvcs` subcommand.
//!
//! # Modules
//!
//! - [`dist`] - Plugin distribution and bundling (public API)
//! - `build` - Internal build pipeline utilities
//!
//! # Example
//!
//! ```ignore
//! use openvcs_sdk::dist::{bundle_plugin, parse_args};
//!
//! let args = parse_args(std::env::args_os().collect()).unwrap();
//! let output = bundle_plugin(&args).unwrap();
//! ```
//!
//! # Binary
//!
//! When installed via `cargo install openvcs-sdk`, this crate provides:
//!
//! - `cargo-openvcs` - Cargo subcommand for bundling plugins with `cargo openvcs ...`

pub(crate) mod build;
pub mod dist;

#[cfg(test)]
pub(crate) mod tests;
