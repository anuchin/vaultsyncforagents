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
const bin = (s: string): ArrayBuffer => enc(s).slice().buffer;
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

  // Real-Obsidian E2E regression: an edit landing between the cycle's hash and
  // the create-commit's ack was once silently dropped — the index kept the old
  // hash with a current stat, the fast path skipped the file forever, and no
  // rescan ever pushed the edit. Pins the self-heal: the entry records the
  // HASH-time stat (never a later one), so the next scan re-hashes the edited
  // file and pushes it.
  it('an edit landing between hash and commit-ack is detected on the next scan and pushed', async () => {
    const server = new InMemorySyncServer({ vaultName: 'race' });
    server.register('dev-1', 'Desk', 'desktop');
    server.register('dev-inspect', 'Inspect', 'desktop');

    // Gate commitAcks: the create's ack is held until the edit has landed,
    // reproducing "modify arrives right after the server acked the create".
    let gating = true;
    const heldAcks: Message[] = [];
    const sockets: FakeSocket[] = [];
    const wsFactory: WebSocketFactory = (url) => {
      const pair = server.connectPair('tok-dev-1');
      const socket = new FakeSocket(url);
      sockets.push(socket);
      void Promise.resolve().then(() => socket.open());
      pair.client.onMessage((message) => {
        if (gating && message.type === 'commitAck') {
          heldAcks.push(message);
          return;
        }
        socket.receive(message);
      });
      // Bridge into the server like BridgedSocket (shadow send/close; capture
      // the original close first so the override does not recurse).
      const originalClose = socket.close.bind(socket);
      return Object.assign(socket, {
        send(data: string): void {
          if (socket.closed) throw new Error('send on closed socket');
          socket.sent.push(data);
          pair.client.send(JSON.parse(data) as Message);
        },
        close(code = 1000, reason = ''): void {
          originalClose(code, reason);
          try {
            pair.client.close();
          } catch {
            // peer already closed
          }
        },
      });
    };

    // Controlled disk stat sequence: writes are distinguishable by mtime.
    let diskTime = 0;
    const vault = new FakeVault();
    vault.adapter.clock = () => diskTime;
    const { app } = makeFakeApp(vault);

    const plugin = new VaultSyncPlugin(app as unknown as App, {} as PluginManifest, { wsFactory });
    asMockPlugin(plugin).store = {
      url: 'https://w.example',
      token: 'tok-dev-1',
      deviceId: 'dev-1',
      deviceName: 'Desk',
      settings: { rescanIntervalSec: 0, obsidianSync: false },
    };
    await plugin.onload();
    await vi.waitFor(() => expect(plugin.client!.status().state).toBe('live'), { timeout: 3000 });

    // t1 — the create: hashed with stat mtime=1111, committed, ack HELD.
    diskTime = 1111;
    await vault.adapter.writeBinary('race.md', bin('create content'));
    vault.emit('create', { path: 'race.md' });
    await vi.waitFor(() => expect(heldAcks.length).toBe(1), { timeout: 5000 });

    // t2 — the edit lands on disk while the ack is still in flight.
    diskTime = 2222;
    await vault.adapter.writeBinary('race.md', bin('edited content — longer'));
    expect(text(vault.adapter.files.get('race.md') ?? enc(''))).toBe('edited content — longer');

    // t3 — release the ack; cycle 1 completes.
    gating = false;
    for (const ack of heldAcks.splice(0)) sockets[0]!.receive(ack);
    await plugin.client!.waitIdle();

    const hashOfCreate = await sha256Hex(enc('create content'));
    const entry = plugin.client!.currentIndex()['/race.md'];
    expect(entry).toBeDefined();
    expect(entry!.hash).toBe(hashOfCreate);
    // The hardening invariant: the entry's mtime is the stat observed at HASH
    // time (1111) — never the current disk stat (2222) — so the fast path
    // cannot hide the edit.
    expect(entry!.mtime).toBe(1111);

    // The next scan (rescan / syncNow path) must detect and push the edit.
    await plugin.client!.triggerSync();
    const hashOfEdit = await sha256Hex(enc('edited content — longer'));
    const commits = sockets[0]!.sentMessages.filter(
      (m) => (m as Message).type === 'commit' && (m as { path?: string }).path === '/race.md',
    );
    expect(commits).toHaveLength(2);
    expect((commits[1] as { hash: string }).hash).toBe(hashOfEdit);

    const finalEntry = plugin.client!.currentIndex()['/race.md']!;
    expect(finalEntry.hash).toBe(hashOfEdit);
    expect(finalEntry.mtime).toBe(2222); // now honestly describing the pushed content
    expect(plugin.client!.status().state).toBe('live');

    // The authority's head converged to the edited content (what the E2E
    // asserts via /api/history): a second device syncs and sees the edit.
    const storage2 = new InMemoryStorageAdapter({});
    const pair2 = server.connectPair('tok-dev-inspect');
    const client2 = new SyncClient({
      deviceId: 'dev-inspect',
      deviceName: 'Inspect',
      token: 'tok-dev-inspect',
      transport: {
        send: (message) => pair2.client.send(message),
        onMessage: (cb) => pair2.client.onMessage(cb),
        onClose: (cb) => pair2.client.onClose(cb),
        close: () => pair2.client.close(),
      },
      blobStore: {
        get: async () => undefined,
        put: async () => {},
      },
      storage: storage2,
    });
    try {
      await client2.connect();
      expect(client2.currentIndex()['/race.md']).toBeDefined();
      expect(client2.currentIndex()['/race.md']!.hash).toBe(hashOfEdit);
      expect(text(await storage2.readFile('/race.md'))).toBe('edited content — longer');
    } finally {
      client2.close();
    }

    plugin.onunload();
  }, 15000);
});
