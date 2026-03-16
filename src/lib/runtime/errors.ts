// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

import { PLUGIN_FAILURE_CODE } from '../types';
import type { PluginFailure } from '../types';

/** Builds the host-facing plugin failure payload used for operational errors. */
export function pluginError(code: string, message: string): PluginFailure {
  return {
    code: PLUGIN_FAILURE_CODE,
    message,
    data: {
      code,
      message,
    },
  };
}

/** Returns whether the supplied value is a structured plugin failure. */
export function isPluginFailure(value: unknown): value is PluginFailure {
  if (value == null || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Partial<PluginFailure>;
  return candidate.code === PLUGIN_FAILURE_CODE && typeof candidate.message === 'string';
}
