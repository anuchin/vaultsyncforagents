/**
 * Full plugin ↔ engine integration: `VaultSyncPlugin` over its real Obsidian
 * adapters + `WebSocketTransport`, welded to core's `InMemorySyncServer`
 * through a bridged fake socket. Proves the whole wiring — startup
 * reconciliation pushes local files; a second device's commit fans out and
 * materializes inside the (fake) vault; vault events push live edits.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  InMemoryStorageAdapter,
  sha256Hex,
  SyncClient,
  InMemorySyncServer,
  type Message,
  type Transport,
} from '@vsa/core';
import type { App, PluginManifest } from 'obsidian';
import { VaultSyncPlugin } from '../src/plugin.js';
import { asMockPlugin, resetObsidianMock } from './helpers/obsidian-mock.js';
import { makeFakeApp, FakeVault } from './helpers/fake-vault.js';
import { FakeFetch, FakeSocket } from './helpers/network-fakes.js';
import type { WebSocketFactory } from '../src/transport.js';

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);
const text = (b: Uint8Array): string => new TextDecoder().decode(b);

/** FakeSocket welded to a `MemoryTransport` client endpoint. */
class BridgedSocket extends FakeSocket {
  constructor(
    url: string,
    private readonly peer: { send(message: Message): void; close(): void },
  ) {
    super(url);
    void Promise.resolve().then(() => this.open());
  }

  /** Build a wsFactory whose sockets speak to the server with `token`. */
  static to(server: InMemorySyncServer, token: string): WebSocketFactory {
    return (url) => {
      const pair = server.connectPair(token);
      const socket = new BridgedSocket(url, pair.client);
      pair.client.onMessage((message) => socket.receive(message));
      return socket;
    };
  }

  override send(data: string): void {
    super.send(data);
    this.peer.send(JSON.parse(data) as Message);
  }

  override close(code = 1000, reason = ''): void {
    super.close(code, reason);
    try {
      this.peer.close();
    } catch {
      // peer already closed
    }
  }
}

describe('plugin ↔ InMemorySyncServer integration', () => {
  beforeEach(() => {
    resetObsidianMock();
    FakeSocket.opened = [];
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('pushes local files on startup, receives remote changes, and pushes live vault edits', async () => {
    // The authority with two pre-registered devices (plugin + second client).
    const server = new InMemorySyncServer({ vaultName: 'personal' });
    server.register('dev-1', 'Desk', 'desktop');
    server.register('dev-2', 'Agent', 'daemon');

    // Blob HTTP routes served from the in-memory server's CAS map.
    const fetcher = new FakeFetch().onPrefix('GET', '/blob/', (hash) => {
      const bytes = server.blobs.get(hash);
      if (bytes === undefined) return new Response('gone', { status: 404 });
      return new Response(bytes as unknown as BodyInit);
    });

    const vault = new FakeVault({ 'note.md': 'hello' });
    const { app } = makeFakeApp(vault);

    const wsFactory = BridgedSocket.to(server, 'tok-dev-1');
    const plugin = new VaultSyncPlugin(app as unknown as App, {} as PluginManifest, {
      fetchImpl: fetcher.fetchImpl,
      wsFactory,
    });
    asMockPlugin(plugin).store = {
      url: 'https://w.example',
      token: 'tok-dev-1',
      deviceId: 'dev-1',
      deviceName: 'Desk',
      settings: { rescanIntervalSec: 0, obsidianSync: false },
    };
    await plugin.onload();

    // 1. Startup reconciliation pushed the seeded local file.
    await vi.waitFor(() => expect(plugin.client!.currentIndex()['/note.md']).toBeDefined(), {
      timeout: 3000,
    });
    expect(plugin.client!.status().state).toBe('live');
    expect(server.blobs.size).toBeGreaterThan(0);

    // 2. A second device commits a new note → change fan-out → the plugin
    //    pulls the blob (HTTP /blob/:hash) and materializes it in the vault.
    const storage2 = new InMemoryStorageAdapter({});
    const pair2 = server.connectPair('tok-dev-2');
    const transport2: Transport = {
      send: (message) => pair2.client.send(message),
      onMessage: (cb) => pair2.client.onMessage(cb),
      onClose: (cb) => pair2.client.onClose(cb),
      close: () => pair2.client.close(),
    };
    const blobCache2 = new Map<string, Uint8Array>();
    const client2 = new SyncClient({
      deviceId: 'dev-2',
      deviceName: 'Agent',
      token: 'tok-dev-2',
      transport: transport2,
      blobStore: {
        get: async (hash) => blobCache2.get(hash),
        put: async (hash, bytes) => {
          blobCache2.set(hash, bytes);
        },
      },
      storage: storage2,
    });
    try {
      await client2.connect();
      await storage2.writeFile('/inbox/from-server.md', enc('from server'));
      await client2.triggerSync();

      await vi.waitFor(
        () =>
          expect(text(vault.adapter.files.get('inbox/from-server.md') ?? enc(''))).toBe(
            'from server',
          ),
        { timeout: 3000 },
      );

      // 3. A live local edit (vault event → watcher → debounced cycle) is
      //    committed to the authority with the new content's hash.
      vault.adapter.files.set('note.md', enc('hello v2'));
      vault.emit('modify', { path: 'note.md' });
      const hashOfV2 = await sha256Hex(enc('hello v2'));
      await vi.waitFor(
        () => expect(plugin.client!.currentIndex()['/note.md']!.hash).toBe(hashOfV2),
        { timeout: 3000 },
      );
    } finally {
      client2.close();
      plugin.onunload();
    }

    // The transport dialed exactly the authenticated worker URL.
    expect(FakeSocket.opened[0]!.url).toBe('wss://w.example/ws?token=tok-dev-1');
  }, 15000);
});
