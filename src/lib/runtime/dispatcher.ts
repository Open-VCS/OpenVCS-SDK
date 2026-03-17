// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

import {
  PLUGIN_INTERNAL_ERROR_CODE,
  PROTOCOL_VERSION,
  PROTOCOL_VERSION_MISMATCH_CODE,
} from '../types';
import type {
  JsonRpcId,
  PluginDelegates,
  PluginImplements,
  RequestParams,
  RpcMethodHandler,
  VcsDelegates,
} from '../types';
import type { PluginHost } from '../types';

import type { CreatePluginRuntimeOptions, PluginRuntimeContext } from './contracts';
import { isPluginFailure, pluginError } from './errors';

/** Describes the response emitter used by the dispatcher. */
export interface DispatcherResponseWriter {
  /** Emits a JSON-RPC success response. */
  sendResult<TResult>(id: JsonRpcId, result: TResult): void;
  /** Emits a JSON-RPC error response. */
  sendError(id: JsonRpcId, code: number, message: string, data?: unknown): void;
}

/** Describes the request handler built by `createRuntimeDispatcher`. */
export type RuntimeRequestDispatcher = (
  id: JsonRpcId,
  method: string,
  params: RequestParams,
) => Promise<void>;

/** Creates the plugin default handlers used when a delegate is omitted. */
export function createDefaultPluginDelegates<
  TContext,
>(): Required<Omit<PluginDelegates<TContext>, 'plugin.initialize'>> {
  return {
    async 'plugin.init'(): Promise<null> {
      return null;
    },
    async 'plugin.deinit'(): Promise<null> {
      return null;
    },
    async 'plugin.get_menus'(): Promise<[]> {
      return [];
    },
    async 'plugin.handle_action'(): Promise<null> {
      return null;
    },
    async 'plugin.settings.defaults'(): Promise<[]> {
      return [];
    },
    async 'plugin.settings.on_load'(params: { values?: unknown[] }): Promise<unknown[]> {
      return Array.isArray(params.values) ? params.values : [];
    },
    async 'plugin.settings.on_apply'(): Promise<null> {
      return null;
    },
    async 'plugin.settings.on_save'(params: { values?: unknown[] }): Promise<unknown[]> {
      return Array.isArray(params.values) ? params.values : [];
    },
    async 'plugin.settings.on_reset'(): Promise<null> {
      return null;
    },
  };
}

/** Creates the JSON-RPC dispatcher used by the SDK plugin runtime. */
export function createRuntimeDispatcher(
  options: CreatePluginRuntimeOptions,
  host: PluginHost,
  writer: DispatcherResponseWriter,
): RuntimeRequestDispatcher {
  const defaultPluginDelegates = createDefaultPluginDelegates<PluginRuntimeContext>();
  const pluginDelegates = options.plugin ?? {};
  const vcsDelegates = options.vcs ?? {};
  const runtimeImplements = buildRuntimeImplements(options.implements, options.vcs);
  const timeout = options.timeout;
  const typedPluginDelegates = pluginDelegates as Record<
    string,
    RpcMethodHandler<RequestParams, unknown, PluginRuntimeContext> | undefined
  >;
  const typedDefaultPluginDelegates = defaultPluginDelegates as Record<
    string,
    RpcMethodHandler<RequestParams, unknown, PluginRuntimeContext> | undefined
  >;
  const typedVcsDelegates = vcsDelegates as Record<
    string,
    RpcMethodHandler<RequestParams, unknown, PluginRuntimeContext> | undefined
  >;

  return async (id: JsonRpcId, method: string, params: RequestParams): Promise<void> => {
    try {
      if (method === 'plugin.initialize') {
        const expectedVersion = params.expected_protocol_version;
        if (typeof expectedVersion === 'number' && expectedVersion !== PROTOCOL_VERSION) {
          writer.sendError(id, PROTOCOL_VERSION_MISMATCH_CODE, 'protocol version mismatch', {
            code: 'protocol-version-mismatch',
            message: `host expects protocol ${expectedVersion}, plugin supports ${PROTOCOL_VERSION}`,
          });
          return;
        }

        const override = pluginDelegates['plugin.initialize']
          ? await pluginDelegates['plugin.initialize'](params, {
              host,
              requestId: id,
              method,
            })
          : {};
        writer.sendResult(id, {
          protocol_version: override.protocol_version ?? PROTOCOL_VERSION,
          implements: {
            ...runtimeImplements,
            ...override.implements,
          },
        });
        return;
      }

      const handler =
        typedPluginDelegates[method] ??
        typedDefaultPluginDelegates[method] ??
        typedVcsDelegates[method];

      if (!handler) {
        throw pluginError('rpc-method-not-found', `method '${method}' is not implemented`);
      }

      let result: unknown;
      if (timeout && timeout > 0) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);
        try {
          result = await handler(params, {
            host,
            requestId: id,
            method,
          });
        } catch (error) {
          clearTimeout(timeoutId);
          if ((error as Error).name === 'AbortError') {
            throw pluginError('request-timeout', `method '${method}' timed out after ${timeout}ms`);
          }
          throw error;
        }
        clearTimeout(timeoutId);
      } else {
        result = await handler(params, {
          host,
          requestId: id,
          method,
        });
      }
      writer.sendResult(id, result == null ? null : result);
    } catch (error) {
      if (isPluginFailure(error)) {
        writer.sendError(id, error.code, error.message, error.data);
        return;
      }

      const messageText = error instanceof Error ? error.message : String(error || 'unknown error');
      host.error(messageText);
      writer.sendError(id, PLUGIN_INTERNAL_ERROR_CODE, messageText, {
        code: 'plugin-internal-error',
        message: messageText,
      });
    }
  };
}

/** Builds the handshake capability flags returned from `plugin.initialize`. */
function buildRuntimeImplements(
  overrides: Partial<PluginImplements> | undefined,
  vcsDelegates: VcsDelegates<PluginRuntimeContext> | undefined,
): PluginImplements {
  return {
    plugin: overrides?.plugin ?? true,
    vcs: overrides?.vcs ?? Boolean(vcsDelegates && Object.keys(vcsDelegates).length > 0),
  };
}
