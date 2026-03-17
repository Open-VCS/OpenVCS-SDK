// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

import type {
  PluginDelegates,
  PluginImplements,
  VcsDelegates,
} from '../types';

import type {
  CreatePluginRuntimeOptions,
  PluginRuntime,
  PluginRuntimeContext,
  PluginRuntimeTransport,
} from './contracts';
import { createPluginRuntime } from './factory';

/** Describes the plugin module startup hook invoked by the generated bootstrap. */
export type OnPluginStartHandler = () => void | Promise<void>;

/** Describes runtime-wide options applied by the generated bootstrap. */
export interface PluginModuleDefinition {
  /** Stores optional `plugin.*` delegates contributed by the plugin module. */
  plugin?: PluginDelegates<PluginRuntimeContext>;
  /** Stores optional `vcs.*` delegates contributed by the plugin module. */
  vcs?: VcsDelegates<PluginRuntimeContext>;
  /** Stores optional capability overrides for `plugin.initialize`. */
  implements?: Partial<PluginImplements>;
  /** Stores the `host.log` target emitted by the runtime. */
  logTarget?: string;
  /** Stores the timeout in milliseconds for request handlers. */
  timeout?: number;
  /** Called during stop() after pending operations complete. */
  onShutdown?: (error?: Error) => void | Promise<void>;
}

/** Describes one imported plugin module consumed by the generated bootstrap. */
export interface PluginBootstrapModule {
  /** Stores the plugin author's declarative runtime definition. */
  PluginDefinition?: PluginModuleDefinition;
  /** Stores the plugin author's startup hook. */
  OnPluginStart?: OnPluginStartHandler;
}

/** Describes the generated bootstrap inputs used to import and start a plugin. */
export interface BootstrapPluginModuleOptions {
  /** Imports the plugin author's compiled runtime module. */
  importPluginModule: () => Promise<PluginBootstrapModule>;
  /** Stores the plugin module path for error messages. */
  modulePath: string;
  /** Overrides the transport used by the runtime loop. */
  transport?: PluginRuntimeTransport;
}

/** Creates a runtime from one declarative plugin module definition. */
export function createRegisteredPluginRuntime(
  definition: PluginModuleDefinition = {},
): PluginRuntime {
  const options: CreatePluginRuntimeOptions = {
    plugin: definition.plugin,
    vcs: definition.vcs,
    implements: definition.implements,
    logTarget: definition.logTarget,
    timeout: definition.timeout,
    onShutdown: definition.onShutdown,
  };
  return createPluginRuntime(options);
}

/** Imports the author module, applies its definition, runs `OnPluginStart`, and starts the runtime loop. */
export async function bootstrapPluginModule(
  options: BootstrapPluginModuleOptions,
): Promise<PluginRuntime> {
  const pluginModule = await options.importPluginModule();
  const onPluginStart = pluginModule.OnPluginStart;

  if (typeof onPluginStart !== 'function') {
    throw new Error(
      `plugin module '${options.modulePath}' must export OnPluginStart()`,
    );
  }

  await onPluginStart();
  const runtime = createRegisteredPluginRuntime(pluginModule.PluginDefinition);
  runtime.start(options.transport);
  return runtime;
}
