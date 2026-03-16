// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

import type { PluginHost, PluginImplements, PluginDelegates, JsonRpcId, JsonRpcRequest, VcsDelegates } from '../types';

/** Describes the transport endpoints used by the plugin runtime loop. */
export interface PluginRuntimeTransport {
  /** Stores the readable stdin-like stream receiving framed messages. */
  stdin: NodeJS.ReadStream;
  /** Stores the writable stdout-like stream sending framed messages. */
  stdout: NodeJS.WritableStream;
}

/** Describes the context object passed to every SDK delegate handler. */
export interface PluginRuntimeContext {
  /** Stores the active host notification helper. */
  host: PluginHost;
  /** Stores the request id currently being processed. */
  requestId: JsonRpcId;
  /** Stores the current host method name. */
  method: string;
}

/** Describes the options accepted by `createPluginRuntime`. */
export interface CreatePluginRuntimeOptions {
  /** Stores optional plugin lifecycle and settings delegates. */
  plugin?: PluginDelegates<PluginRuntimeContext>;
  /** Stores optional VCS method delegates. */
  vcs?: VcsDelegates<PluginRuntimeContext>;
  /** Stores optional capability overrides for `plugin.initialize`. */
  implements?: Partial<PluginImplements>;
  /** Stores the `host.log` target emitted by the runtime. */
  logTarget?: string;
}

/** Describes one created SDK plugin runtime instance. */
export interface PluginRuntime {
  /** Starts listening on stdio for framed JSON-RPC requests. */
  start(transport?: PluginRuntimeTransport): void;
  /** Consumes one raw stdio chunk and dispatches complete requests. */
  consumeChunk(chunk: Buffer | string): void;
  /** Dispatches one already-decoded JSON-RPC request. */
  dispatchRequest(request: JsonRpcRequest): Promise<void>;
}
