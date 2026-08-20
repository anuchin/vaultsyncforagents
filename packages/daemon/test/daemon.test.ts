/**
 * `VaultSession` reconnect/backoff supervision and `DaemonManager`
 * multi-vault lifecycle — entirely against fakes: a scripted
 * `SyncClientLike`, a manual clock/scheduler, and injectable session/client
 * factories. No network, no chokidar, no real timers.
 */

import { mkdtemp, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { WatchAdapter } from '@vsa/core';
import { ConfigStore, type VaultEntry } from '@vsa/node-runtime';
import {
  backoffDelay,
  DaemonManager,
  daemonHealthPathFor,
  DEFAULT_BACKOFF,
  readDaemonHealthSnapshot,
  VaultSession,
  type ClientBundle,
  type DaemonManagerOptions,
  type SyncClientLike,
  type VaultDaemonStatus,
  type VaultSessionDeps,
  type VaultSessionLike,
} from '../src/daemon.js';

// --- fakes -----------------------------------------------------------------------------------

type ScriptStep = 'ok' | Error;

class FakeClient implements SyncClientLike {
  connectScript: ScriptStep[] = [];
  reconnectScript: ScriptStep[] = [];
  state: 'idle' | 'connecting' | 'syncing' | 'live' | 'disconnected' = 'idle';
  lastSyncAt: number | null = null;
  pending = 0;
  conflicts: never[] = [];
  connectCalls = 0;
  reconnectCalls = 0;
  closeCalls = 0;
  idleWaits = 0;
  watching: WatchAdapter | null = null;
  readonly dropHandlers: Array<(reason: string) => void> = [];
  private gate: Promise<void> | null = null;
  private releaseGate: (() => void) | null = null;

  status(): ReturnType<SyncClientLike['status']> {
    return { state: this.state, lastSyncAt: this.lastSyncAt, pending: this.pending, conflicts: this.conflicts };
  }

  async connect(): Promise<void> {
    this.connectCalls++;
    if (this.gate !== null) await this.gate;
    this.applyStep(this.connectScript.shift() ?? 'ok');
  }

  async reconnect(): Promise<void> {
    this.reconnectCalls++;
    this.applyStep(this.reconnectScript.shift() ?? 'ok');
  }

  /** Makes the NEXT connect() hang until {@link releaseHangingConnect}. */
  hangNextConnect(): void {
    this.gate = new Promise((resolve) => {
      this.releaseGate = resolve;
    });
  }

  releaseHangingConnect(): void {
    this.releaseGate?.();
    this.releaseGate = null;
    this.gate = null;
  }

  /** Simulates the transport's close notification. */
  drop(reason: string): void {
    for (const handler of [...this.dropHandlers]) handler(reason);
  }

  private applyStep(step: ScriptStep): void {
    if (step instanceof Error) {
      this.state = 'disconnected';
      throw step;
    }
    this.state = 'live';
    this.lastSyncAt = 1_735_100_000_000;
  }

  async waitIdle(): Promise<void> {
    this.idleWaits++;
  }

  close(): void {
    this.closeCalls++;
    this.state = 'idle';
  }

  startWatching(adapter: WatchAdapter): void {
    // Mirrors core's SyncClient: owning the watcher means starting it.
    this.watching = adapter;
    adapter.start(() => {});
  }
}

class FakeWatcher implements WatchAdapter {
  started = false;
  stopped = false;
  start(): void {
    this.started = true;
  }
  stop(): void {
    this.stopped = true;
  }
}

/** Manual timer queue: deterministic `now` + `schedule`. */
class ManualScheduler {
  private tasks: Array<{ at: number; fn: () => void; cancelled: boolean }> = [];
  now = 0;

  readonly schedule = (fn: () => void, ms: number): (() => void) => {
    const task = { at: this.now + ms, fn, cancelled: false };
    this.tasks.push(task);
    return () => {
      task.cancelled = true;
    };
  };

  async advance(ms: number): Promise<void> {
    this.now += ms;
    for (;;) {
      const due = this.tasks.filter((task) => !task.cancelled && task.at <= this.now);
      if (due.length === 0) return;
      due.sort((a, b) => a.at - b.at);
      const task = due[0]!;
      this.tasks.splice(this.tasks.indexOf(task), 1);
      task.fn();
      await Promise.resolve(); // let the reconnect promise settle
    }
  }

  nextDelay(): number | null {
    const pending = this.tasks.filter((task) => !task.cancelled).sort((a, b) => a.at - b.at);
    return pending.length === 0 ? null : pending[0]!.at - this.now;
  }
}

interface SessionRig {
  session: VaultSession;
  client: FakeClient;
  watcher: FakeWatcher;
  scheduler: ManualScheduler;
}

function makeSession(options: { random?: () => number; backoff?: Partial<typeof DEFAULT_BACKOFF> } = {}): SessionRig {
  const client = new FakeClient();
  const watcher = new FakeWatcher();
  const scheduler = new ManualScheduler();
  const session = new VaultSession({
    vault: { id: '/vaults/personal', name: 'personal', url: 'https://personal.example', deviceId: 'dev-1' },
    token: 'tok-1',
    client,
    watcher,
    onDrop: (callback) => {
      client.dropHandlers.push(callback);
    },
    log: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
    now: () => scheduler.now,
    schedule: scheduler.schedule,
    backoff: { ...DEFAULT_BACKOFF, ...options.backoff },
    random: options.random ?? (() => 0.5),
  });
  return { session, client, watcher, scheduler };
}

// --- backoff math -------------------------------------------------------------------------

describe('backoffDelay', () => {
  it('grows exponentially and caps at maxMs (60s default)', () => {
    const fixedRandom = () => 0.5; // jitter factor exactly 1.0
    const delays = [0, 1, 2, 3, 4, 5, 6, 7, 10, 20].map(
      (attempt) => backoffDelay(attempt, DEFAULT_BACKOFF, fixedRandom),
    );
    expect(delays.slice(0, 5)).toEqual([1000, 2000, 4000, 8000, 16000]);
    expect(delays[5]).toBe(32000);
    expect(delays[6]).toBe(60000);
    expect(delays[9]).toBe(60000);
  });

  it('applies symmetric ±25% jitter at the extremes', () => {
    const low = backoffDelay(0, DEFAULT_BACKOFF, () => 0);
    const high = backoffDelay(0, DEFAULT_BACKOFF, () => 1);
    expect(low).toBe(750);
    expect(high).toBe(1250);
  });
});

// --- session supervision -------------------------------------------------------------------

describe('VaultSession', () => {
  it('connects, attaches the watcher, and reports live', async () => {
    const rig = makeSession();
    await rig.session.start();
    expect(rig.client.connectCalls).toBe(1);
    expect(rig.client.watching).toBe(rig.watcher);
    expect(rig.watcher.started).toBe(true);
    expect(rig.session.status()).toMatchObject({
      vault: '/vaults/personal',
      name: 'personal',
      state: 'live',
      lastSyncAt: 1_735_100_000_000,
      pending: 0,
      conflicts: 0,
    });
  });

  it('retries a failed connect with exponential backoff until it succeeds', async () => {
    const rig = makeSession();
    rig.client.connectScript = [new Error('dial failed')];
    rig.client.reconnectScript = [new Error('dial failed'), 'ok'];

    await rig.session.start();
    expect(rig.session.status()).toMatchObject({ state: 'disconnected', error: 'dial failed' });
    expect(rig.scheduler.nextDelay()).toBe(1000); // attempt 0, jitter factor 1.0

    await rig.scheduler.advance(1000); // first retry fails again
    expect(rig.client.reconnectCalls).toBe(1);
    expect(rig.scheduler.nextDelay()).toBe(2000);

    await rig.scheduler.advance(2000); // second retry succeeds
    expect(rig.client.reconnectCalls).toBe(2);
    expect(rig.session.status().state).toBe('live');
    expect(rig.session.status().error).toBeUndefined();
    expect(rig.scheduler.nextDelay()).toBeNull();
  });

  it('resets the attempt counter after a successful connect', async () => {
    const rig = makeSession();
    rig.client.connectScript = [new Error('down')];
    rig.client.reconnectScript = [new Error('down'), 'ok', new Error('drop'), 'ok'];
    await rig.session.start();
    await rig.scheduler.advance(1000);
    await rig.scheduler.advance(2000); // live again (reconnect #2)
    expect(rig.session.status().state).toBe('live');

    rig.client.drop('connection closed');
    await Promise.resolve(); // reconnect #3 fails → backoff from attempt 0
    expect(rig.scheduler.nextDelay()).toBe(1000);
    await rig.scheduler.advance(1000); // reconnect #4 succeeds
    expect(rig.session.status().state).toBe('live');
  });

  it('reconnects on an unexpected drop while live (via the transport hook)', async () => {
    const rig = makeSession();
    await rig.session.start();
    expect(rig.client.reconnectCalls).toBe(0);

    rig.client.drop('server went away');
    await Promise.resolve();
    expect(rig.client.reconnectCalls).toBe(1);
    expect(rig.session.status()).toMatchObject({ state: 'live' });
  });

  it('ignores drop events that mirror an in-flight connect failure (no double retry)', async () => {
    const rig = makeSession();
    rig.client.connectScript = [new Error('dial refused')];
    rig.client.reconnectScript = ['ok'];
    rig.client.hangNextConnect();

    const started = rig.session.start();
    rig.client.drop('dial refused'); // transport close during connect — same failure
    rig.client.releaseHangingConnect();
    await started;
    await Promise.resolve();

    expect(rig.scheduler.nextDelay()).not.toBeNull(); // exactly one retry scheduled
    await rig.scheduler.advance(10_000);
    expect(rig.client.connectCalls + rig.client.reconnectCalls).toBe(2);
  });

  it('surfaces transient syncing state from the client', async () => {
    const rig = makeSession();
    await rig.session.start();
    rig.client.state = 'syncing';
    expect(rig.session.status().state).toBe('syncing');
  });

  it('stop(): stops the watcher, flushes via waitIdle, closes the client, cancels retries', async () => {
    const rig = makeSession();
    rig.client.connectScript = [new Error('down')];
    await rig.session.start();
    expect(rig.scheduler.nextDelay()).toBe(1000);

    await rig.session.stop();
    expect(rig.watcher.stopped).toBe(true);
    expect(rig.client.idleWaits).toBe(1);
    expect(rig.client.closeCalls).toBe(1);
    expect(rig.session.status().state).toBe('stopped');
    expect(rig.scheduler.nextDelay()).toBeNull();

    await rig.scheduler.advance(10 * 60_000); // nothing fires after stop
    expect(rig.client.reconnectCalls).toBe(0);

    await rig.session.stop(); // idempotent
    expect(rig.client.closeCalls).toBe(1);
  });
});

// --- manager ---------------------------------------------------------------------------------

class FakeSession implements VaultSessionLike {
  started = false;
  stopped = false;
  constructor(readonly deps: VaultSessionDeps) {}
  async start(): Promise<void> {
    this.started = true;
  }
  async stop(): Promise<void> {
    this.stopped = true;
  }
  status(): VaultDaemonStatus {
    return {
      vault: this.deps.vault.id,
      name: this.deps.vault.name,
      url: this.deps.vault.url,
      state: this.stopped ? 'stopped' : 'live',
      lastSyncAt: 42,
      pending: 1,
      conflicts: 2,
    };
  }
}

interface ManagerRig {
  configStore: ConfigStore;
  vaultA: string;
  vaultB: string;
  created: FakeSession[];
  options(vaultFilter?: string, extra?: Partial<DaemonManagerOptions>): DaemonManagerOptions;
  addVault(id: string, name: string, withDir?: boolean, withToken?: boolean): Promise<VaultEntry>;
}

async function makeManagerRig(): Promise<ManagerRig> {
  const configDir = await mkdtemp(join(tmpdir(), 'vsa-daemon-cfg-'));
  const configStore = new ConfigStore({ configPath: join(configDir, 'config.json') });
  const rig: ManagerRig = {
    configStore,
    vaultA: join(configDir, 'vault-a'),
    vaultB: join(configDir, 'vault-b'),
    created: [],
    options(vaultFilter?: string, extra: Partial<DaemonManagerOptions> = {}) {
      return {
        configStore,
        ...(vaultFilter !== undefined ? { vaultFilter } : {}),
        createSession: (deps) => {
          const session = new FakeSession(deps);
          rig.created.push(session);
          return session;
        },
        createClient: (): ClientBundle => ({
          client: new FakeClient(),
          watcher: new FakeWatcher(),
          onDrop: () => {},
        }),
        ...extra,
      };
    },
    async addVault(id, name, withDir = true, withToken = true) {
      if (withDir) await mkdir(id, { recursive: true });
      const entry: VaultEntry = { id, name, url: `https://${name}.example`, deviceId: `dev-${name}` };
      configStore.upsertVault(entry);
      if (withToken) configStore.setToken(id, `tok-${name}`);
      return entry;
    },
  };
  return rig;
}

describe('DaemonManager', () => {
  it('runs ONE process with sessions for every configured vault (FR-40) and aggregates health', async () => {
    const rig = await makeManagerRig();
    await rig.addVault(rig.vaultA, 'a');
    await rig.addVault(rig.vaultB, 'b');

    const manager = new DaemonManager(rig.options());
    await manager.start();

    expect(rig.created).toHaveLength(2);
    expect(rig.created.every((session) => session.started)).toBe(true);

    const health = manager.health();
    expect(health.running).toBe(true);
    expect(health.pid).toBe(process.pid);
    expect(health.vaults.map((vault) => vault.name)).toEqual(['a', 'b']);
    expect(health.vaults[0]).toMatchObject({ state: 'live', pending: 1, conflicts: 2, lastSyncAt: 42 });

    await manager.stop();
    expect(rig.created.every((session) => session.stopped)).toBe(true);
    expect(manager.health().running).toBe(false);
  });

  it('passes the vault token and a client bundle to each session', async () => {
    const rig = await makeManagerRig();
    await rig.addVault(rig.vaultA, 'a');
    const manager = new DaemonManager(rig.options());
    await manager.start();
    expect(rig.created[0]!.deps.token).toBe('tok-a');
    expect(rig.created[0]!.deps.client).toBeInstanceOf(FakeClient);
    await manager.stop();
  });

  it('--vault filter narrows to one vault and errors clearly on no match', async () => {
    const rig = await makeManagerRig();
    await rig.addVault(rig.vaultA, 'a');
    await rig.addVault(rig.vaultB, 'b');

    const filtered = new DaemonManager(rig.options(rig.vaultB));
    await filtered.start();
    expect(rig.created).toHaveLength(1);
    expect(rig.created[0]!.deps.vault.name).toBe('b');
    await filtered.stop();

    const missing = new DaemonManager(rig.options(join(rig.configStore.configPath, 'nope')));
    await expect(missing.start()).rejects.toThrow(/no linked vault matches/);
  });

  it('refuses to start a vault whose directory is missing (never tombstone a missing root)', async () => {
    const rig = await makeManagerRig();
    await rig.addVault(join(rig.configStore.configPath, 'ghost'), 'ghost', false, true);

    const manager = new DaemonManager(rig.options());
    await manager.start();
    expect(rig.created).toHaveLength(0);
    const vault = manager.health().vaults[0]!;
    expect(vault.state).toBe('error');
    expect(vault.error).toMatch(/does not exist/);
    await manager.stop();
  });

  it('reports a missing device token as an error status instead of starting', async () => {
    const rig = await makeManagerRig();
    await rig.addVault(rig.vaultA, 'a', true, false);

    const manager = new DaemonManager(rig.options());
    await manager.start();
    expect(rig.created).toHaveLength(0);
    expect(manager.health().vaults[0]!.error).toMatch(/no device token/);
    await manager.stop();
  });

  it('writes a periodic health snapshot and a final running:false snapshot on stop', async () => {
    const rig = await makeManagerRig();
    await rig.addVault(rig.vaultA, 'a');
    const scheduler = new ManualScheduler();
    const healthPath = daemonHealthPathFor(rig.configStore);

    const manager = new DaemonManager(
      rig.options(undefined, { schedule: scheduler.schedule, healthPath, healthIntervalMs: 5000 }),
    );
    await manager.start();
    expect(readDaemonHealthSnapshot(healthPath)?.running).toBe(true); // written at start
    await scheduler.advance(5000);
    expect(readDaemonHealthSnapshot(healthPath)?.vaults).toHaveLength(1);

    await manager.stop();
    const final = readDaemonHealthSnapshot(healthPath);
    expect(final?.running).toBe(false);
    expect(final?.vaults[0]?.state).toBe('stopped'); // last known per-vault state
  });

  it('readDaemonHealthSnapshot tolerates missing and corrupt files', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vsa-daemon-snap-'));
    expect(readDaemonHealthSnapshot(join(dir, 'absent.json'))).toBeNull();
    const { writeFile } = await import('node:fs/promises');
    await writeFile(join(dir, 'bad.json'), '{not json', 'utf8');
    expect(readDaemonHealthSnapshot(join(dir, 'bad.json'))).toBeNull();
    await writeFile(join(dir, 'wrong.json'), JSON.stringify({ running: 'yes' }), 'utf8');
    expect(readDaemonHealthSnapshot(join(dir, 'wrong.json'))).toBeNull();
  });
});
