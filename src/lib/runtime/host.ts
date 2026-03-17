// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

import type {
  HostEventEmitParams,
  HostLogLevel,
  HostStatusSetParams,
  HostUiNotifyParams,
  JsonRpcId,
  PluginHost,
} from '../types';

/** Describes the low-level notification sender used by `createHost`. */
export type HostNotificationSender = (method: string, params: unknown) => void;

/** Describes the options accepted by `createHost`. */
export interface CreateHostOptions {
  /** Stores the `host.log` target name to emit for diagnostic messages. */
  logTarget?: string;
}

/** Creates the host notification helper used inside runtime delegates. */
export function createHost(
  sendNotification: HostNotificationSender,
  options: CreateHostOptions = {},
): PluginHost {
  const logTarget = options.logTarget ?? 'openvcs.plugin';

  return {
    log(level: HostLogLevel, message: string): void {
      sendNotification('host.log', {
        level,
        target: logTarget,
        message,
      });
    },
    info(message: string): void {
      sendNotification('host.log', {
        level: 'info',
        target: logTarget,
        message,
      });
    },
    error(message: string): void {
      sendNotification('host.log', {
        level: 'error',
        target: logTarget,
        message,
      });
    },
    uiNotify(params: HostUiNotifyParams): void {
      sendNotification('host.ui_notify', params);
    },
    statusSet(params: HostStatusSetParams): void {
      sendNotification('host.status_set', params);
    },
    emitEvent(params: HostEventEmitParams): void {
      sendNotification('host.event_emit', params);
    },
    emitVcsEvent(
      sessionId: string,
      requestId: JsonRpcId | null,
      event: Record<string, unknown>,
    ): void {
      sendNotification('vcs.event', {
        session_id: sessionId,
        request_id: requestId,
        event,
      });
    },
  };
}
