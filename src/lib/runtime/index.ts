// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

import type {
  PluginRuntime,
  PluginRuntimeTransport,
} from './contracts';

export type {
  CreatePluginRuntimeOptions,
  PluginRuntime,
  PluginRuntimeContext,
  PluginRuntimeTransport,
} from './contracts';
export type {
  BootstrapPluginModuleOptions,
  OnPluginStartHandler,
  PluginBootstrapModule,
  PluginModuleDefinition,
} from './registration';
export { createDefaultPluginDelegates, createRuntimeDispatcher } from './dispatcher';
export { isPluginFailure, pluginError } from './errors';
export { createPluginRuntime } from './factory';
export { createHost } from './host';
export {
  bootstrapPluginModule,
  createRegisteredPluginRuntime,
} from './registration';
export { VcsDelegateBase } from './vcs-delegate-base';

/** Starts a previously created plugin runtime on process stdio. */
export function startPluginRuntime(
  runtime: PluginRuntime,
  transport?: PluginRuntimeTransport,
): void {
  runtime.start(transport);
}
