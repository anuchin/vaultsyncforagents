import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { App, PluginManifest } from 'obsidian';
import { VaultSyncPlugin } from '../src/plugin.js';
import { asMockPlugin, Notice, protocolHandlers, resetObsidianMock } from './helpers/obsidian-mock.js';
import { makeFakeApp, FakeVault } from './helpers/fake-vault.js';
import { FakeFetch, FakeSocket, jsonResult, offlineWsFactory } from './helpers/network-fakes.js';

const LINKED = { url: 'https://w.example', token: 'tok-1', deviceId: 'dev-1', deviceName: 'Desk' };

/** Plugins created via makePlugin, unloaded after each test. */
const created: VaultSyncPlugin[] = [];

function makePlugin(options: {
  store?: Record<string, unknown> | null;
  vault?: FakeVault;
  fetcher?: FakeFetch;
}): {
  plugin: VaultSyncPlugin;
  vault: FakeVault;
  workspace: ReturnType<typeof makeFakeApp>['workspace'];
} {
  const vault = options.vault ?? new FakeVault();
  const { app, workspace } = makeFakeApp(vault);
  const plugin = new VaultSyncPlugin(app as unknown as App, {} as PluginManifest, {
    fetchImpl: (options.fetcher ?? new FakeFetch()).fetchImpl,
    wsFactory: offlineWsFactory,
  });
  asMockPlugin(plugin).store = options.store ?? null;
  created.push(plugin);
  return { plugin, vault, workspace };
}

async function flush(hops = 10): Promise<void> {
  for (let i = 0; i < hops; i++) await Promise.resolve();
}

describe('VaultSyncPlugin lifecycle', () => {
  beforeEach(() => {
    resetObsidianMock();
    FakeSocket.opened = [];
  });
  afterEach(() => {
    for (const plugin of created.splice(0)) plugin.onunload();
    vi.useRealTimers();
  });

  it('onload (unlinked): registers the settings tab + deep-link handler, no sync machinery', async () => {
    const { plugin } = makePlugin({});
    await plugin.onload();

    expect(asMockPlugin(plugin).settingTabs).toHaveLength(1);
    expect(protocolHandlers['vaultsyncforagents']).toBeDefined();
    expect(protocolHandlers['vaultsyncforagents/pair']).toBeDefined();
    expect(plugin.client).toBeNull();
    expect(asMockPlugin(plugin).statusBarItems).toHaveLength(0);
  });

  it('onload (linked): starts sync — status bar painted offline when the worker is unreachable', async () => {
    const { plugin } = makePlugin({ store: LINKED });
    await plugin.onload();
    await flush();

    expect(plugin.client).not.toBeNull();
    expect(asMockPlugin(plugin).statusBarItems).toHaveLength(1);
    const item = asMockPlugin(plugin).statusBarItems[0] as unknown as { textContent: string };
    expect(item.textContent).toBe('vsa ✗ offline');
  });

  it('warns when the vault carries another client sync state (FR-44)', async () => {
    const vault = new FakeVault();
    vault.adapter.files.set(
      '.vaultsyncforagents/device.json',
      new TextEncoder().encode(
        JSON.stringify({ deviceId: 'other-device', deviceName: 'agent-vps', url: 'https://w' }),
      ),
    );
    const { plugin } = makePlugin({ store: LINKED, vault });
    await plugin.onload();
    await flush();

    const warning = Notice.messages.find((n) => n.message.includes('agent-vps'));
    expect(warning).toBeDefined();
    expect(warning!.message).toContain('One sync client per machine per vault');
  });

  it('deep link pairs automatically: obsidian://vaultsyncforagents/pair?url=&code=', async () => {
    const fetcher = new FakeFetch().health(true).pair(200, { ok: true, token: 'tok-9', deviceId: 'dev-9' });
    const { plugin, vault } = makePlugin({ fetcher });
    await plugin.onload();

    protocolHandlers['vaultsyncforagents']!({
      action: 'pair',
      url: 'https://w.example',
      code: '7F3K-Q9M2',
    });
    // The handler is fire-and-forget; the pair flow (two fetches with real
    // Response bodies + device-marker write + startSync) resolves over ~30
    // microtask hops — flush generously and deterministically.
    await flush(64);

    expect(plugin.data).toMatchObject({ token: 'tok-9', deviceId: 'dev-9', url: 'https://w.example' });
    expect(plugin.client).not.toBeNull();
    expect(vault.adapter.files.has('.vaultsyncforagents/device.json')).toBe(true);
    expect(Notice.messages.some((n) => n.message.includes('Paired'))).toBe(true);
  });

  it('deep link is ignored for the already-linked worker; different worker requires unlink', async () => {
    const fetcher = new FakeFetch();
    const { plugin } = makePlugin({ store: LINKED, fetcher });
    await plugin.onload();

    protocolHandlers['vaultsyncforagents']!({ url: 'https://w.example', code: 'X' });
    await flush();
    expect(Notice.messages[0]!.message).toContain('already paired');

    protocolHandlers['vaultsyncforagents']!({ url: 'https://other.example', code: 'X' });
    await flush();
    expect(Notice.messages[1]!.message).toContain('different worker');
    // No pair request was attempted in either case.
    expect(fetcher.calls.filter((c) => c.url.endsWith('/pair'))).toHaveLength(0);
  });

  it('reconnects with exponential backoff (jittered, capped) after disconnects', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] });
    // Deterministic backoff: 1s, 2s, 4s, … capped at 60s.
    const vault = new FakeVault();
    const { app } = makeFakeApp(vault);
    const deterministic = new VaultSyncPlugin(app as unknown as App, {} as PluginManifest, {
      wsFactory: offlineWsFactory,
      reconnect: { random: () => 0.5 },
    });
    asMockPlugin(deterministic).store = LINKED;
    created.push(deterministic);

    await deterministic.onload();
    await vi.advanceTimersByTimeAsync(0); // settle the first (failing) dial
    expect(FakeSocket.opened.length).toBe(1);

    // 1 Hz ticks notice the disconnect and schedule one reconnect at a time.
    await vi.advanceTimersByTimeAsync(1000);
    const afterOneSecond = FakeSocket.opened.length;
    expect(afterOneSecond).toBeGreaterThanOrEqual(2);

    // Backoff grows and caps: over 120 s offline the dial count stays small.
    await vi.advanceTimersByTimeAsync(120_000);
    const total = FakeSocket.opened.length;
    expect(total).toBeGreaterThan(afterOneSecond);
    expect(total).toBeLessThan(10);
  });

  it('a rejected token stops reconnecting (fatal auth error)', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] });
    const vault = new FakeVault();
    const { app } = makeFakeApp(vault);
    // A socket that connects, then gets the token rejected by the server.
    const rejectWith = (code: 'UNAUTHORIZED' | 'REVOKED') => (url: string): FakeSocket => {
      const socket = new FakeSocket(url);
      void Promise.resolve().then(() => {
        socket.open();
        socket.receive({ type: 'error', code, message: 'nope' });
        socket.close(1008, 'unauthorized');
      });
      return socket;
    };
    const plugin = new VaultSyncPlugin(app as unknown as App, {} as PluginManifest, {
      wsFactory: rejectWith('REVOKED'),
    });
    asMockPlugin(plugin).store = LINKED;
    created.push(plugin);
    await plugin.onload();
    await vi.advanceTimersByTimeAsync(0);

    expect(plugin.client?.status().state).toBe('disconnected');
    expect(Notice.messages.some((n) => n.message.includes('rejected'))).toBe(true);

    await vi.advanceTimersByTimeAsync(120_000);
    // No reconnect dials happened after the auth failure.
    expect(FakeSocket.opened.length).toBe(1);
    const item = asMockPlugin(plugin).statusBarItems[0] as unknown as {
      textContent: string;
      attributes: Record<string, string>;
    };
    expect(item.textContent).toBe('vsa ✗ offline');
    expect(item.attributes['title']).toContain('re-pair');
  });

  it('active-leaf-change triggers a (debounced) rescan of the client', async () => {
    vi.useFakeTimers();
    const { plugin, workspace } = makePlugin({ store: LINKED });
    await plugin.onload();
    await vi.advanceTimersByTimeAsync(0);

    const trigger = vi.spyOn(plugin.client!, 'triggerSync').mockResolvedValue(undefined);

    workspace.emitActiveLeafChange();
    workspace.emitActiveLeafChange(); // coalesced
    await vi.advanceTimersByTimeAsync(2999);
    expect(trigger).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(trigger).toHaveBeenCalledTimes(1);
  });

  it('periodic rescan fires on the configured interval', async () => {
    vi.useFakeTimers();
    const { plugin } = makePlugin({
      store: { ...LINKED, settings: { rescanIntervalSec: 10, obsidianSync: false } },
    });
    await plugin.onload();
    await vi.advanceTimersByTimeAsync(0);

    const trigger = vi.spyOn(plugin.client!, 'triggerSync').mockResolvedValue(undefined);
    await vi.advanceTimersByTimeAsync(9999);
    expect(trigger).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(trigger).toHaveBeenCalledTimes(1);
  });

  it('vault events reach the sync client (pending counter, engine debounce)', async () => {
    vi.useFakeTimers();
    const { plugin, vault } = makePlugin({ store: LINKED });
    await plugin.onload();
    await vi.advanceTimersByTimeAsync(0);
    expect(plugin.client!.status().state).toBe('disconnected');

    vault.emit('modify', { path: 'note.md' });
    expect(plugin.client!.status().pending).toBe(1);

    // The engine's 300 ms debounce fires the (offline → no-op) cycle.
    await vi.advanceTimersByTimeAsync(400);
    expect(plugin.client!.status().pending).toBe(1); // cycles never reset while offline
  });

  it('onunload tears everything down: no timers, no sockets, no status bar', async () => {
    vi.useFakeTimers();
    const { plugin } = makePlugin({ store: LINKED });
    await plugin.onload();
    await vi.advanceTimersByTimeAsync(0);
    const item = asMockPlugin(plugin).statusBarItems[0] as unknown as { removed: boolean };

    plugin.onunload();

    expect(plugin.client).toBeNull();
    expect(item.removed).toBe(true);
    const dialsAtUnload = FakeSocket.opened.length;
    await vi.advanceTimersByTimeAsync(300_000);
    expect(FakeSocket.opened.length).toBe(dialsAtUnload); // no reconnect attempts
  });

  it('unload is safe when never linked', async () => {
    const { plugin } = makePlugin({});
    await plugin.onload();
    expect(() => plugin.onunload()).not.toThrow();
  });
});

describe('fetch seam — detached invocation (real-Obsidian illegal-invocation regression)', () => {
  beforeEach(() => {
    resetObsidianMock();
    FakeSocket.opened = [];
  });
  afterEach(() => {
    for (const plugin of created.splice(0)) plugin.onunload();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  /**
   * Chromium's `window.fetch` is receiver-sensitive: called with `this !==
   * window` it throws `TypeError: Failed to execute 'fetch' on 'Window':
   * Illegal invocation` — the failure the real-Obsidian E2E hit, because the
   * plugin's default fetchImpl was the bare global handed to callers that
   * invoke it detached (`fetchImpl(url)`). The mock reproduces the binding
   * rule so the regression cannot come back unnoticed.
   */
  function strictGlobalFetch(this: unknown, input: RequestInfo | URL): Promise<Response> {
    if (this !== globalThis) {
      return Promise.reject(
        new TypeError("Failed to execute 'fetch' on 'Window': Illegal invocation"),
      );
    }
    const path = String(input).replace(/^https?:\/\/[^/]+/, '');
    if (path === '/health') return Promise.resolve(jsonResult(200, { ok: true, claimed: true }));
    if (path === '/pair') {
      return Promise.resolve(jsonResult(200, { ok: true, token: 'tok-x', deviceId: 'dev-x' }));
    }
    return Promise.resolve(new Response('not found', { status: 404 }));
  }

  it('the default fetchImpl is bound to the global: pairing succeeds without a fetch override', async () => {
    vi.stubGlobal('fetch', strictGlobalFetch);

    const vault = new FakeVault();
    const { app } = makeFakeApp(vault);
    // NOTE: no `fetchImpl` override — the plugin must fall back to a BOUND
    // global fetch. With the old bare-`fetch` default, workerapi's detached
    // call rejects with the TypeError above and pairing reports unreachable.
    const plugin = new VaultSyncPlugin(app as unknown as App, {} as PluginManifest, {
      wsFactory: offlineWsFactory,
    });
    asMockPlugin(plugin).store = { url: 'https://w.example' };
    created.push(plugin);
    await plugin.onload();

    const outcome = await plugin.pairFromSettings('ABCD-EFGH');
    expect(outcome).toMatchObject({ status: 'paired', token: 'tok-x', deviceId: 'dev-x' });
  });

  it('an explicitly injected fetchImpl still wins over the bound default', async () => {
    const fetcher = new FakeFetch().health(true).pair(200, { ok: true, token: 'tok-y', deviceId: 'dev-y' });
    const vault = new FakeVault();
    const { app } = makeFakeApp(vault);
    const plugin = new VaultSyncPlugin(app as unknown as App, {} as PluginManifest, {
      fetchImpl: fetcher.fetchImpl,
      wsFactory: offlineWsFactory,
    });
    asMockPlugin(plugin).store = { url: 'https://w.example' };
    created.push(plugin);
    await plugin.onload();

    const outcome = await plugin.pairFromSettings('ABCD-EFGH');
    expect(outcome).toMatchObject({ status: 'paired', token: 'tok-y' });
  });
});
