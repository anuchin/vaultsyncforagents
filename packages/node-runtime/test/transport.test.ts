/**
 * WebSocketTransport against an injectable WebSocket factory (a scripted
 * fake): queue-before-open, JSON framing via core's helpers, close/error
 * propagation, and the missing-global feature check.
 */

import { describe, expect, it } from 'vitest';
import { NetworkError } from '@vsa/core';
import {
  toWebSocketUrl,
  WebSocketTransport,
  type WebSocketLike,
} from '../src/transport.js';

/** Scriptable fake socket. The test plays the server side. */
class FakeWebSocket implements WebSocketLike {
  readonly sent: string[] = [];
  readonly url: string;
  closeCode: number | undefined;
  closeReason: string | undefined;
  private openListeners: Array<() => void> = [];
  private messageListeners: Array<(event: { data: unknown }) => void> = [];
  private closeListeners: Array<(event: { code?: number; reason?: string }) => void> = [];
  private errorListeners: Array<(event: unknown) => void> = [];

  constructor(url: string) {
    this.url = url;
  }

  // --- test-side controls -----------------------------------------------------------
  serverOpen(): void {
    for (const listener of this.openListeners) listener();
  }

  serverMessage(message: unknown): void {
    const data = typeof message === 'string' ? message : JSON.stringify(message);
    for (const listener of this.messageListeners) listener({ data });
  }

  serverClose(code = 1000, reason = ''): void {
    for (const listener of this.closeListeners) listener({ code, reason });
  }

  serverBinary(data: ArrayBuffer): void {
    for (const listener of this.messageListeners) listener({ data });
  }

  serverError(error: unknown): void {
    for (const listener of this.errorListeners) listener(error);
  }

  // --- WebSocketLike surface ----------------------------------------------------------
  send(data: string): void {
    this.sent.push(data);
  }

  close(code?: number, reason?: string): void {
    this.closeCode = code;
    this.closeReason = reason;
  }

  addEventListener(type: 'open', listener: () => void): void;
  addEventListener(type: 'message', listener: (event: { data: unknown }) => void): void;
  addEventListener(type: 'close', listener: (event: { code?: number; reason?: string }) => void): void;
  addEventListener(type: 'error', listener: (event: unknown) => void): void;
  addEventListener(type: string, listener: never): void {
    if (type === 'open') this.openListeners.push(listener as unknown as () => void);
    else if (type === 'message')
      this.messageListeners.push(listener as unknown as (event: { data: unknown }) => void);
    else if (type === 'close')
      this.closeListeners.push(
        listener as unknown as (event: { code?: number; reason?: string }) => void,
      );
    else if (type === 'error')
      this.errorListeners.push(listener as unknown as (event: unknown) => void);
  }
}

function makeTransport(url = 'https://worker.example'): { transport: WebSocketTransport; socket: FakeWebSocket } {
  let socket: FakeWebSocket | undefined;
  const transport = new WebSocketTransport({
    url,
    wsFactory: (socketUrl) => {
      socket = new FakeWebSocket(socketUrl);
      return socket;
    },
  });
  return { transport, socket: socket! };
}

describe('toWebSocketUrl', () => {
  it('maps http→ws and https→wss onto /ws, with NO token in the URL', () => {
    expect(toWebSocketUrl('https://personal.x.workers.dev')).toBe(
      'wss://personal.x.workers.dev/ws',
    );
    expect(toWebSocketUrl('http://localhost:8787/')).toBe('ws://localhost:8787/ws');
  });

  it('keeps wss:// URLs and honors a custom path', () => {
    expect(toWebSocketUrl('wss://x.example', '/sync')).toBe('wss://x.example/sync');
  });

  it('rejects non-web schemes', () => {
    expect(() => toWebSocketUrl('ftp://x.example')).toThrow(/http\(s\)|ws\(s\)/);
  });

  it('refuses cleartext ws for anything but localhost', () => {
    expect(() => toWebSocketUrl('http://worker.example')).toThrow(/https/);
    expect(() => toWebSocketUrl('ws://worker.example')).toThrow(/https/);
    expect(toWebSocketUrl('http://127.0.0.1:8787')).toBe('ws://127.0.0.1:8787/ws');
  });
});

describe('WebSocketTransport', () => {
  it('dials the /ws URL (token-free; auth rides the hello frame)', () => {
    const { socket } = makeTransport('https://worker.example');
    expect(socket.url).toBe('wss://worker.example/ws');
  });

  it('queues sends before open and flushes in order once open', () => {
    const { transport, socket } = makeTransport();
    transport.send({ type: 'hello', token: 'tok-1', protocolVersion: 1, cursor: 0 });
    transport.send({ type: 'getManifest' });
    expect(socket.sent).toEqual([]);

    socket.serverOpen();
    expect(socket.sent).toHaveLength(2);
    expect(JSON.parse(socket.sent[0]!).type).toBe('hello');
    expect(JSON.parse(socket.sent[1]!).type).toBe('getManifest');
  });

  it('delivers parsed server messages to onMessage', () => {
    const { transport, socket } = makeTransport();
    socket.serverOpen();
    const received: unknown[] = [];
    transport.onMessage((message) => received.push(message));
    socket.serverMessage({ type: 'manifest', entries: {}, cursor: 7 });
    expect(received).toEqual([{ type: 'manifest', entries: {}, cursor: 7 }]);
  });

  it('malformed frames close the transport with the parse reason', () => {
    const { transport, socket } = makeTransport();
    socket.serverOpen();
    const closes: Array<{ code?: number; reason?: string }> = [];
    transport.onClose((reason) => closes.push(reason));

    socket.serverMessage('this is not json');
    expect(closes).toHaveLength(1);
    expect(closes[0]!.reason).toMatch(/not valid JSON/i);
    expect(() => transport.send({ type: 'ping' })).toThrow(NetworkError);
  });

  it('unknown message types are a protocol violation and close', () => {
    const { transport, socket } = makeTransport();
    socket.serverOpen();
    const closes: unknown[] = [];
    transport.onClose(() => closes.push(closes));
    socket.serverMessage({ type: 'definitely-not-a-message' });
    expect(closes).toHaveLength(1);
  });

  it('binary frames close (the protocol is JSON text only)', () => {
    const { transport, socket } = makeTransport();
    socket.serverOpen();
    const closes: Array<{ code?: number; reason?: string }> = [];
    transport.onClose((reason) => closes.push(reason));
    socket.serverBinary(new ArrayBuffer(8));
    expect(closes[0]!.code).toBe(1003);
  });

  it('server close fires onClose once with code and reason', () => {
    const { transport, socket } = makeTransport();
    socket.serverOpen();
    const closes: Array<{ code?: number; reason?: string }> = [];
    transport.onClose((reason) => closes.push(reason));
    socket.serverClose(1011, 'boom');
    socket.serverClose(1011, 'boom'); // duplicate event must not double-fire
    expect(closes).toEqual([{ code: 1011, reason: 'boom' }]);
    expect(() => transport.send({ type: 'ping' })).toThrow(NetworkError);
  });

  it('close() notifies even if the socket never emits a close event', () => {
    const { transport } = makeTransport(); // never opened
    const closes: unknown[] = [];
    transport.onClose(() => closes.push({}));
    transport.close();
    transport.close(); // idempotent
    expect(closes).toHaveLength(1);
  });

  it('error events enrich the close reason', () => {
    const { transport, socket } = makeTransport();
    const closes: Array<{ code?: number; reason?: string }> = [];
    transport.onClose((reason) => closes.push(reason));
    socket.serverError(new Error('connect ECONNREFUSED'));
    socket.serverClose(1006);
    expect(closes[0]).toEqual({ code: 1006, reason: 'connect ECONNREFUSED' });
  });

  it('missing global WebSocket fails with a clear upgrade hint', () => {
    const original = (globalThis as { WebSocket?: unknown }).WebSocket;
    delete (globalThis as { WebSocket?: unknown }).WebSocket;
    try {
      expect(
        () =>
          new WebSocketTransport({
            url: 'https://worker.example',
          }),
      ).toThrow(/WebSocket is not available.*Node 22+/s);
    } finally {
      (globalThis as { WebSocket?: unknown }).WebSocket = original;
    }
  });
});
