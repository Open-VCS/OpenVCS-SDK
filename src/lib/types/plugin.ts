// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

import type { RequestParams, RpcMethodHandler } from './protocol';

/** Describes the capability flags reported during plugin initialization. */
export interface PluginImplements {
  /** Indicates whether the plugin responds to `plugin.*` methods. */
  plugin: boolean;
  /** Indicates whether the plugin responds to `vcs.*` methods. */
  vcs: boolean;
}

/** Describes the handshake payload returned from `plugin.initialize`. */
export interface PluginInitializeResult {
  /** Stores the SDK protocol version mirrored from the host. */
  protocol_version: number;
  /** Stores the feature groups implemented by the plugin. */
  implements: PluginImplements;
}

/** Describes one optional override returned by a custom initialize handler. */
export type PluginInitializeOverride = Partial<PluginInitializeResult>;

/** Describes one plugin-contributed menu definition. */
export type PluginMenuDefinition = Record<string, unknown>;

/** Describes one plugin settings value payload. */
export type PluginSettingsValue = Record<string, unknown>;

/** Describes the params shape for plugin action handling. */
export interface PluginHandleActionParams extends RequestParams {
  /** Stores the action id selected by the user. */
  action_id?: string;
  /** Stores an optional payload supplied by the triggering UI. */
  payload?: Record<string, unknown>;
}

/** Describes the params shape for plugin settings callbacks. */
export interface PluginSettingsValuesParams extends RequestParams {
  /** Stores the list of values supplied by the host. */
  values?: unknown[];
}

/** Enumerates all host `plugin.*` method names. */
export type PluginMethodName =
  | 'plugin.initialize'
  | 'plugin.init'
  | 'plugin.deinit'
  | 'plugin.get_menus'
  | 'plugin.handle_action'
  | 'plugin.settings.defaults'
  | 'plugin.settings.on_load'
  | 'plugin.settings.on_apply'
  | 'plugin.settings.on_save'
  | 'plugin.settings.on_reset';

/** Describes the delegate map supported by the SDK runtime for `plugin.*`. */
export interface PluginDelegates<TContext = unknown> {
  /** Overrides the default handshake payload returned by `plugin.initialize`. */
  'plugin.initialize'?: RpcMethodHandler<
    RequestParams,
    PluginInitializeOverride,
    TContext
  >;
  /** Handles plugin startup work. */
  'plugin.init'?: RpcMethodHandler<RequestParams, null, TContext>;
  /** Handles plugin shutdown work. */
  'plugin.deinit'?: RpcMethodHandler<RequestParams, null, TContext>;
  /** Returns plugin-contributed menus. */
  'plugin.get_menus'?: RpcMethodHandler<
    RequestParams,
    PluginMenuDefinition[],
    TContext
  >;
  /** Handles a contributed plugin action. */
  'plugin.handle_action'?: RpcMethodHandler<
    PluginHandleActionParams,
    null,
    TContext
  >;
  /** Returns the default settings values for the plugin. */
  'plugin.settings.defaults'?: RpcMethodHandler<
    RequestParams,
    PluginSettingsValue[],
    TContext
  >;
  /** Transforms settings values when they are loaded. */
  'plugin.settings.on_load'?: RpcMethodHandler<
    PluginSettingsValuesParams,
    unknown[],
    TContext
  >;
  /** Applies settings values to the running plugin. */
  'plugin.settings.on_apply'?: RpcMethodHandler<
    PluginSettingsValuesParams,
    null,
    TContext
  >;
  /** Transforms settings values before they are saved. */
  'plugin.settings.on_save'?: RpcMethodHandler<
    PluginSettingsValuesParams,
    unknown[],
    TContext
  >;
  /** Resets plugin settings state. */
  'plugin.settings.on_reset'?: RpcMethodHandler<
    PluginSettingsValuesParams,
    null,
    TContext
  >;
}
