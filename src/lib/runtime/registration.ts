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
import {
  createMenuPluginDelegates,
  runRegisteredAction,
} from './menu';

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
  const menuDelegates = createMenuPluginDelegates();
  const explicitPluginDelegates = definition.plugin ?? {};
  const explicitGetMenus = explicitPluginDelegates['plugin.get_menus'];
  const explicitHandleAction = explicitPluginDelegates['plugin.handle_action'];

  const options: CreatePluginRuntimeOptions = {
    plugin: {
      ...explicitPluginDelegates,
      'plugin.get_menus': async (params, ctx) => {
        const menus = await menuDelegates['plugin.get_menus']?.(params, ctx);
        const explicitMenus = explicitGetMenus
          ? await explicitGetMenus(params, ctx)
          : [];
        return [
          ...(Array.isArray(explicitMenus) ? explicitMenus : []),
          ...(Array.isArray(menus) ? menus : []),
        ];
      },
      'plugin.handle_action': async (params, ctx) => {
        const actionId = String(params?.action_id || '').trim();
        if (actionId) {
          const result = await runRegisteredAction(actionId, params?.payload);
          if (result !== null && result !== undefined) {
            return result;
          }
        }
        if (explicitHandleAction) {
          return explicitHandleAction(params, ctx);
        }
        return null;
      },
    },
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

  try {
    await onPluginStart();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`plugin startup failed: ${message}`);
  }

  const runtime = createRegisteredPluginRuntime(pluginModule.PluginDefinition);
  runtime.start(options.transport);
  return runtime;
}
