// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

use crate::build::wasm::platform_exec_filename;
use crate::dist::args::parse_args;
use std::env;
use std::ffi::OsString;
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
