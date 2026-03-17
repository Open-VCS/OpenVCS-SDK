// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

import type { JsonRpcId, JsonRpcRequest, RequestParams } from '../types';

import type {
  CreatePluginRuntimeOptions,
  PluginRuntime,
  PluginRuntimeTransport,
} from './contracts';
import { createRuntimeDispatcher } from './dispatcher';
import { createHost } from './host';
import { parseFramedMessages, writeFramedMessage } from './transport';

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
      options.onStart?.();
    },
    stop(): void {
      if (!started) {
        return;
      }
      started = false;
      processing = processing
        .catch(async (error: unknown) => {
          const errorMessage = error instanceof Error ? error.message : String(error);
          console.error(`[runtime] shutdown error: ${errorMessage}`);
          const err = error instanceof Error ? error : new Error(errorMessage);
          await options.onShutdown?.(err);
        })
        .then(async () => {
          await options.onShutdown?.();
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
      const validationErrors: string[] = [];
      if (!method) validationErrors.push('missing method');
      if (typeof id !== 'number' && typeof id !== 'string') validationErrors.push(`invalid id type: ${typeof id}`);
      if (validationErrors.length > 0) {
        host.error(`invalid request: ${validationErrors.join(', ')}`);
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

      const methodName = method as string;
      const params = asRecord(request.params) ?? {};
      const requestId = id as JsonRpcId;
      await dispatcher(requestId, methodName, params);
    },
  };

  return runtime;
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
