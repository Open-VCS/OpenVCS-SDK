// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

//! Plugin build pipeline utilities.
//!
//! This module provides internal utilities used by packaging.
//!
//! # Modules
//!
//! - `util` - Shared helper functions

pub(crate) mod util;

pub(crate) use util::read_to_string;
