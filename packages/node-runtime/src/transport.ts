/**
 * `WebSocketTransport` — core's `Transport` over the runtime's global
 * `WebSocket` (Node 24 ships it; no `ws` dependency). Node-only code stays
 * in this package by design (ARCHITECTURE.md §8 adapters).
 *
 * Wire format: one JSON text frame per message, parsed with core's
 * `parseMessage` (unknown types/malformed JSON are protocol violations and
 * close the transport, exactly like the in-memory server does).
 *
 * Sends before the socket opens are queued and flushed on open — `SyncClient`
 * constructs a transport and immediately `send`s its `hello`.
 */

import { NetworkError, parseMessage, type Message } from '@vsa/core';
import type { CloseReason, Transport } from '@vsa/core';

/**
 * The minimal WebSocket surface this transport needs. Injectable so tests
 * (and exotic runtimes) can supply a fake; production uses the global.
 */
export interface WebSocketLike {
  send(data: string): void;
  close(code?: number, reason?: string): void;
  addEventListener(type: 'open', listener: () => void): void;
  addEventListener(type: 'message', listener: (event: { data: unknown }) => void): void;
  addEventListener(
    type: 'close',
    listener: (event: { code?: number; reason?: string }) => void,
  ): void;
  addEventListener(type: 'error', listener: (event: unknown) => void): void;
}

export type WebSocketFactory = (url: string) => WebSocketLike;

export interface WebSocketTransportOptions {
  /** Worker origin (`https://personal.x.workers.dev`) or a `ws(s)://` URL. */
  url: string;
  /** WS path on the worker (default `/ws`; `/sync` is equivalent). */
  path?: string;
  /** Injectable socket factory (tests). Default: the global `WebSocket`. */
  wsFactory?: WebSocketFactory;
}

/** Localhost names for which cleartext `ws://` is tolerated (local dev only). */
function isLocalHost(url: URL): boolean {
  const host = url.hostname.toLowerCase();
  return host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1';
}

/**
 * Build the WS URL: `https://x` → `wss://x/ws`. The device token is
 * deliberately NOT carried in the URL — URLs land in request logs; the token
 * rides the `hello` frame only. Cleartext `ws://` is refused except for
 * localhost (local dev); throws on foreign schemes or unparsable input.
 */
export function toWebSocketUrl(baseUrl: string, path = '/ws'): string {
  const url = new URL(baseUrl);
  if (url.protocol === 'http:') url.protocol = 'ws:';
  else if (url.protocol === 'https:') url.protocol = 'wss:';
  else if (url.protocol !== 'ws:' && url.protocol !== 'wss:') {
    throw new NetworkError(`worker URL must be http(s):// or ws(s)://, got ${url.protocol}`);
  }
  if (url.protocol === 'ws:' && !isLocalHost(url)) {
    throw new NetworkError(
      'worker URL must use https:// — cleartext http/ws is only allowed for localhost',
    );
  }
  url.pathname = path;
  url.search = '';
  return url.toString();
}

function defaultWebSocketFactory(url: string): WebSocketLike {
  const websocket = (globalThis as { WebSocket?: unknown }).WebSocket;
  if (typeof websocket !== 'function') {
    throw new NetworkError(
      'WebSocket is not available in this Node.js build (needs Node 22+, or a runtime ' +
        'with a global WebSocket). Pass a custom wsFactory or upgrade Node.',
    );
  }
  return new (websocket as new (url: string) => WebSocketLike)(url);
}

export class WebSocketTransport implements Transport {
  private readonly socket: WebSocketLike;
  private messageCallback: ((message: Message) => void) | null = null;
  private closeCallback: ((reason: CloseReason) => void) | null = null;
  private open = false;
  private closed = false;
  private closeNotified = false;
  private readonly sendQueue: string[] = [];

  constructor(options: WebSocketTransportOptions) {
    const factory = options.wsFactory ?? defaultWebSocketFactory;
    const url = toWebSocketUrl(options.url, options.path ?? '/ws');
    this.socket = factory(url);

    this.socket.addEventListener('open', () => {
      this.open = true;
      const queued = [...this.sendQueue];
      this.sendQueue.length = 0;
      for (const frame of queued) this.socket.send(frame);
    });

    this.socket.addEventListener('message', (event) => {
      if (typeof event.data !== 'string') {
        this.fail({ code: 1003, reason: 'binary frames are not part of the protocol' });
        return;
      }
      let message: Message;
      try {
        message = parseMessage(event.data);
      } catch (error) {
        this.fail({
          code: 1002,
          reason: error instanceof Error ? error.message : String(error),
        });
        return;
      }
      if (this.messageCallback !== null) this.messageCallback(message);
    });

    this.socket.addEventListener('error', (event) => {
      this.lastError =
        event instanceof Error ? event.message : event !== undefined ? String(event) : 'socket error';
    });

    this.socket.addEventListener('close', (event) => {
      this.finishClose({
        code: event.code,
        reason: event.reason !== undefined && event.reason !== ''
          ? event.reason
          : this.lastError,
      });
    });
  }

  /** Last 'error' event text, used to enrich the close reason. */
  private lastError: string | undefined;

  send(message: Message): void {
    if (this.closed) throw new NetworkError('send on a closed transport');
    const frame = JSON.stringify(message);
    if (this.open) {
      this.socket.send(frame);
      return;
    }
    this.sendQueue.push(frame);
  }

  onMessage(callback: (message: Message) => void): void {
    this.messageCallback = callback;
  }

  onClose(callback: (reason: CloseReason) => void): void {
    this.closeCallback = callback;
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.sendQueue.length = 0;
    try {
      this.socket.close(1000, 'closed by caller');
    } catch {
      // already dead — the close event may never arrive
    }
    // Notify even if the socket never emits 'close' (failed dial).
    this.finishClose({ code: 1000, reason: 'closed by caller' });
  }

  private fail(reason: CloseReason): void {
    this.closed = true;
    try {
      this.socket.close(reason.code ?? 1002, reason.reason ?? '');
    } catch {
      // already closed
    }
    this.finishClose(reason);
  }

  private finishClose(reason: CloseReason): void {
    this.open = false;
    this.closed = true;
    if (this.closeNotified) return;
    this.closeNotified = true;
    this.closeCallback?.(reason);
  }
}
