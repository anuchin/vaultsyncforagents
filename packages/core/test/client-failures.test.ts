import { describe, expect, it, vi } from 'vitest';
import {
  InMemoryStorageAdapter, InMemorySyncServer, SyncClient,
  type Message, type SyncClientOptions, type Transport,
} from '../src/index.js';

const enc = (value: string) => new TextEncoder().encode(value);

function rig(options: { rewrite?: (message: Message) => Message; sendFailure?: unknown } = {}) {
  const server = new InMemorySyncServer();
  server.register('dev-a', 'Alpha');
  const pair = server.connectPair('tok-dev-a');
  const storage = new InMemoryStorageAdapter();
  const cache = new Map<string, Uint8Array>();
  const log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  let receive: (message: Message) => void = () => {};
  const transport: Transport = {
    send(message) {
      if (options.sendFailure !== undefined) throw options.sendFailure;
      pair.client.send(message);
    },
    onMessage(callback) {
      receive = callback;
      pair.client.onMessage((message) => callback(options.rewrite?.(message) ?? message));
    },
    onClose: (callback) => pair.client.onClose(callback),
    close: () => pair.client.close(),
  };
  const clientOptions: SyncClientOptions = {
    deviceId: 'dev-a', deviceName: 'Alpha', token: 'tok-dev-a',
    transport, storage, log,
    blobStore: { get: async (hash) => cache.get(hash), put: async (hash, bytes) => { cache.set(hash, bytes); } },
  };
  return { server, storage, cache, log, client: new SyncClient(clientOptions), receive: (message: Message) => receive(message) };
}

describe('SyncClient failure boundaries', () => {
  it('drops unsolicited replies and wrong-direction messages without changing local heads', async () => {
    const r = rig();
    await r.storage.writeFile('/note.md', enc('keep me'));
    await r.client.connect();
    const index = structuredClone(r.client.currentIndex());
    const winner = { id: 'v99', path: '/note.md', hash: 'h', size: 1, deviceId: 'dev-b', clock: { counter: 99, deviceId: 'dev-b' }, parentVersion: null, ts: 1, kind: 'edit' as const };
    const replies: Message[] = [
      { type: 'helloAck', deviceId: 'dev-b', vaultName: 'other', settings: { obsidianSync: false, displayName: 'other' } },
      { type: 'manifest', entries: {}, cursor: 999 },
      { type: 'commitAck', version: 'v99', clock: winner.clock, seq: 999 },
      { type: 'conflict', winner, loserDisposition: 'conflictCopy' },
      { type: 'blob', hash: 'h', content: 'eA==' },
      { type: 'blobAck', hash: 'h' },
      { type: 'snapshotCreateAck', id: 's99', name: '', ts: 1, seq: 999, fileCount: 0 },
      { type: 'snapshotRestoreAck', id: 's99', restored: 0, tombstoned: 1, seq: 999 },
    ];
    for (const message of replies) r.receive(message);
    r.receive({ type: 'pong' });
    r.receive({ type: 'error', code: 'REVOKED', message: 'unsolicited error' });
    r.receive({ type: 'ping' });
    await r.client.waitIdle();
    expect(r.log.warn.mock.calls.filter(([message]) => message === 'unexpected server reply')).toHaveLength(replies.length);
    expect(r.log.warn).toHaveBeenCalledWith('ignoring client-to-server message from server', { type: 'ping' });
    expect(r.log.error).toHaveBeenCalledWith('server error', 'REVOKED', 'unsolicited error');
    expect(r.client.currentIndex()).toEqual(index);
    expect(await r.storage.readFile('/note.md')).toEqual(enc('keep me'));
    r.client.close();
  });

  it('rejects snapshot operations while disconnected', async () => {
    const r = rig();
    await expect(r.client.createSnapshot()).rejects.toThrow('not connected');
    await expect(r.client.restoreSnapshot('s1')).rejects.toThrow('not connected');
  });

  it('turns non-Error send failures into rejected requests and drains the queue', async () => {
    const r = rig({ sendFailure: 'socket failed' });
    await expect(r.client.connect()).rejects.toThrow('socket failed');
    await r.client.waitIdle();
    expect(r.server.snapshot().files).toEqual([]);
    r.client.close();
  });

  it.each(['REVOKED', 'UNAUTHORIZED', 'PROTOCOL'] as const)('preserves local content when a blob upload is rejected with %s', async (code) => {
    const r = rig({ rewrite: (message) => message.type === 'blobAck' ? { type: 'error', code, message: 'upload refused' } : message });
    await r.client.connect();
    const bytes = enc('x'.repeat(300_000));
    await r.storage.writeFile('/large.md', bytes);
    await expect(r.client.triggerSync()).rejects.toThrow('upload refused');
    expect(await r.storage.readFile('/large.md')).toEqual(bytes);
    expect(r.client.currentIndex()['/large.md']).toBeUndefined();
    r.client.close();
  });

  it('refuses a corrupt downloaded blob before materializing or caching it', async () => {
    const r = rig({ rewrite: (message) => message.type === 'blob' ? { ...message, content: 'YmFk' } : message });
    // A second client puts real content on the same authority.
    r.server.register('dev-b', 'Beta');
    const remoteStorage = new InMemoryStorageAdapter();
    await remoteStorage.writeFile('/remote.md', enc('correct bytes'));
    const remote = new SyncClient({
      deviceId: 'dev-b', deviceName: 'Beta', token: 'tok-dev-b',
      transport: r.server.connectPair('tok-dev-b').client, storage: remoteStorage,
      blobStore: { get: async () => undefined, put: async () => {} },
    });
    await remote.connect();
    await expect(r.client.connect()).rejects.toThrow('failed verification on download');
    expect(await r.storage.exists('/remote.md')).toBe(false);
    expect(r.cache.size).toBe(0);
    remote.close();
    r.client.close();
  });

  it('reports a failed index persist without destroying the synced content', async () => {
    const r = rig();
    await r.client.connect();
    vi.spyOn(r.storage, 'writeFile').mockRejectedValueOnce(new Error('disk full'));
    r.receive({ type: 'pong' });
    await r.client.waitIdle();
    expect(r.log.warn).toHaveBeenCalledWith('failed to persist local index', expect.any(Error));
    expect(r.client.status().state).toBe('live');
    r.client.close();
  });

  it('uses the default debounce scheduler and cancels a pending sync on close', async () => {
    vi.useFakeTimers();
    const r = rig();
    let notify: Parameters<NonNullable<SyncClientOptions['schedule']>>[0] = () => {};
    try {
      await r.client.connect();
      r.client.startWatching({ start: (callback) => { notify = () => callback([{ kind: 'add', path: '/new.md' }]); }, stop: () => {} });
      await r.storage.writeFile('/new.md', enc('new'));
      notify();
      await vi.advanceTimersByTimeAsync(300);
      await r.client.waitIdle();
      expect(r.server.snapshot().files.some((file) => file.path === '/new.md')).toBe(true);
      await r.storage.writeFile('/new.md', enc('unsynced edit'));
      notify();
      r.client.close();
      await vi.advanceTimersByTimeAsync(300);
      expect(r.client.status().state).toBe('idle');
      expect(r.server.snapshot().versions).toBe(1);
    } finally {
      r.client.close();
      vi.useRealTimers();
    }
  });
});
