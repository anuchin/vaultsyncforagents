/**
 * WS protocol hardening (§14, audit follow-ups): commits must carry CANONICAL
 * vault paths (`normalizeVaultPath(p) === p`) so the server's index key can
 * never diverge from the form every client normalizes to, snapshot labels are
 * length-capped, and a socket that keeps violating the protocol is
 * disconnected after three strikes — pre-auth sockets included.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import type { ServerMessage } from '@vsa/core';
import { claim, hello, resetAll, WsClient } from './helpers.js';

type ErrorMessage = Extract<ServerMessage, { type: 'error' }>;

beforeEach(async () => {
  await resetAll();
});

describe('canonical commit paths', () => {
  it('rejects a backslash path (the raw form is not canonical)', async () => {
    const { token } = await claim();
    const ws = await WsClient.connect();
    expect((await hello(ws, token)).type).toBe('helloAck');

    ws.send({
      type: 'commit',
      path: 'dir\\file.md',
      parentVersion: null,
      hash: 'a'.repeat(64),
      size: 1,
      kind: 'edit',
    });
    const error = (await ws.next((m) => m.type === 'error')) as ErrorMessage;
    expect(error.code).toBe('PROTOCOL');
    expect(error.message).toMatch(/canonical vault path/);
    ws.close();
  });

  it('rejects interior-.., duplicate-slash, and no-leading-slash spellings', async () => {
    const { token } = await claim();
    const ws = await WsClient.connect();
    expect((await hello(ws, token)).type).toBe('helloAck');

    // Two strikes only — the third would disconnect (see the describe below).
    for (const path of ['/a/../b.md', '/a//b.md']) {
      ws.send({
        type: 'commit',
        path,
        parentVersion: null,
        hash: 'b'.repeat(64),
        size: 1,
        kind: 'edit',
      });
      const error = (await ws.next((m) => m.type === 'error')) as ErrorMessage;
      expect(error.code, path).toBe('PROTOCOL');
      expect(error.message, path).toMatch(/canonical vault path/);
    }
    ws.close();
  });
});

describe('snapshot label cap', () => {
  it('rejects a snapshot name over 100 characters', async () => {
    const { token } = await claim();
    const ws = await WsClient.connect();
    expect((await hello(ws, token)).type).toBe('helloAck');

    ws.send({ type: 'snapshotCreate', name: 'x'.repeat(101) });
    const error = (await ws.next((m) => m.type === 'error')) as ErrorMessage;
    expect(error.code).toBe('PROTOCOL');
    expect(error.message).toMatch(/exceeds 100 characters/);
    ws.close();
  });
});

describe('protocol-violation disconnect (3 strikes)', () => {
  it('closes the socket (1002) after three violations, pre-auth included', async () => {
    await claim();
    const ws = await WsClient.connect();
    for (let i = 0; i < 3; i++) {
      ws.sendRaw('{"type":"definitely-not-a-message"}');
      const error = (await ws.next((m) => m.type === 'error')) as ErrorMessage;
      expect(error.code).toBe('PROTOCOL');
    }
    await ws.waitClosed();
    expect(ws.closeCode).toBe(1002);
    expect(ws.closeReason).toBe('too many protocol violations');
  });

  it('two violations keep the socket alive (a buggy commit must not insta-kill)', async () => {
    const { token } = await claim();
    const ws = await WsClient.connect();
    expect((await hello(ws, token)).type).toBe('helloAck');

    for (let i = 0; i < 2; i++) {
      ws.sendRaw('this is not json');
      const error = (await ws.next((m) => m.type === 'error')) as ErrorMessage;
      expect(error.code).toBe('PROTOCOL');
    }
    // Still connected: a ping is answered.
    ws.send({ type: 'ping' });
    expect((await ws.next((m) => m.type === 'pong')).type).toBe('pong');
    ws.close();
  });
});
