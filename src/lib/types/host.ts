// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

import type { JsonRpcId } from './protocol';

/** Enumerates the log levels accepted by the host log notification. */
export type HostLogLevel = 'error' | 'info';

/** Describes one `host.log` notification payload. */
export interface HostLogParams {
  /** Stores the emitted log severity. */
  level: HostLogLevel;
  /** Stores the plugin log target name. */
  target: string;
  /** Stores the log message text. */
  message: string;
}

/** Describes one `host.ui_notify` notification payload. */
export interface HostUiNotifyParams {
  /** Stores the message shown by the host UI. */
  message: string;
  /** Stores an optional severity or category understood by the host. */
  level?: string;
}

/** Describes one `host.status_set` notification payload. */
export interface HostStatusSetParams {
  /** Stores the status text shown by the host. */
  text: string;
}

/** Describes one `host.event_emit` notification payload. */
export interface HostEventEmitParams {
  /** Stores the plugin-defined event name. */
  name: string;
  /** Stores the event payload forwarded to the host. */
  payload?: Record<string, unknown>;
}

/** Describes one `vcs.event` notification payload. */
export interface VcsEventParams {
  /** Stores the repository session id associated with the event. */
  session_id: string;
  /** Stores the originating request id when one exists. */
  request_id: JsonRpcId | null;
  /** Stores the event payload. */
  event: Record<string, unknown>;
}

/** Describes the host helper API available inside delegate handlers. */
export interface PluginHost {
  /** Emits a `host.log` notification. */
  log(level: HostLogLevel, message: string): void;
  /** Emits an informational `host.log` notification. */
  info(message: string): void;
  /** Emits an error `host.log` notification. */
  error(message: string): void;
  /** Emits a `host.ui_notify` notification. */
  uiNotify(params: HostUiNotifyParams): void;
  /** Emits a `host.status_set` notification. */
  statusSet(params: HostStatusSetParams): void;
  /** Emits a `host.event_emit` notification. */
  emitEvent(params: HostEventEmitParams): void;
  /** Emits a `vcs.event` notification. */
  emitVcsEvent(
    sessionId: string,
    requestId: JsonRpcId | null,
    event: Record<string, unknown>,
  ): void;
}
