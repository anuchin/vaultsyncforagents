import { afterEach, describe, expect, it, vi } from 'vitest';
import { HttpBlobStore } from '../src/blobstore.js';
import { WebSocketTransport, toWebSocketUrl } from '../src/transport.js';
import { FakeFetch, FakeSocket, jsonResult } from './helpers/network-fakes.js';
import { NetworkError } from '@vsa/core';

describe('toWebSocketUrl', () => {
  it('converts https origins to authenticated wss worker URLs', () => {
    expect(toWebSocketUrl('https://personal.x.workers.dev', 'tok-1')).toBe(
      'wss://personal.x.workers.dev/ws?token=tok-1',
    );
  });

  it('upgrades http to ws and honors an explicit /sync path', () => {
    expect(toWebSocketUrl('http://localhost:8787/', 't', '/sync')).toBe(
      'ws://localhost:8787/sync?token=t',
    );
  });

  it('passes ws(s) schemes through, dropping any query the input carried', () => {
    expect(toWebSocketUrl('wss://example.com/whatever?x=1', 't')).toBe(
      'wss://example.com/ws?token=t',
    );
  });

  it('rejects non-web schemes', () => {
    expect(() => toWebSocketUrl('ftp://example.com', 't')).toThrow(NetworkError);
    expect(() => toWebSocketUrl('not a url', 't')).toThrow();
  });
});

describe('WebSocketTransport', () => {
  function dial(url = 'https://w.example', token = 'tok') {
    let socket: FakeSocket | null = null;
    const transport = new WebSocketTransport({
      url,
      token,
      wsFactory: (dialUrl) => {
        socket = new FakeSocket(dialUrl);
        return socket;
      },
    });
    if (socket === null) throw new Error('factory not called');
    return { transport, socket: socket as FakeSocket };
  }

  it('dials the authenticated worker URL', () => {
    const { socket } = dial('https://w.example', 'tok-9');
    expect(socket.url).toBe('wss://w.example/ws?token=tok-9');
  });

  it('queues sends before open and flushes them on open', () => {
    const { transport, socket } = dial();
    transport.send({ type: 'hello', token: 't', protocolVersion: 1, cursor: 0 });
    expect(socket.sent).toEqual([]);
    socket.open();
    expect(socket.sent).toHaveLength(1);
    expect(JSON.parse(socket.sent[0]!)).toMatchObject({ type: 'hello', cursor: 0 });
  });

  it('delivers parsed messages to onMessage', () => {
    const { transport, socket } = dial();
    const received: unknown[] = [];
    transport.onMessage((message) => received.push(message));
    socket.open();
    socket.receive({ type: 'pong', ts: 5 });
    expect(received).toEqual([{ type: 'pong', ts: 5 }]);
  });

  it('closes the transport on malformed JSON frames', () => {
    const { transport, socket } = dial();
    const closes: unknown[] = [];
    transport.onClose((reason) => closes.push(reason));
    socket.open();
    socket.receiveRaw('{not json');
    expect(socket.closed).toBe(true);
    expect(closes).toHaveLength(1);
  });

  it('notifies onClose with the error detail when the dial fails', () => {
    const { transport, socket } = dial();
    const closes: unknown[] = [];
    transport.onClose((reason) => closes.push(reason));
    socket.fail('connection refused');
    expect(closes).toEqual([{ code: 1006, reason: 'connection refused' }]);
    expect(() => transport.send({ type: 'ping' })).toThrow(NetworkError);
  });

  it('close() is idempotent and notifies exactly once', () => {
    const { transport, socket } = dial();
    const closes: unknown[] = [];
    transport.onClose((reason) => closes.push(reason));
    transport.close();
    transport.close();
    socket.close(1006, 'peer gone'); // late network event
    expect(closes).toEqual([{ code: 1000, reason: 'closed by caller' }]);
  });
});

describe('HttpBlobStore', () => {
  const fetcher = new FakeFetch();

  it('GETs blobs with the Bearer token; 404 → undefined', async () => {
    const store = new HttpBlobStore({
      baseUrl: 'https://w.example/',
      token: 'tok-1',
      fetchImpl: fetcher.fetchImpl,
    });
    fetcher.on('GET', '/blob/abc', () => new Response(new Uint8Array([1, 2, 3])));
    fetcher.on('GET', '/blob/missing', () => new Response('gone', { status: 404 }));

    const bytes = await store.get('abc');
    expect(Array.from(bytes!)).toEqual([1, 2, 3]);
    expect(await store.get('missing')).toBeUndefined();
    const auth = new Headers(fetcher.calls[0]!.init?.headers).get('authorization');
    expect(auth).toBe('Bearer tok-1');
  });

  it('PUTs blobs idempotently with the right headers', async () => {
    const store = new HttpBlobStore({
      baseUrl: 'https://w.example',
      token: 'tok-1',
      fetchImpl: fetcher.fetchImpl,
    });
    fetcher.on('PUT', '/blob/def', () => jsonResult(200, { ok: true }));
    await store.put('def', new Uint8Array([9, 9]));

    const call = fetcher.calls[fetcher.calls.length - 1]!;
    expect(call.url).toBe('https://w.example/blob/def');
    expect(call.init?.method).toBe('PUT');
    const headers = new Headers(call.init?.headers);
    expect(headers.get('authorization')).toBe('Bearer tok-1');
    expect(headers.get('content-type')).toBe('application/octet-stream');
  });

  it('throws HttpBlobError on unexpected statuses', async () => {
    const store = new HttpBlobStore({
      baseUrl: 'https://w.example',
      token: 'tok-1',
      fetchImpl: fetcher.fetchImpl,
    });
    fetcher.on('PUT', '/blob/err', () => new Response('nope', { status: 500 }));
    await expect(store.put('err', new Uint8Array(0))).rejects.toThrow(/HTTP 500/);
  });

  // The blob store calls `doFetch` detached; an unbound global `fetch` is an
  // illegal invocation in Chromium renderers (real Obsidian). Same mock
  // strategy as the plugin-side fetch seam test.
  it('defaults to a fetch bound to the global (illegal-invocation regression)', async () => {
    const strictGlobalFetch = function (this: unknown, input: RequestInfo | URL): Promise<Response> {
      if (this !== globalThis) {
        return Promise.reject(
          new TypeError("Failed to execute 'fetch' on 'Window': Illegal invocation"),
        );
      }
      return Promise.resolve(new Response(new Uint8Array([7, 7, 7]).slice()));
    };
    vi.stubGlobal('fetch', strictGlobalFetch);
    try {
      const store = new HttpBlobStore({ baseUrl: 'https://w.example', token: 'tok-1' });
      const bytes = await store.get('anything');
      expect(Array.from(bytes!)).toEqual([7, 7, 7]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });
});
