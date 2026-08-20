/**
 * End-to-end daemon composition against core's `InMemorySyncServer`: the
 * REAL production stack — `SyncClient` + `TrashGuardStorage` +
 * `NodeWatchAdapter` (chokidar) + `VaultSession` supervision + manager —
 * with only the WebSocket dial swapped for an in-memory transport pair and
 * the HTTP blob store for a Map cache. Covers the daemon-defining flows:
 * startup pull, agent edits detected and pushed LIVE (FR-41), health
 * snapshot aggregation, and graceful shutdown.
 */

import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { InMemorySyncServer, sha256Hex, SyncClient, type BlobStore } from '@vsa/core';
import { ConfigStore, NodeStorageAdapter } from '@vsa/node-runtime';
import {
  createNodeClientBundle,
  DaemonManager,
  daemonHealthPathFor,
  readDaemonHealthSnapshot,
} from '../src/daemon.js';

function mapBlobStore(): BlobStore {
  const blobs = new Map<string, Uint8Array>();
  return {
    async get(hash) {
      return blobs.get(hash);
    },
    async put(hash, bytes) {
      blobs.set(hash, bytes);
    },
  };
}

async function waitFor(probe: () => boolean, what: string, timeoutMs = 12_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (probe()) return;
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
  expect(probe(), what).toBe(true);
}

async function makeE2e(): Promise<{
  daemonRoot: string;
  server: InMemorySyncServer;
  manager: DaemonManager;
  healthPath: string;
}> {
  const base = await mkdtemp(join(tmpdir(), 'vsa-daemon-e2e-'));
  const daemonRoot = join(base, 'vault');
  const seedRoot = join(base, 'seed-vault');
  const configDir = join(base, 'config');
  await mkdir(daemonRoot, { recursive: true });
  await mkdir(seedRoot, { recursive: true });
  await mkdir(configDir, { recursive: true });

  // Remote content comes from a second device (the seed client): two files.
  await writeFile(join(seedRoot, 'agent-note.md'), 'remote v1\n', 'utf8');
  await writeFile(join(seedRoot, 'doomed.md'), 'doomed remote\n', 'utf8');

  const server = new InMemorySyncServer({ vaultName: 'e2e' });
  const seedToken = server.register('dev-seed', 'Seed Device', 'desktop');
  const seed = new SyncClient({
    deviceId: 'dev-seed',
    deviceName: 'Seed Device',
    token: seedToken,
    transport: () => server.connectPair(seedToken).client,
    blobStore: mapBlobStore(),
    storage: new NodeStorageAdapter({ root: seedRoot }),
  });
  await seed.connect();
  await seed.waitIdle();
  seed.close();

  // The daemon pairs as its own device over the machine config pattern.
  const daemonToken = server.register('dev-daemon', 'daemon@e2e', 'cli');
  const configStore = new ConfigStore({ configPath: join(configDir, 'config.json') });
  configStore.upsertVault({
    id: daemonRoot,
    name: 'e2e',
    url: 'https://e2e.example',
    deviceId: 'dev-daemon',
  });
  configStore.setToken(daemonRoot, daemonToken);

  const healthPath = daemonHealthPathFor(configStore);
  const manager = new DaemonManager({
    configStore,
    deviceName: 'daemon@e2e',
    healthPath,
    healthIntervalMs: 10_000, // snapshots on start/stop are enough here
    createClient: (vault, token, log, deviceName) =>
      createNodeClientBundle(vault, token, log, deviceName, {
        dial: () => server.connectPair(token).client,
        blobStore: mapBlobStore(),
      }),
  });
  return { daemonRoot, server, manager, healthPath };
}

describe('daemon end-to-end (real stack, in-memory server)', () => {
  it('pulls remote content, pushes a live agent edit via the watcher, snapshots health, stops gracefully', async () => {
    const { daemonRoot, server, manager, healthPath } = await makeE2e();

    await manager.start();

    // Startup reconciliation materialized the seed device's files…
    await waitFor(
      () => existsSync(join(daemonRoot, 'agent-note.md')),
      'startup pull: agent-note.md materialized',
    );
    expect(await readFile(join(daemonRoot, 'agent-note.md'), 'utf8')).toBe('remote v1\n');
    expect(await readFile(join(daemonRoot, 'doomed.md'), 'utf8')).toBe('doomed remote\n');

    // …and the health snapshot reflects the running daemon and the live vault.
    await waitFor(() => {
      const health = readDaemonHealthSnapshot(healthPath);
      return health?.running === true && health.vaults[0]?.state === 'live';
    }, 'health snapshot: running + live');
    const health = readDaemonHealthSnapshot(healthPath)!;
    expect(health.vaults[0]).toMatchObject({ vault: daemonRoot, name: 'e2e' });

    // An agent edits a plain file (FR-40/41): the watcher must push it.
    const agentContent = 'agent edit — pushed live\n';
    await writeFile(join(daemonRoot, 'agent-note.md'), agentContent, 'utf8');
    const agentHash = await sha256Hex(new TextEncoder().encode(agentContent));

    await waitFor(
      () =>
        server
          .snapshot()
          .files.some(
            (file) => file.path === '/agent-note.md' && file.hash === agentHash && !file.deleted,
          ),
      'watcher cycle pushed the agent edit to the server',
    );

    // Graceful shutdown: state settles, final snapshot records stopped.
    await manager.stop();
    const final = readDaemonHealthSnapshot(healthPath)!;
    expect(final.running).toBe(false);
    expect(final.vaults[0]?.state).toBe('stopped');
  });
});
