import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { InMemorySyncServer, parseMessage, sha256Hex, type BlobStore } from '@vsa/core';
import { createNodeClientBundle, DEFAULT_BACKOFF, VaultSession } from '../src/daemon.js';

afterEach(() => vi.unstubAllGlobals());

it('the production WebSocket dial reconnects after a server drop and keeps watching edits', async () => {
  const root = await mkdtemp(join(tmpdir(), 'vsa-production-reconnect-'));
  await mkdir(join(root, 'vault'));
  const vault = { id: join(root, 'vault'), name: 'reconnect', url: 'https://test.example', deviceId: 'daemon' };
  const server = new InMemorySyncServer({ vaultName: 'reconnect' });
  const token = server.register('daemon', 'Daemon', 'cli');
  const sockets: BridgedSocket[] = [];
  class BridgedSocket {
    readonly pair = server.connectPair(token);
    private listeners = new Map<string, Array<(event: unknown) => void>>();
    constructor() {
      sockets.push(this);
      this.pair.client.onMessage(message => this.emit('message', { data: JSON.stringify(message) }));
      this.pair.client.onClose(reason => this.emit('close', reason));
      queueMicrotask(() => this.emit('open', undefined));
    }
    addEventListener(type: string, listener: (event: unknown) => void): void {
      const listeners = this.listeners.get(type) ?? [];
      listeners.push(listener);
      this.listeners.set(type, listeners);
    }
    private emit(type: string, event: unknown): void {
      for (const listener of this.listeners.get(type) ?? []) listener(event);
    }
    send(frame: string): void { this.pair.client.send(parseMessage(frame)); }
    close(code: number, reason: string): void { this.pair.client.close({ code, reason }); }
  }
  vi.stubGlobal('WebSocket', BridgedSocket);
  const blobs = new Map<string, Uint8Array>();
  const blobStore: BlobStore = {
    async get(hash) { return blobs.get(hash); },
    async put(hash, bytes) { blobs.set(hash, bytes); },
  };
  const log = { debug() {}, info() {}, warn() {}, error() {} };
  const bundle = createNodeClientBundle(vault, token, log, 'Daemon', { blobStore });
  const session = new VaultSession({
    ...bundle, vault, token, log, now: Date.now, backoff: DEFAULT_BACKOFF, random: () => 0.5,
    schedule(fn, ms) { const timer = setTimeout(fn, ms); return () => clearTimeout(timer); },
  });
  async function until(probe: () => boolean, timeoutMs = 2000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (!probe() && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20));
    expect(probe()).toBe(true);
  }
  try {
    await session.start();
    expect(session.status().state).toBe('live');
    expect(sockets).toHaveLength(1);
    sockets[0]!.pair.server.close({ code: 1006, reason: 'simulated network drop' });
    await until(() => sockets.length === 2 && session.status().state === 'live');
    const content = 'edit after automatic reconnect';
    const hash = await sha256Hex(new TextEncoder().encode(content));
    await writeFile(join(vault.id, 'after-reconnect.md'), content);
    await until(() => server.snapshot().files.some(file => file.path === '/after-reconnect.md' && file.hash === hash), 5000);
    await session.stop();
    expect(sockets).toHaveLength(2); // caller shutdown must not redial
  } finally {
    await session.stop();
  }
});
