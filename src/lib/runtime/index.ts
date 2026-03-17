// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

import type { JsonRpcId, JsonRpcRequest, RequestParams } from '../types';

import type {
  CreatePluginRuntimeOptions,
  PluginRuntime,
  PluginRuntimeContext,
  PluginRuntimeTransport,
} from './contracts';
import { createRuntimeDispatcher } from './dispatcher';
import { createHost } from './host';
import { parseFramedMessages, writeFramedMessage } from './transport';

export type {
  CreatePluginRuntimeOptions,
  PluginRuntime,
  PluginRuntimeContext,
  PluginRuntimeTransport,
} from './contracts';
export { createDefaultPluginDelegates } from './dispatcher';
export { isPluginFailure, pluginError } from './errors';
export { createHost } from './host';

/** Creates a reusable stdio JSON-RPC runtime for OpenVCS Node plugins. */
export function createPluginRuntime(
  options: CreatePluginRuntimeOptions = {},
): PluginRuntime {
  let buffer: Buffer<ArrayBufferLike> = Buffer.alloc(0);
  let processing: Promise<void> = Promise.resolve();
  let started = false;
  let currentTransport: PluginRuntimeTransport | null = null;
  let chunkLock: Promise<void> = Promise.resolve();

  const runtime: PluginRuntime = {
    start(transport: PluginRuntimeTransport = defaultTransport()): void {
      if (started) {
        return;
      }

      started = true;
      currentTransport = transport;
      transport.stdin.on('data', (chunk: Buffer | string) => {
        runtime.consumeChunk(chunk);
      });
      transport.stdin.on('error', () => {
        process.exit(1);
      });
    },
    stop(): void {
      if (!started) {
        return;
      }
      started = false;
      processing = processing.catch((error: unknown) => {
        console.error(
          `[runtime] shutdown error: ${error instanceof Error ? error.message : String(error)}`,
        );
      });
      currentTransport = null;
    },
    consumeChunk(chunk: Buffer | string): void {
      if (!started) {
        return;
      }

      const lock = chunkLock.then(() => {
        buffer = Buffer.concat([buffer, normalizeChunk(chunk)]);
        const parsed = parseFramedMessages(buffer);
        buffer = parsed.remainder;

        for (const request of parsed.messages) {
          processing = processing
            .then(async () => {
              await runtime.dispatchRequest(request);
            })
            .catch((error: unknown) => {
              const message = error instanceof Error ? error.message : String(error || 'unknown plugin processing error');
              const host = createRuntimeHost(currentTransport, options.logTarget);
              host.error(message);
            });
        }
      });

      chunkLock = lock;
    },
    async dispatchRequest(request: JsonRpcRequest): Promise<void> {
      const id = request.id;
      const host = createRuntimeHost(currentTransport, options.logTarget);
      const method = asTrimmedString(request.method);
      if (!method || (typeof id !== 'number' && typeof id !== 'string')) {
        host.error(`invalid request: method=${JSON.stringify(method)}, id=${JSON.stringify(id)}`);
        return;
      }
      const dispatcher = createRuntimeDispatcher(options, host, {
        async sendResult<TResult>(requestId: JsonRpcId, result: TResult): Promise<void> {
          await sendMessage(currentTransport, {
            jsonrpc: '2.0',
            id: requestId,
            result,
          });
        },
        async sendError(requestId: JsonRpcId, code: number, message: string, data?: unknown): Promise<void> {
          await sendMessage(currentTransport, {
            jsonrpc: '2.0',
            id: requestId,
            error: {
              code,
              message,
              ...(data == null ? {} : { data }),
            },
          });
        },
      });

      const params = asRecord(request.params) ?? {};
      await dispatcher(id, method, params);
    },
  };

  return runtime;
}

/** Starts a previously created plugin runtime on process stdio. */
export function startPluginRuntime(
  runtime: PluginRuntime,
  transport?: PluginRuntimeTransport,
): void {
  runtime.start(transport);
}

/** Returns the default stdio transport used by the runtime. */
function defaultTransport(): PluginRuntimeTransport {
  return {
    stdin: process.stdin,
    stdout: process.stdout,
  };
}

/** Sends one JSON-RPC response or notification through the active transport. */
async function sendMessage(
  transport: PluginRuntimeTransport | null,
  value: unknown,
): Promise<void> {
  await writeFramedMessage((transport ?? defaultTransport()).stdout, value);
}

/** Builds the host helper for the currently active transport. */
function createRuntimeHost(
  transport: PluginRuntimeTransport | null,
  logTarget: string | undefined,
) {
  return createHost(
    async (method: string, params: unknown) => {
      await sendMessage(transport, {
        jsonrpc: '2.0',
        method,
        params,
      });
    },
    { logTarget },
  );
}

/** Type guard that returns true if the value is a valid RequestParams object. */
function isRequestParams(value: unknown): value is RequestParams {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  return true;
}

/** Coerces unknown request method values into trimmed strings. Returns null for non-strings. */
function asTrimmedString(value: unknown): string | null {
  return typeof value === 'string' ? value.trim() : null;
}

/** Coerces unknown params to a Record, returning null for invalid input. */
function asRecord(value: unknown): Record<string, unknown> | null {
  if (isRequestParams(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

/** Normalizes incoming data chunks to UTF-8 buffers. */
function normalizeChunk(chunk: Buffer | string): Buffer {
  return Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, 'utf8');
}
