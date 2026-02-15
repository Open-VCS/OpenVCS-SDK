//! OpenVCS Plugin SDK CLI binary.
//!
//! This binary provides the `openvcs-plugin` command for bundling OpenVCS plugins.
//!
//! # Usage
//!
//! ```text
//! openvcs-plugin --plugin-dir <path> --out <path>
//! ```
//!
//! # Exit Codes
//!
//! - `0` - Success
//! - `1` - Build or bundling error
//! - `2` - Argument parsing error
//!
//! See [`openvcs_sdk::dist`] for the underlying implementation.

use openvcs_sdk::dist;

fn main() -> std::process::ExitCode {
    dist::run_plugin_cli()
}
