import { describe, expect, it } from 'vitest';

import {
  InMemoryStorageAdapter,
  InMemorySyncServer,
  LOCAL_INDEX_STATE_PATH,
  ProtocolError,
  SyncClient,
  validateChangeMessage,
  validateCommitAckMessage,
  validateConflictMessage,
  validateManifestEntry,
  validateManifestMessage,
  type BlobStore,
  type ChangeMessage,
  type CommitAckMessage,
  type ConflictMessage,
  type LogAdapter,
  type ManifestMessage,
  type Message,
} from '../src/index.js';

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);
const text = (b: Uint8Array): string => new TextDecoder().decode(b);

function makeBlobStore(): BlobStore & { map: Map<string, Uint8Array> } {
  const map = new Map<string, Uint8Array>();
  return {
    map,
    get: async (hash) => map.get(hash),
    put: async (hash, bytes) => {
      map.set(hash, bytes);
    },
  };
}

/** Queue-everything scheduler with manual flush (no real timers). */
class ManualScheduler {
  readonly entries: Array<{ fn: () => void; ms: number; cancelled: boolean }> = [];
  readonly schedule = (fn: () => void, ms: number): (() => void) => {
    const entry = { fn, ms, cancelled: false };
    this.entries.push(entry);
    return () => {
      entry.cancelled = true;
    };
  };
  flush(): void {
    while (this.entries.length > 0) {
      const batch = this.entries.splice(0);
      for (const entry of batch) if (!entry.cancelled) entry.fn();
    }
  }
}

/** Log adapter that records warn/error lines for assertions. */
class CapturingLog {
  readonly warns: string[] = [];
  readonly errors: string[] = [];
  readonly adapter: LogAdapter = {
    debug: () => {},
    info: () => {},
    warn: (message, ...details) => {
      this.warns.push(`${message} ${details.map(String).join(' ')}`);
    },
    error: (message, ...details) => {
      this.errors.push(`${message} ${details.map(String).join(' ')}`);
    },
  };
}

interface ClientRig {
  client: SyncClient;
  storage: InMemoryStorageAdapter;
  blobStore: BlobStore & { map: Map<string, Uint8Array> };
  scheduler: ManualScheduler;
  log: CapturingLog;
  sent: Message[];
}

function rig(): { server: InMemorySyncServer; make: (id: string, name: string, poison?: (message: Message) => void) => ClientRig } {
  let t = 100_000;
  const server = new InMemorySyncServer({ now: () => ++t, vaultName: 'v' });
  const make = (id: string, name: string, poison?: (message: Message) => void): ClientRig => {
    server.register(id, name);
    const scheduler = new ManualScheduler();
    const storage = new InMemoryStorageAdapter({}, { now: () => ++t });
    const blobStore = makeBlobStore();
    const log = new CapturingLog();
    const sent: Message[] = [];
    const client = new SyncClient({
      deviceId: id,
      deviceName: name,
      token: `tok-${id}`,
      transport: () => {
        const pair = server.connectPair(`tok-${id}`);
        return {
          send: (message) => {
            sent.push(message);
            pair.client.send(message);
          },
          onMessage: (cb) =>
            pair.client.onMessage((message) => {
              poison?.(message);
              cb(message);
            }),
          onClose: (cb) => pair.client.onClose(cb),
          close: () => pair.client.close(),
        };
      },
      blobStore,
      storage,
      log: log.adapter,
      now: () => ++t,
      debounceMs: 250,
      schedule: scheduler.schedule,
    });
    return { client, storage, blobStore, scheduler, log, sent };
  };
  return { server, make };
}

async function settle(...rigs: ReadonlyArray<ClientRig>): Promise<void> {
  for (let round = 0; round < 4; round++) {
    for (const r of rigs) await r.client.waitIdle();
  }
}

async function readState(r: ClientRig): Promise<{ schemaVersion: number; entries: Record<string, unknown> }> {
  return JSON.parse(text(await r.storage.readFile(LOCAL_INDEX_STATE_PATH)));
}

// --- validator units ---------------------------------------------------------------

const goodEntry = {
  path: '/a.md',
  version: 'v1',
  hash: 'ab'.repeat(32),
  size: 3,
  deleted: false,
  clock: { counter: 1, deviceId: 'dev-a' },
  mtime: 5,
};

const goodAck: CommitAckMessage = { type: 'commitAck', version: 'v1', clock: { counter: 2, deviceId: 'dev-a' }, seq: 7 };

const goodChange: ChangeMessage = {
  type: 'change',
  path: '/a.md',
  version: 'v1',
  hash: 'ab'.repeat(32),
  size: 3,
  deleted: false,
  device: 'dev-a',
  clock: { counter: 1, deviceId: 'dev-a' },
  kind: 'edit',
  seq: 7,
};

const goodConflict: ConflictMessage = {
  type: 'conflict',
  winner: {
    id: 'v1',
    path: '/a.md',
    hash: 'ab'.repeat(32),
    size: 3,
    deviceId: 'dev-a',
    clock: { counter: 2, deviceId: 'dev-a' },
    parentVersion: null,
    ts: 5,
    kind: 'edit',
  },
  loserDisposition: 'conflictCopy',
  seq: 7,
};

describe('server-data validators (ingest boundary)', () => {
  it('accepts well-formed payloads unchanged', () => {
    expect(validateManifestEntry({ ...goodEntry })).toEqual(goodEntry);
    expect(() => validateManifestMessage({ type: 'manifest', entries: { '/a.md': { ...goodEntry } }, cursor: 3 })).not.toThrow();
    expect(() => validateCommitAckMessage({ ...goodAck })).not.toThrow();
    expect(() => validateChangeMessage({ ...goodChange })).not.toThrow();
    expect(() => validateConflictMessage({ ...goodConflict })).not.toThrow();
  });

  it('rejects a manifest entry with a poisoned field per field class', () => {
    const cases: Array<[string, unknown]> = [
      ['version', undefined], // JSON.stringify drops it — parseEntry would throw on next load
      ['version', ''],
      ['path', 42],
      ['path', ''],
      ['size', 'huge'],
      ['size', -1],
      ['size', 1.5],
      ['hash', 7],
      ['deleted', 'no'],
      ['clock', { counter: 1.5, deviceId: 'dev-a' }],
      ['clock', { counter: 0, deviceId: 'dev-a' }],
      ['clock', { counter: 1 }],
      ['mtime', 'yesterday'],
      ['isFolder', 1],
    ];
    for (const [field, value] of cases) {
      expect(() => validateManifestEntry({ ...goodEntry, [field]: value })).toThrow(ProtocolError);
    }
    expect(() => validateManifestEntry('nope')).toThrow(ProtocolError);
  });

  it('rejects a manifest reply with a poisoned cursor', () => {
    const message: ManifestMessage = { type: 'manifest', entries: { '/a.md': { ...goodEntry } }, cursor: 2.5 };
    expect(() => validateManifestMessage(message)).toThrow(ProtocolError);
  });

  it('rejects a commitAck whose version is undefined (would persist as a missing versionId and brick the next startup)', () => {
    const poisoned: CommitAckMessage = { ...goodAck, version: undefined as unknown as string };
    expect(() => validateCommitAckMessage(poisoned)).toThrow(ProtocolError);
    const viaJsonRoundTrip = JSON.parse(JSON.stringify(poisoned)) as CommitAckMessage;
    expect('version' in viaJsonRoundTrip).toBe(false); // the round-trip drops it — persistence must never see it
    expect(() => validateCommitAckMessage({ ...goodAck, clock: { counter: 0, deviceId: 'd' } })).toThrow(ProtocolError);
    expect(() => validateCommitAckMessage({ ...goodAck, seq: 1.5 })).toThrow(ProtocolError);
  });

  it('rejects a change broadcast with poisoned fields', () => {
    expect(() => validateChangeMessage({ ...goodChange, seq: 'x' as unknown as number })).toThrow(ProtocolError);
    expect(() => validateChangeMessage({ ...goodChange, kind: 'sideways' as never })).toThrow(ProtocolError);
    expect(() => validateChangeMessage({ ...goodChange, size: -2 })).toThrow(ProtocolError);
    expect(() => validateChangeMessage({ ...goodChange, fromPath: 9 as unknown as string })).toThrow(ProtocolError);
  });

  it('rejects a conflict winner with poisoned fields', () => {
    expect(() =>
      validateConflictMessage({ ...goodConflict, winner: { ...goodConflict.winner, size: -1 } }),
    ).toThrow(ProtocolError);
    expect(() =>
      validateConflictMessage({ ...goodConflict, winner: { ...goodConflict.winner, id: '' } }),
    ).toThrow(ProtocolError);
    expect(() => validateConflictMessage({ ...goodConflict, seq: 'x' as unknown as number })).toThrow(ProtocolError);
  });
});

// --- client boundary -----------------------------------------------------------------

describe('SyncClient — poisoned server data is rejected before persistence', () => {
  it('rejects a manifest entry with a non-numeric size; the connect fails and nothing is persisted', async () => {
    const { make } = rig();
    const a = make('dev-a', 'Alpha');
    await a.storage.writeFile('/notes/x.md', enc('fresh'));
    await a.client.connect(); // the server now has the head

    const b = make('dev-b', 'Beta', (message) => {
      if (message.type !== 'manifest') return;
      const entry = message.entries['/notes/x.md'];
      if (entry !== undefined) (entry as { size?: unknown }).size = 'huge';
    });
    await expect(b.client.connect()).rejects.toThrow(ProtocolError);

    expect(b.client.currentIndex()['/notes/x.md']).toBeUndefined();
    expect(b.sent.filter((m) => m.type === 'getBlob')).toEqual([]); // content never fetched
    expect((await readState(b)).entries).toEqual({});
  });

  it('rejects a commitAck whose version is dropped (undefined versionId); the ack is not folded into the index', async () => {
    const { make } = rig();
    const a = make('dev-a', 'Alpha', (message) => {
      if (message.type === 'commitAck') delete (message as { version?: string }).version;
    });
    await a.storage.writeFile('/notes/new.md', enc('fresh'));
    await expect(a.client.connect()).rejects.toThrow(ProtocolError);

    expect(a.client.currentIndex()['/notes/new.md']).toBeUndefined();
    expect((await readState(a)).entries['/notes/new.md']).toBeUndefined();
  });

  it('rejects a change broadcast with a poisoned clock; the client stays operational and converges via the manifest', async () => {
    const { make } = rig();
    const a = make('dev-a', 'Alpha');
    const b = make('dev-b', 'Beta', (message) => {
      if (message.type === 'change') {
        (message as { clock?: unknown }).clock = { counter: 1.5, deviceId: 'dev-a' };
      }
    });
    await a.client.connect();
    await b.client.connect();
    await settle(a, b);

    await a.storage.writeFile('/notes/y.md', enc('y1'));
    await a.client.triggerSync();
    await settle(a, b);

    // The poisoned broadcast was rejected: nothing applied, nothing persisted…
    expect(b.client.currentIndex()['/notes/y.md']).toBeUndefined();
    expect(await b.storage.exists('/notes/y.md')).toBe(false);
    // …and B is still operational: the next cycle pulls the legit head.
    await b.client.triggerSync();
    await settle(a, b);
    expect(b.client.status().state).toBe('live');
    expect(text(await b.storage.readFile('/notes/y.md'))).toBe('y1');
    const entry = b.client.currentIndex()['/notes/y.md'];
    expect(entry?.clock.counter).toBe(1); // integer — the poisoned 1.5 never landed
  });
});

// --- corrupt state recovery ------------------------------------------------------------

describe('SyncClient — corrupt local index state recovery', () => {
  it('quarantines an unparseable state file and resyncs from a full manifest', async () => {
    const { make } = rig();
    const a = make('dev-a', 'Alpha');
    await a.storage.writeFile('/notes/shared.md', enc('shared'));
    await a.client.connect();

    const b = make('dev-b', 'Beta');
    await b.storage.writeFile(LOCAL_INDEX_STATE_PATH, enc('{{{ not json'));
    await b.client.connect();

    expect(b.client.status().state).toBe('live');
    expect(text(await b.storage.readFile('/notes/shared.md'))).toBe('shared');
    expect(text(await b.storage.readFile(`${LOCAL_INDEX_STATE_PATH}.corrupt.bak`))).toBe('{{{ not json');
    const state = await readState(b);
    expect(state.entries['/notes/shared.md']).toBeDefined();
    expect(b.log.warns.some((line) => /quarantined/i.test(line))).toBe(true);
  });

  it('quarantines a schema-invalid state file (poisoned entry field) the same way', async () => {
    const { make } = rig();
    const poisoned = JSON.stringify({
      schemaVersion: 2,
      entries: {
        '/a.md': { hash: 'ab'.repeat(32), size: -3, versionId: 'v1', clock: { counter: 1, deviceId: 'd' } },
      },
    });
    const b = make('dev-b', 'Beta');
    await b.storage.writeFile(LOCAL_INDEX_STATE_PATH, enc(poisoned));
    await b.client.connect();

    expect(b.client.status().state).toBe('live');
    expect(b.client.currentIndex()['/a.md']).toBeUndefined();
    expect(text(await b.storage.readFile(`${LOCAL_INDEX_STATE_PATH}.corrupt.bak`))).toBe(poisoned);
  });
});
