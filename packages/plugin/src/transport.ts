/**
 * `WebSocketTransport` — core's `Transport` over the global `WebSocket`
 * (present in Obsidian desktop *and* mobile; feature-checked with a clear
 * error for exotic builds).
 *
 * This mirrors `@vsa/node-runtime`'s transport on purpose (same wire format:
 * one JSON text frame per message, core's `parseMessage` on receive, queued
 * sends before open) but shares no code with it — `@vsa/node-runtime` is
 * Node-only and must never be a plugin dependency.
 */

import { NetworkError, parseMessage } from '@vsa/core';
import type { CloseReason, Message, Transport } from '@vsa/core';

/**
 * The minimal WebSocket surface this transport needs. Injectable so tests
 * (and exotic runtimes) can supply a fake; production uses the global.
 */
export interface WebSocketLike {
  send(data: string): void;
  close(code?: number, reason?: string): void;
  addEventListener(type: 'open', listener: () => void): void;
  addEventListener(type: 'message', listener: (event: { data: unknown }) => void): void;
  addEventListener(type: 'close', listener: (event: { code?: number; reason?: string }) => void): void;
  addEventListener(type: 'error', listener: (event: unknown) => void): void;
}

export type WebSocketFactory = (url: string) => WebSocketLike;

export interface WebSocketTransportOptions {
  /** Worker origin (`https://personal.x.workers.dev`) or a `ws(s)://` URL. */
  url: string;
  /** Device token — carried in the query string (the worker's pre-auth path). */
  token: string;
  /** WS path on the worker (default `/ws`; `/sync` is equivalent). */
  path?: string;
  /** Injectable socket factory (tests). Default: the global `WebSocket`. */
  wsFactory?: WebSocketFactory;
}

/**
 * Build the authenticated WS URL: `https://x` → `wss://x/ws?token=…`.
 * Throws on non-HTTP(S)/WS schemes or unparsable input.
 */
export function toWebSocketUrl(baseUrl: string, token: string, path = '/ws'): string {
  const url = new URL(baseUrl);
  if (url.protocol === 'http:') url.protocol = 'ws:';
  else if (url.protocol === 'https:') url.protocol = 'wss:';
  else if (url.protocol !== 'ws:' && url.protocol !== 'wss:') {
    throw new NetworkError(`worker URL must be http(s):// or ws(s)://, got ${url.protocol}`);
  }
  url.pathname = path;
  url.search = '';
  url.searchParams.set('token', token);
  return url.toString();
}

function defaultWebSocketFactory(url: string): WebSocketLike {
  const websocket = (globalThis as { WebSocket?: unknown }).WebSocket;
  if (typeof websocket !== 'function') {
    throw new NetworkError(
      'WebSocket is not available in this Obsidian build (it is built in on desktop and ' +
        'mobile; a very old app version or a stripped webview is the only known cause). ' +
        'Sync requires it.',
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
  private lastError: string | undefined;

  constructor(options: WebSocketTransportOptions) {
    const factory = options.wsFactory ?? defaultWebSocketFactory;
    const url = toWebSocketUrl(options.url, options.token, options.path ?? '/ws');
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
        this.fail({ code: 1002, reason: error instanceof Error ? error.message : String(error) });
        return;
      }
      this.messageCallback?.(message);
    });

    this.socket.addEventListener('error', (event) => {
      this.lastError =
        event instanceof Error ? event.message : event !== undefined ? String(event) : 'socket error';
    });

    this.socket.addEventListener('close', (event) => {
      this.finishClose({
        code: event.code,
        reason: event.reason !== undefined && event.reason !== '' ? event.reason : this.lastError,
      });
    });
  }

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
