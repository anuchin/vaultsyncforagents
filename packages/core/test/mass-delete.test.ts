/**
 * Mass-delete quarantine (`SyncClientOptions.massDeleteGuard`): the guard
 * against the classic sync disaster — a dropped mount / wiped vault making
 * "everything is gone locally" look like "the user deleted everything".
 * It doubles as v1's startup barrier: the evaluation happens from the very
 * first cycle, so no cycle can ever open with a wipe.
 */

import { describe, expect, it } from 'vitest';

import {
  InMemoryStorageAdapter,
  InMemorySyncServer,
  SyncClient,
  type BlobStore,
  type Message,
} from '../src/index.js';

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);

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

interface Rig {
  server: InMemorySyncServer;
  client: SyncClient;
  storage: InMemoryStorageAdapter;
  scheduler: ManualScheduler;
}

function rig(options?: ConstructorParameters<typeof SyncClient>[0]['massDeleteGuard']): Rig {
  let t = 100_000;
  const server = new InMemorySyncServer({ now: () => ++t, vaultName: 'v' });
  server.register('dev-a', 'Alpha');
  const scheduler = new ManualScheduler();
  const storage = new InMemoryStorageAdapter({}, { now: () => ++t });
  const sent: Message[] = [];
  const client = new SyncClient({
    deviceId: 'dev-a',
    deviceName: 'Alpha',
    token: 'tok-dev-a',
    transport: () => {
      const pair = server.connectPair('tok-dev-a');
      return {
        send: (message) => {
          sent.push(message);
          pair.client.send(message);
        },
        onMessage: (cb) => pair.client.onMessage(cb),
        onClose: (cb) => pair.client.onClose(cb),
        close: () => pair.client.close(),
      };
    },
    blobStore: makeBlobStore(),
    storage,
    now: () => ++t,
    schedule: scheduler.schedule,
    ...(options !== undefined ? { massDeleteGuard: options } : {}),
  });
  return { server, client, storage, scheduler };
}

/** Seed `count` root files and sync them (one reconciliation). */
async function seedVault(r: Rig, count: number, prefix = 'f'): Promise<void> {
  for (let i = 0; i < count; i++) {
    await r.storage.writeFile(`/${prefix}${i}.md`, enc(`${prefix}-content-${i}`));
  }
  await r.client.connect();
  await r.client.waitIdle();
}

/** Delete every file the vault holds (the mount-drop shape), WITHOUT tombstoning via sync. */
async function wipeDisk(r: Rig): Promise<void> {
  for (const file of await r.storage.listFiles()) {
    if (file.path.startsWith('/.vaultsyncforagents/')) continue; // client state, not vault content
    await r.storage.deleteFile(file.path);
  }
}

/** Server-side live (non-tombstoned) file paths, sorted. */
function serverLive(server: InMemorySyncServer): string[] {
  return server
    .snapshot()
    .files.filter((f) => !f.deleted)
    .map((f) => f.path);
}

describe('mass-delete quarantine', () => {
  it('refuses a wipe-scale deletion push; the rest of the cycle still syncs', async () => {
    const r = rig();
    await seedVault(r, 30);
    expect(serverLive(r.server)).toHaveLength(30);

    await wipeDisk(r);
    await r.storage.writeFile('/survivor.md', enc('new work during the outage'));
    await r.client.triggerSync();

    // The bomb did not land…
    expect(serverLive(r.server)).toHaveLength(31); // 30 originals + the add
    expect(r.client.status().massDeleteGuard).toMatchObject({ deletions: 30, liveEntries: 30 });
    // …but the add went through — quarantine withholds deletions only.
    expect(r.server.snapshot().files.find((f) => f.path === '/survivor.md')).toBeDefined();
  });

  it('clears automatically when the scan heals (mount returns, hashes intact)', async () => {
    const r = rig();
    await seedVault(r, 30);
    // Capture the exact bytes before the "mount" drops.
    const contents = new Map<string, Uint8Array>();
    for (const f of await r.storage.listFiles()) {
      contents.set(f.path, await r.storage.readFile(f.path));
    }
    await wipeDisk(r);
    await r.client.triggerSync();
    expect(r.client.status().massDeleteGuard).toBeDefined();

    // "Remount": the files are back (content identity is what matters).
    for (const [path, bytes] of contents) {
      await r.storage.writeFile(path, bytes);
    }
    await r.client.triggerSync();
    expect(r.client.status().massDeleteGuard).toBeUndefined();
    expect(serverLive(r.server)).toHaveLength(30);
  });

  it('an armed confirmation lets exactly one cycle through, then the guard re-engages', async () => {
    const r = rig();
    await seedVault(r, 30);

    expect(r.client.confirmMassDeletion()).toBe(false); // nothing to confirm yet
    await wipeDisk(r);
    await r.client.triggerSync();
    expect(r.client.status().massDeleteGuard).toBeDefined();

    expect(r.client.confirmMassDeletion()).toBe(true);
    r.scheduler.flush();
    await r.client.waitIdle();
    expect(serverLive(r.server)).toHaveLength(0); // the (confirmed) wipe landed
    expect(r.client.status().massDeleteGuard).toBeUndefined();

    // The guard re-engages by default — a second bomb needs its own confirmation.
    await seedVault(r, 40);
    await wipeDisk(r);
    await r.client.triggerSync();
    expect(r.client.status().massDeleteGuard).toMatchObject({ deletions: 40 });
    expect(serverLive(r.server)).toHaveLength(40);
  });

  it('deletions at or below the floor pass through untouched', async () => {
    const r = rig();
    await seedVault(r, 30);
    for (let i = 0; i < 10; i++) {
      await r.storage.deleteFile(`/f${i}.md`);
    }
    await r.client.triggerSync();
    expect(r.client.status().massDeleteGuard).toBeUndefined();
    expect(serverLive(r.server)).toHaveLength(20);
  });

  it('honors the disabled opt-out', async () => {
    const r = rig({ disabled: true });
    await seedVault(r, 30);
    await wipeDisk(r);
    await r.client.triggerSync();
    expect(r.client.status().massDeleteGuard).toBeUndefined();
    expect(serverLive(r.server)).toHaveLength(0);
  });

  it('also covers folder tombstones (deletions count folders too)', async () => {
    const r = rig({ maxDeletions: 1, maxDeleteFraction: 0.01 });
    // One synced empty folder + one synced file, then wipe both from disk.
    await r.storage.ensureDir('/empty');
    await r.storage.writeFile('/a.md', enc('a'));
    await r.client.connect();
    await r.client.waitIdle();

    await r.storage.deleteFile('/a.md');
    // Remove the empty dir by deleting through the OS-level adapter seam: the
    // memory adapter's removeDir mirrors an empty-folder removal.
    await r.storage.removeDir?.('/empty');
    await r.client.triggerSync();
    expect(r.client.status().massDeleteGuard).toBeDefined();
    expect(serverLive(r.server)).toContain('/a.md');
    expect(serverLive(r.server)).toContain('/empty'); // folder tombstone withheld too
  });
});
