//! OpenVCS Plugin SDK.
//!
//! This crate provides the core functionality for building and bundling
//! OpenVCS plugins. It is used by the `openvcs-plugin` CLI and
//! `cargo openvcs` subcommand.
//!
//! # Modules
//!
//! - [`dist`] - Plugin distribution and bundling (public API)
//! - [`build`] - Internal build pipeline utilities
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
//! # Binaries
//!
//! When using this crate as a dependency, the following binaries are available:
//!
//! - `openvcs-plugin` - Standalone plugin bundler
//! - `cargo-openvcs` - Cargo subcommand for bundling

pub(crate) mod build;
pub mod dist;

#[cfg(test)]
pub(crate) mod tests;
