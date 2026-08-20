/**
 * Test doubles for the network seams: a scriptable `WebSocketLike` factory
 * for `WebSocketTransport`, a routing fake `fetch` for /health + /pair +
 * /blob, and a bridge that welds a fake WebSocket to core's
 * `InMemorySyncServer` for full plugin↔engine integration tests.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import type { WebSocketLike } from '../../src/transport.js';

type Listener = { type: string; fn: (event: unknown) => void };

/** One scripted socket: the test drives open/message/close/error. */
export class FakeSocket implements WebSocketLike {
  static opened: FakeSocket[] = [];
  readonly sent: string[] = [];
  readonly listeners: Listener[] = [];
  closed = false;
  closeCode: number | undefined;
  closeReason: string | undefined;

  constructor(public readonly url: string) {
    FakeSocket.opened.push(this);
  }

  // -- WebSocketLike surface ----------------------------------------------------

  send(data: string): void {
    if (this.closed) throw new Error('send on closed FakeSocket');
    this.sent.push(data);
  }

  close(code = 1000, reason = ''): void {
    if (this.closed) return;
    this.closed = true;
    this.closeCode = code;
    this.closeReason = reason;
    this.emit('close', { code, reason });
  }

  addEventListener(
    type: 'open',
    listener: () => void,
  ): void;
  addEventListener(
    type: 'message',
    listener: (event: { data: unknown }) => void,
  ): void;
  addEventListener(
    type: 'close',
    listener: (event: { code?: number; reason?: string }) => void,
  ): void;
  addEventListener(type: 'error', listener: (event: unknown) => void): void;
  addEventListener(type: string, listener: (event: any) => void): void {
    this.listeners.push({ type, fn: listener });
  }

  // -- test controls --------------------------------------------------------------

  emit(type: string, event: unknown): void {
    for (const listener of [...this.listeners]) {
      if (listener.type === type) listener.fn(event);
    }
  }

  open(): void {
    this.emit('open', {});
  }

  receive(message: unknown): void {
    this.emit('message', { data: JSON.stringify(message) });
  }

  receiveRaw(data: string): void {
    this.emit('message', { data });
  }

  fail(message: string): void {
    this.emit('error', new Error(message));
    this.close(1006, message);
  }

  get sentMessages(): unknown[] {
    return this.sent.map((frame) => JSON.parse(frame));
  }
}

/** A wsFactory whose sockets never connect (the offline path). */
export function offlineWsFactory(url: string): FakeSocket {
  const socket = new FakeSocket(url);
  // Fails on the next microtask, so `await`-based tests settle deterministically
  // without needing real timers (fake timers leave microtasks alone).
  void Promise.resolve().then(() => socket.fail('offline'));
  return socket;
}

/** A wsFactory whose sockets open immediately and then sit idle. */
export function connectedSilentWsFactory(url: string): FakeSocket {
  const socket = new FakeSocket(url);
  void Promise.resolve().then(() => socket.open());
  return socket;
}

// --- fake fetch ---------------------------------------------------------------------

export interface FetchCall {
  url: string;
  init: RequestInit | undefined;
}

interface Route {
  method: string;
  /** Exact path match, or… */
  path?: string;
  /** …prefix match (with the remainder passed to the handler). */
  prefix?: string;
  respond: (call: FetchCall, suffix: string) => Response;
}

/**
 * `FakeFetch` routes exact `(method, path)` pairs (and `/blob/…` prefixes);
 * unmatched requests get a network failure (rejected promise), like an
 * unreachable host.
 */
export class FakeFetch {
  readonly calls: FetchCall[] = [];
  private readonly routes: Route[] = [];

  get fetchImpl(): typeof fetch {
    return (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      this.calls.push({ url, init });
      const method = init?.method ?? 'GET';
      const path = url.replace(/^https?:\/\/[^/]+/, '');
      for (const route of this.routes) {
        if (route.method !== method) continue;
        if (route.path !== undefined && route.path === path) {
          return route.respond({ url, init }, '');
        }
        if (route.prefix !== undefined && path.startsWith(route.prefix)) {
          return route.respond({ url, init }, path.slice(route.prefix.length));
        }
      }
      throw new TypeError(`Failed to fetch (unrouted): ${method} ${url}`);
    }) as unknown as typeof fetch;
  }

  on(method: string, path: string, respond: (call: FetchCall) => Response): this {
    this.routes.push({ method, path, respond: (call) => respond(call) });
    return this;
  }

  /** Route every request whose path starts with `prefix`. */
  onPrefix(
    method: string,
    prefix: string,
    respond: (suffix: string, call: FetchCall) => Response,
  ): this {
    this.routes.push({ method, prefix, respond: (call, suffix) => respond(suffix, call) });
    return this;
  }

  json(method: string, path: string, status: number, body: unknown): this {
    return this.on(method, path, () => jsonResult(status, body));
  }

  /** `GET /health` with the given claim state. */
  health(claimed: boolean): this {
    return this.json('GET', '/health', 200, { ok: true, claimed });
  }

  /** `POST /pair` with the given status + body. */
  pair(status: number, body: unknown): this {
    return this.json('POST', '/pair', status, body);
  }
}

export function jsonResult(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
