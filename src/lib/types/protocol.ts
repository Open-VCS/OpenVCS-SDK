// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

/** Stores the protocol version mirrored from the backend host contract. */
export const PROTOCOL_VERSION = 1;

/** Stores the reserved JSON-RPC error code used for plugin failures. */
export const PLUGIN_FAILURE_CODE = -32001;

/** Stores the reserved JSON-RPC error code used for uncaught plugin errors. */
export const PLUGIN_INTERNAL_ERROR_CODE = -32002;

/** Stores the reserved JSON-RPC error code used for protocol version mismatches. */
export const PROTOCOL_VERSION_MISMATCH_CODE = -32003;

/** Represents a JSON-RPC request identifier. */
export type JsonRpcId = number | string;

/** Represents an untyped JSON-RPC parameter object. */
export type RequestParams = Record<string, unknown>;

/** Describes one JSON-RPC error payload. */
export interface JsonRpcError {
  /** Stores the machine-readable error code. */
  code: number;
  /** Stores the human-readable error message. */
  message: string;
  /** Stores optional structured error details. */
  data?: unknown;
}

/** Describes one JSON-RPC request received from the host. */
export interface JsonRpcRequest {
  /** Stores the JSON-RPC protocol marker when present. */
  jsonrpc?: string;
  /** Stores the request identifier used to match responses. */
  id?: JsonRpcId;
  /** Stores the requested method name. */
  method?: unknown;
  /** Stores the untyped parameter payload. */
  params?: unknown;
}

/** Describes one JSON-RPC notification emitted without an id. */
export interface JsonRpcNotification {
  /** Stores the JSON-RPC protocol marker. */
  jsonrpc: '2.0';
  /** Stores the notification method name. */
  method: string;
  /** Stores the notification payload. */
  params?: unknown;
}

/** Describes one JSON-RPC success response. */
export interface JsonRpcSuccessResponse<TResult = unknown> {
  /** Stores the JSON-RPC protocol marker. */
  jsonrpc: '2.0';
  /** Stores the request identifier being answered. */
  id: JsonRpcId;
  /** Stores the successful result payload. */
  result: TResult;
}

/** Describes one JSON-RPC error response. */
export interface JsonRpcErrorResponse {
  /** Stores the JSON-RPC protocol marker. */
  jsonrpc: '2.0';
  /** Stores the request identifier being answered. */
  id: JsonRpcId;
  /** Stores the structured error payload. */
  error: JsonRpcError;
}

/** Describes one plugin-specific failure payload surfaced to the host. */
export interface PluginFailure {
  /** Stores the reserved JSON-RPC error code for plugin failures. */
  code: typeof PLUGIN_FAILURE_CODE;
  /** Stores the top-level failure message. */
  message: string;
  /** Stores nested plugin-specific failure details. */
  data: PluginFailureData;
}

/** Describes the structured data embedded in a plugin failure. */
export interface PluginFailureData {
  /** Stores the stable plugin-specific error code. */
  code: string;
  /** Stores the user-facing failure message. */
  message: string;
}

/** Describes one method handler used by the SDK delegate runtime. */
export type RpcMethodHandler<
  TParams extends RequestParams = RequestParams,
  TResult = unknown,
  TContext = unknown,
> = (params: TParams, context: TContext) => TResult | Promise<TResult>;
