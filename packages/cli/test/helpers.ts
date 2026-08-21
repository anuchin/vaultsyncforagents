/**
 * CLI test rig: a fake worker HTTP surface (configurable /health, /pair,
 * /api/status, /api/history, /blob routes) plus core's `InMemorySyncServer`
 * as the WS/sync backend, all wired into an injectable `VsRuntime` with
 * captured output and scripted prompts. No real network, no real worker.
 */

import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { InMemorySyncServer, type SnapshotSummary } from '@vsa/core';
import type { Transport } from '@vsa/core';
import {
  ConfigStore,
  NodeStorageAdapter,
  type VaultEntry,
} from '@vsa/node-runtime';
import type { OutputWriter, PromptUi, VsRuntime } from '../src/runtime.js';
import type { HistoryDoc, StatusDoc } from '../src/http.js';

export type { HistoryDoc, StatusDoc };

export class OutputCapture implements OutputWriter {
  readonly lines: string[] = [];
  readonly warnings: string[] = [];
  readonly errors: string[] = [];
  log(text?: string): void {
    this.lines.push(text ?? '');
  }
  warn(text?: string): void {
    this.warnings.push(text ?? '');
  }
  error(text?: string): void {
    this.errors.push(text ?? '');
  }
  text(): string {
    return this.lines.join('\n');
  }
}

/** Prompts answered from a script; every prompt records its message. */
export class ScriptedPrompts implements PromptUi {
  readonly asked: string[] = [];
  private answers: Array<{ match?: RegExp; value: string | boolean }> = [];

  script(answer: string | boolean, match?: RegExp): this {
    this.answers.push({ match, value: answer });
    return this;
  }

  private next(message: string): string | boolean {
    this.asked.push(message);
    const index = this.answers.findIndex(
      (entry) => entry.match === undefined || entry.match.test(message),
    );
    if (index === -1) throw new Error(`unexpected prompt: ${message}`);
    const [entry] = this.answers.splice(index, 1);
    return entry!.value;
  }

  async text(message: string): Promise<string> {
    return String(this.next(message));
  }
  async password(message: string): Promise<string> {
    return String(this.next(message));
  }
  async confirm(message: string): Promise<boolean> {
    return Boolean(this.next(message));
  }
  async select<V extends string>(
    message: string,
    choices: readonly { value: V }[],
  ): Promise<V> {
    const answer = String(this.next(message));
    if (!choices.some((choice) => choice.value === answer)) {
      throw new Error(`scripted select answer ${JSON.stringify(answer)} is not one of the choices for: ${message}`);
    }
    return answer as V;
  }
}

export interface FakeWorkerState {
  claimed: boolean;
  validCode: string;
  /** Token minted by /pair (pre-registered on the in-memory sync server). */
  pairToken: string;
  pairDeviceId: string;
  /** Tokens accepted by authed routes (the pair token by default). */
  acceptedTokens: Set<string>;
  /** Seconds the worker's Date header runs behind local time (skew probe). */
  skewSeconds: number;
  /**
   * Version the fake worker reports on /health and /api/status (null = a
   * legacy worker that predates version reporting).
   */
  serverVersion: string | null;
  /** /api/status's version override for the doctor agreement check (defaults to serverVersion). */
  statusServerVersion?: string | null;
  statusDoc: StatusDoc;
  historyDoc: HistoryDoc | ((path: string) => HistoryDoc);
  /** Canned GET /api/snapshots body. */
  snapshotsDoc: SnapshotSummary[];
  blobs: Map<string, Uint8Array>;
  unreachable: boolean;
  pairRejectStatus?: number;
}

export const WORKER_URL = 'https://vault.example';

function defaultStatusDoc(): StatusDoc {
  return {
    vaultName: 'personal',
    claimed: true,
    health: 'ok',
    serverVersion: '0.1.0',
    devices: [
      { id: 'dev-desktop', name: 'MacBook', type: 'desktop', lastSeen: 1_000, revoked: false, online: true },
      { id: 'dev-phone', name: 'Pixel', type: 'mobile', lastSeen: 0, revoked: false, online: false },
    ],
    lastEdit: { ts: 1_735_000_000_000, deviceId: 'dev-desktop', path: '/notes/plan.md' },
    attachments: { count: 12, bytes: 4_500_000 },
    storageBytes: 120_000_000,
    recentEvents: [
      { seq: 7, ts: 1_735_000_000_000, deviceId: 'dev-desktop', kind: 'change', path: '/notes/plan.md' },
      { seq: 6, ts: 1_734_900_000_000, deviceId: null, kind: 'claimed', path: null },
    ],
  };
}

/** The HTTP half of a worker: routing + auth + canned bodies. */
export class FakeWorker {
  readonly state: FakeWorkerState;
  readonly calls: Array<{ method: string; path: string; auth?: string }> = [];
  private readonly now: () => number;

  constructor(state: Partial<FakeWalletInit> = {}, now: () => number = () => Date.now()) {
    this.now = now;
    this.state = {
      claimed: true,
      validCode: 'TEST-CODE',
      pairToken: 'tok-dev-1',
      pairDeviceId: 'dev-1',
      acceptedTokens: new Set(['tok-dev-1']),
      skewSeconds: 0,
      serverVersion: '0.1.0',
      statusDoc: defaultStatusDoc(),
      historyDoc: { path: '', head: null, versions: [] },
      snapshotsDoc: [],
      blobs: new Map(),
      unreachable: false,
      ...state,
    };
  }

  readonly fetchImpl = async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    const url = new URL(String(input));
    const method = (init?.method ?? 'GET').toUpperCase();
    const auth = header(init?.headers, 'authorization');
    this.calls.push({ method, path: url.pathname + url.search, auth });

    if (this.state.unreachable) throw new TypeError('fetch failed (simulated)');
    const json = (status: number, body: unknown, headers?: Record<string, string>): Response =>
      new Response(JSON.stringify(body), { status, headers });

    if (method === 'GET' && url.pathname === '/health') {
      const dateMs = this.now() - this.state.skewSeconds * 1000;
      return json(
        200,
        {
          ok: true,
          claimed: this.state.claimed,
          ...(this.state.serverVersion !== null
            ? { serverVersion: this.state.serverVersion }
            : {}),
        },
        { date: new Date(dateMs).toUTCString() },
      );
    }
    if (method === 'POST' && url.pathname === '/pair') {
      const body = JSON.parse(String(init?.body ?? '{}')) as { code?: string; deviceName?: string };
      if (body.code !== this.state.validCode) {
        return json(this.state.pairRejectStatus ?? 401, { error: 'pairing code is invalid, expired, or already used' });
      }
      this.state.acceptedTokens.add(this.state.pairToken);
      return json(200, { ok: true, token: this.state.pairToken, deviceId: this.state.pairDeviceId });
    }
    if (method === 'POST' && url.pathname === '/admin/login') {
      const body = JSON.parse(String(init?.body ?? '{}')) as { passphrase?: string };
      if (body.passphrase !== 'correct-horse') return json(401, { error: 'invalid passphrase' });
      return new Response(JSON.stringify({ ok: true, expiresAt: 1 }), {
        status: 200,
        headers: { 'set-cookie': 'vsa_admin=1234.abcd; HttpOnly; Secure; SameSite=Lax; Path=/' },
      });
    }
    if (method === 'POST' && url.pathname === '/admin/revoke') {
      if (header(init?.headers, 'cookie') === undefined) return json(401, { error: 'admin session required' });
      const body = JSON.parse(String(init?.body ?? '{}')) as { deviceId?: string };
      if (body.deviceId === undefined) return json(400, { error: 'deviceId is required' });
      return json(200, { ok: true });
    }
    if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/blob/')) {
      if (!this.state.acceptedTokens.has(String(auth).replace(/^Bearer /, '')) || auth === undefined) {
        return json(401, { error: 'device token or admin session required' });
      }
    }
    if (method === 'GET' && url.pathname === '/api/status') {
      // The version surfaces agree by default; statusServerVersion forces a
      // disagreement for the doctor agreement check's test.
      const reported =
        this.state.statusServerVersion !== undefined
          ? this.state.statusServerVersion
          : this.state.serverVersion;
      const doc = { ...this.state.statusDoc };
      if (reported === null) delete doc.serverVersion;
      else doc.serverVersion = reported;
      return json(200, doc);
    }
    if (method === 'GET' && url.pathname === '/api/history') {
      const path = url.searchParams.get('path') ?? '';
      if (path === '' || !path.startsWith('/')) return json(400, { error: 'path required' });
      const doc = typeof this.state.historyDoc === 'function' ? this.state.historyDoc(path) : this.state.historyDoc;
      return json(200, { ...doc, path });
    }
    if (method === 'GET' && url.pathname === '/api/snapshots') {
      return json(200, { snapshots: this.state.snapshotsDoc });
    }
    if (url.pathname.startsWith('/blob/')) {
      const hash = url.pathname.slice('/blob/'.length);
      if (method === 'GET') {
        const blob = this.state.blobs.get(hash);
        return blob === undefined
          ? json(404, { error: 'no such blob' })
          : new Response(blob as BodyInit, { status: 200 });
      }
      if (method === 'PUT') {
        this.state.blobs.set(hash, new Uint8Array(await new Response(init?.body).arrayBuffer()));
        return json(201, { ok: true });
      }
    }
    return json(404, { error: 'not found' });
  };
}

type FakeWalletInit = FakeWorkerState;

function header(headers: HeadersInit | undefined, name: string): string | undefined {
  if (headers === undefined) return undefined;
  const record: Record<string, string> = Array.isArray(headers)
    ? Object.fromEntries(headers)
    : (headers as Record<string, string>);
  for (const [key, value] of Object.entries(record)) {
    if (key.toLowerCase() === name) return value;
  }
  return undefined;
}

export interface Rig {
  runtime: VsRuntime;
  output: OutputCapture;
  prompts: ScriptedPrompts;
  fake: FakeWorker;
  server: InMemorySyncServer;
  configStore: ConfigStore;
  vaultDir: string;
  configDir: string;
  storage: NodeStorageAdapter;
  /** Link the vault non-interactively against the fake worker. */
  link(): Promise<void>;
}

export async function makeRig(options: { fake?: Partial<FakeWalletInit>; now?: () => number } = {}): Promise<Rig> {
  const configDir = await mkdtemp(join(tmpdir(), 'vsa-cli-config-'));
  const vaultDir = await mkdtemp(join(tmpdir(), 'vsa-cli-vault-'));
  const configStore = new ConfigStore({ configPath: join(configDir, 'config.json') });
  const clock = options.now ?? (() => 1_735_100_000_000);
  const fake = new FakeWorker(options.fake, clock);
  const server = new InMemorySyncServer({ vaultName: 'personal', now: clock });
  server.register('dev-1', 'cli-box', 'cli');
  const output = new OutputCapture();
  const prompts = new ScriptedPrompts();
  const storage = new NodeStorageAdapter({ root: vaultDir });

  const runtime: VsRuntime = {
    configStore,
    fetchImpl: fake.fetchImpl as typeof fetch,
    transportFactory: (_vault: VaultEntry, token: string): Transport =>
      server.connectPair(token).client,
    now: options.now ?? (() => 1_735_100_000_000),
    output,
    prompts,
  };

  return {
    runtime,
    output,
    prompts,
    fake,
    server,
    configStore,
    vaultDir,
    configDir,
    storage,
    async link(): Promise<void> {
      const { runLink } = await import('../src/commands/link.js');
      await runLink(runtime, {
        path: vaultDir,
        url: WORKER_URL,
        code: fake.state.validCode,
        name: 'cli-box',
        force: false,
      });
    },
  };
}

/** A config entry pointing the rig's vault at the fake worker. */
export function seedVault(rig: Rig, overrides: Partial<VaultEntry> = {}): VaultEntry {
  const entry: VaultEntry = {
    id: rig.vaultDir,
    name: 'personal',
    url: WORKER_URL,
    deviceId: 'dev-1',
    ...overrides,
  };
  rig.configStore.upsertVault(entry);
  rig.configStore.setToken(entry.id, rig.fake.state.pairToken);
  return entry;
}
