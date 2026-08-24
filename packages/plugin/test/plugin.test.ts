import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { App, PluginManifest } from 'obsidian';
import { VaultSyncPlugin } from '../src/plugin.js';
import {
  asMockPlugin,
  Modal,
  Notice,
  protocolHandlers,
  resetObsidianMock,
  Setting,
  type ButtonRecord,
  type SettingRecord,
} from './helpers/obsidian-mock.js';
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

/** The deep-link confirmation modal's Setting record (title match). */
function findModalSetting(name: string): SettingRecord {
  const record = Setting.instances.find((r) => r.name === name);
  if (record === undefined) throw new Error(`modal setting not rendered: ${name}`);
  return record;
}

/** A button rendered inside the deep-link confirmation modal. */
function findModalButton(text: string): ButtonRecord {
  for (const record of [...Setting.instances].reverse()) {
    const button = record.buttons.find((b) => b.text === text);
    if (button !== undefined) return button;
  }
  throw new Error(`modal button not rendered: ${text}`);
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

  it('deep link on an unlinked vault asks first: modal names the link\u2019s worker, Pair completes pairing', async () => {
    const fetcher = new FakeFetch().health(true).pair(200, { ok: true, token: 'tok-9', deviceId: 'dev-9' });
    const { plugin, vault } = makePlugin({ fetcher });
    await plugin.onload();

    protocolHandlers['vaultsyncforagents']!({
      action: 'pair',
      url: 'https://w.example',
      code: '7F3K-Q9M2',
    });
    await flush(4);

    // The confirmation is the gate: it shows the exact URL the link carried,
    // and nothing has been sent anywhere yet.
    expect(findModalSetting('Pair VaultSync?').desc).toContain('https://w.example');
    expect(fetcher.calls).toHaveLength(0);
    expect(plugin.data.token).toBe('');

    await findModalButton('Pair').onClick();
    // The pair flow (two fetches with real Response bodies + device-marker
    // write + startSync) resolves over ~30 microtask hops — flush generously
    // and deterministically.
    await flush(64);

    expect(plugin.data).toMatchObject({ token: 'tok-9', deviceId: 'dev-9', url: 'https://w.example' });
    expect(plugin.client).not.toBeNull();
    expect(vault.adapter.files.has('.vaultsyncforagents/device.json')).toBe(true);
    expect(Notice.messages.some((n) => n.message.includes('Paired'))).toBe(true);
  });

  it('deep link declined (Cancel): no pair request, no state change, no Notice', async () => {
    const fetcher = new FakeFetch().health(true).pair(200, { ok: true, token: 'tok-9', deviceId: 'dev-9' });
    const { plugin, vault } = makePlugin({ fetcher });
    await plugin.onload();
    const before = JSON.stringify(plugin.data);

    protocolHandlers['vaultsyncforagents']!({ url: 'https://attacker.example', code: 'STOLEN-1' });
    await flush(4);
    await findModalButton('Cancel').onClick();
    await flush(64);

    expect(fetcher.calls).toHaveLength(0);
    expect(JSON.stringify(plugin.data)).toBe(before);
    expect(plugin.client).toBeNull();
    expect(vault.adapter.files.has('.vaultsyncforagents/device.json')).toBe(false);
    expect(Notice.messages).toHaveLength(0);
  });

  it('deep link modal dismissed without a choice (Escape): nothing happens', async () => {
    const fetcher = new FakeFetch().health(true).pair(200, { ok: true, token: 'tok-9', deviceId: 'dev-9' });
    const { plugin } = makePlugin({ fetcher });
    await plugin.onload();

    protocolHandlers['vaultsyncforagents/pair']!({ url: 'https://w.example', code: '7F3K-Q9M2' });
    await flush(4);
    expect(Modal.opened.length).toBe(1);

    Modal.opened.at(-1)!.close(); // Escape / backdrop dismiss — no button chosen
    await flush(64);

    expect(fetcher.calls).toHaveLength(0);
    expect(plugin.data.token).toBe('');
    expect(plugin.client).toBeNull();
    expect(Notice.messages).toHaveLength(0);
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

describe('VaultSyncPlugin — "Sync on startup" OFF (manual-only mode)', () => {
  beforeEach(() => {
    resetObsidianMock();
    FakeSocket.opened = [];
  });
  afterEach(() => {
    for (const plugin of created.splice(0)) plugin.onunload();
    vi.useRealTimers();
  });

  it('loads idle: no client, no dial, no status bar; toggling persists OFF', async () => {
    vi.useFakeTimers();
    const { plugin } = makePlugin({
      store: {
        ...LINKED,
        settings: { rescanIntervalSec: 0, obsidianSync: false, syncOnStartup: false },
      },
    });
    await plugin.onload();
    await vi.advanceTimersByTimeAsync(5_000);

    expect(plugin.client).toBeNull(); // never connected
    expect(FakeSocket.opened).toHaveLength(0); // not even one dial
    expect(asMockPlugin(plugin).statusBarItems).toHaveLength(0);
    expect(plugin.data.settings.syncOnStartup).toBe(false); // normalized, persisted

    // Manual start: "Sync now" brings the machinery up (offline worker → the
    // dial happens and the client settles disconnected, not absent).
    await plugin.syncNow();
    await vi.advanceTimersByTimeAsync(0);
    expect(plugin.client).not.toBeNull();
    expect(FakeSocket.opened.length).toBeGreaterThanOrEqual(1);
    expect(
      Notice.messages.some(
        (n) => n.message.includes('offline') || n.message.includes('up to date'),
      ),
    ).toBe(true);
  });

  it('defaults ON: a linked plugin connects on load (the contrast case)', async () => {
    const { plugin } = makePlugin({
      store: { ...LINKED, settings: { rescanIntervalSec: 0, obsidianSync: false } },
    });
    await plugin.onload();
    await flush();
    expect(plugin.data.settings.syncOnStartup).toBe(true);
    expect(plugin.client).not.toBeNull();
    expect(FakeSocket.opened.length).toBeGreaterThanOrEqual(1);
  });
});

describe('VaultSyncPlugin — pause / resume syncing', () => {
  beforeEach(() => {
    resetObsidianMock();
    FakeSocket.opened = [];
  });
  afterEach(() => {
    for (const plugin of created.splice(0)) plugin.onunload();
    vi.useRealTimers();
  });

  function statusBarText(plugin: VaultSyncPlugin): string {
    const items = asMockPlugin(plugin).statusBarItems;
    const live = items.filter((item) => !(item as { removed?: boolean }).removed);
    return (live[live.length - 1] as unknown as { textContent: string }).textContent;
  }

  it('pause closes the transport, stops reconnects, shows "vsa ⏸"; syncNow refuses', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] });
    const { plugin } = makePlugin({ store: LINKED });
    await plugin.onload();
    await vi.advanceTimersByTimeAsync(0);
    expect(plugin.client!.status().state).toBe('disconnected');
    await vi.advanceTimersByTimeAsync(1_000); // a reconnect may already be scheduled
    const dialsAtPause = FakeSocket.opened.length;

    plugin.pauseSyncing();

    expect(plugin.syncingPaused).toBe(true);
    // Link and client survive (closed to idle, NOT unlinked).
    expect(plugin.client).not.toBeNull();
    expect(plugin.client!.status().state).toBe('idle');
    expect(plugin.linked).toBe(true);
    // The indicator repaints with the pause glyph.
    expect(statusBarText(plugin)).toBe('vsa ⏸');
    expect(Notice.messages.some((n) => n.message.includes('paused'))).toBe(true);

    // No reconnect dials while paused — even minutes later.
    await vi.advanceTimersByTimeAsync(300_000);
    expect(FakeSocket.opened.length).toBe(dialsAtPause);

    // "Sync now" refuses instead of syncing.
    await plugin.syncNow();
    expect(Notice.messages.some((n) => n.message.includes('resume'))).toBe(true);
    expect(FakeSocket.opened.length).toBe(dialsAtPause);

    // Pause is idempotent.
    expect(() => plugin.pauseSyncing()).not.toThrow();
    expect(FakeSocket.opened.length).toBe(dialsAtPause);
  });

  it('resume clears the pause, reconnects, and re-enters the normal loop', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] });
    const { plugin } = makePlugin({ store: LINKED });
    await plugin.onload();
    await vi.advanceTimersByTimeAsync(0);

    plugin.pauseSyncing();
    await vi.advanceTimersByTimeAsync(60_000);
    const dialsWhilePaused = FakeSocket.opened.length;

    await plugin.resumeSyncing();
    await vi.advanceTimersByTimeAsync(0);

    expect(plugin.syncingPaused).toBe(false);
    expect(plugin.client).not.toBeNull();
    // The catch-up cycle dialed the worker again (offline factory: it fails,
    // but the DIAL is the proof of reconnection).
    expect(FakeSocket.opened.length).toBeGreaterThan(dialsWhilePaused);
    expect(Notice.messages.some((n) => n.message.includes('resuming'))).toBe(true);

    // And reconnect backoff resumes with the resumed client.
    await vi.advanceTimersByTimeAsync(2_000);
    expect(FakeSocket.opened.length).toBeGreaterThan(dialsWhilePaused + 1);
  });
});

describe('VaultSyncPlugin — status-bar indicator modes', () => {
  beforeEach(() => {
    resetObsidianMock();
    FakeSocket.opened = [];
  });
  afterEach(() => {
    for (const plugin of created.splice(0)) plugin.onunload();
    vi.useRealTimers();
  });

  it('applyStatusBarMode("hidden") removes the item; "compact" mounts a compact one', async () => {
    vi.useFakeTimers();
    const { plugin } = makePlugin({ store: LINKED });
    await plugin.onload();
    await vi.advanceTimersByTimeAsync(0);
    const items = asMockPlugin(plugin).statusBarItems;
    expect(items).toHaveLength(1);
    expect((items[0] as unknown as { removed: boolean }).removed).toBe(false);

    await plugin.applyStatusBarMode('hidden');
    expect(plugin.data.settings.statusBarMode).toBe('hidden');
    expect(asMockPlugin(plugin).store).toMatchObject({ settings: { statusBarMode: 'hidden' } });
    expect((items[0] as unknown as { removed: boolean }).removed).toBe(true);
    expect(items).toHaveLength(1); // nothing new was mounted

    await plugin.applyStatusBarMode('compact');
    expect(items).toHaveLength(2); // a fresh item replaced the removed one
    const compact = items[1] as unknown as { removed: boolean; textContent: string };
    expect(compact.removed).toBe(false);
    expect(compact.textContent).toBe('vsa ✗'); // compact offline line (no "offline")
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

describe('VaultSyncPlugin — commands + support bundle export', () => {
  beforeEach(() => {
    resetObsidianMock();
    FakeSocket.opened = [];
  });
  afterEach(() => {
    for (const plugin of created.splice(0)) plugin.onunload();
    vi.useRealTimers();
  });

  it('onload registers the three palette commands', async () => {
    const { plugin } = makePlugin({});
    await plugin.onload();

    const commands = asMockPlugin(plugin).commands;
    expect(commands.map((c) => `${c.id}:${c.name}`)).toEqual([
      'copy-diagnostics:Copy diagnostics',
      'save-support-bundle:Save support bundle',
      'allow-mass-deletion:Allow blocked mass deletion (one sync cycle)',
    ]);
    // Both callbacks are wired to the plugin's actions.
    expect(commands[0]!.callback).toBeInstanceOf(Function);
    expect(commands[1]!.callback).toBeInstanceOf(Function);
  });

  it('saveSupportBundle writes a redacted markdown file into .vaultsyncforagents/ and notices the path', async () => {
    const { plugin, vault } = makePlugin({ store: LINKED });
    await plugin.onload();
    await flush();

    await plugin.saveSupportBundle();

    const written = [...vault.adapter.files.keys()].filter((p) =>
      /^\.vaultsyncforagents\/support-bundle-\d{8}-\d{6}\.md$/.test(p),
    );
    expect(written).toHaveLength(1);
    const markdown = new TextDecoder().decode(vault.adapter.files.get(written[0]!)!);
    expect(markdown).toContain('# VaultSync for Agents — support bundle');
    expect(markdown).toContain('## Settings');
    expect(markdown).toContain('- Worker URL: https://w.example');
    // Redaction: the device token (tok-1, in plugin.data) never appears.
    expect(markdown.includes('tok-1')).toBe(false);
    const notice = Notice.messages.find((n) => n.message.includes('support bundle saved'));
    expect(notice).toBeDefined();
    expect(notice!.message).toContain(written[0]!); // the relative vault path
  });

  it('saveSupportBundle works pre-sync too (state dir absent) and still writes the file', async () => {
    // Unlinked, syncOnStartup irrelevant — the state dir does not exist yet;
    // the write must mkdir it on demand.
    const { plugin, vault } = makePlugin({});
    await plugin.onload();
    expect(vault.adapter.folders.has('.vaultsyncforagents')).toBe(false);

    await plugin.saveSupportBundle();

    expect(vault.adapter.folders.has('.vaultsyncforagents')).toBe(true);
    expect(
      [...vault.adapter.files.keys()].some((p) => p.startsWith('.vaultsyncforagents/support-bundle-')),
    ).toBe(true);
    expect(Notice.messages.some((n) => n.message.includes('support bundle saved'))).toBe(true);
  });
});
