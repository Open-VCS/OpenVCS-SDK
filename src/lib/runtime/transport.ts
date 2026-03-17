// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

import type { JsonRpcRequest } from '../types';

/** Describes the parsed result of draining one buffered transport chunk. */
export interface FramedMessageParseResult {
  /** Stores the decoded requests found in the current buffer. */
  messages: JsonRpcRequest[];
  /** Stores any remaining incomplete bytes. */
  remainder: Buffer;
}

/** Serializes one JSON-RPC payload into an LSP-style framed stdio message. */
export function serializeFramedMessage(value: unknown): Buffer {
  const payload = Buffer.from(JSON.stringify(value), 'utf8');
  const header = Buffer.from(`Content-Length: ${payload.length}\r\n\r\n`, 'utf8');
  return Buffer.concat([header, payload]);
}

/** Writes one JSON-RPC payload to the supplied stdout-like stream. */
export function writeFramedMessage(
  writer: NodeJS.WritableStream,
  value: unknown,
): void {
  try {
    const serialized = serializeFramedMessage(value);
    writer.write(serialized);
  } catch (error) {
    console.error(
      `[transport] failed to write framed message: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/** Parses all complete framed JSON-RPC requests currently present in a buffer. */
export function parseFramedMessages(buffer: Buffer): FramedMessageParseResult {
  const messages: JsonRpcRequest[] = [];
  let remainder = buffer;

  while (true) {
    const marker = remainder.indexOf('\r\n\r\n');
    if (marker < 0) {
      return { messages, remainder };
    }

    const header = remainder.subarray(0, marker).toString('utf8');
    const contentLength = readContentLength(header);
    if (contentLength == null) {
      remainder = remainder.subarray(marker + 4);
      continue;
    }

    const totalLength = marker + 4 + contentLength;
    if (remainder.length < totalLength) {
      return { messages, remainder };
    }

    const payload = remainder.subarray(marker + 4, totalLength).toString('utf8');
    remainder = remainder.subarray(totalLength);

    try {
      messages.push(JSON.parse(payload) as JsonRpcRequest);
    } catch {
      continue;
    }
  }
}

/** Reads one `Content-Length` header value from a framed message header block. */
function readContentLength(header: string): number | null {
  const headerLines = header.split(/\r?\n/g);

  for (const line of headerLines) {
    const separatorIndex = line.indexOf(':');
    if (separatorIndex < 0) {
      continue;
    }

    const name = line.slice(0, separatorIndex).trim().toLowerCase();
    if (name !== 'content-length') {
      continue;
    }

    const rawValue = Number(line.slice(separatorIndex + 1).trim());
    return Number.isFinite(rawValue) && rawValue >= 0 ? rawValue : null;
  }

  return null;
}
