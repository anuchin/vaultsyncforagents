import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { App, PluginManifest } from 'obsidian';
import { VaultSyncPlugin } from '../src/plugin.js';
import { DEPLOY_URL, VaultSyncSettingTab } from '../src/settings.js';
import { asMockPlugin, Notice, Platform, resetObsidianMock, Setting, type SettingRecord } from './helpers/obsidian-mock.js';
import { makeFakeApp, FakeVault } from './helpers/fake-vault.js';
import { FakeFetch, offlineWsFactory } from './helpers/network-fakes.js';

function findSetting(name: string): SettingRecord {
  const record = Setting.instances.find((r) => r.name === name);
  if (record === undefined) throw new Error(`setting not rendered: ${name}`);
  return record;
}

/** The most recent render's record (re-renders append new records). */
function findLastSetting(name: string): SettingRecord {
  const record = [...Setting.instances].reverse().find((r) => r.name === name);
  if (record === undefined) throw new Error(`setting not rendered: ${name}`);
  return record;
}

function findButton(text: string): { click: () => Promise<void> } {
  for (const record of [...Setting.instances].reverse()) {
    const button = record.buttons.find((b) => b.text === text);
    if (button !== undefined) return { click: async () => void (await button.onClick()) };
  }
  throw new Error(`button not rendered: ${text}`);
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe('VaultSyncSettingTab', () => {
  let vault: FakeVault;
  let plugin: VaultSyncPlugin;
  let tab: VaultSyncSettingTab;
  let fetcher: FakeFetch;

  beforeEach(async () => {
    resetObsidianMock();
    vault = new FakeVault();
    const { app } = makeFakeApp(vault);
    fetcher = new FakeFetch();
    plugin = new VaultSyncPlugin(app as unknown as App, {} as PluginManifest, {
      fetchImpl: fetcher.fetchImpl,
      wsFactory: offlineWsFactory,
    });
    await plugin.onload();
    tab = asMockPlugin(plugin).settingTabs[0] as unknown as VaultSyncSettingTab;
  });

  afterEach(() => {
    tab?.hide();
    plugin.onunload();
  });

  it('renders the pairing form when unlinked', () => {
    tab.display();
    expect(findSetting('Worker URL').name).toBe('Worker URL');
    expect(findSetting('Device name').name).toBe('Device name');
    expect(findSetting('Pairing code').name).toBe('Pairing code');
    expect(findSetting('Getting started').desc).toContain('Deploy');
    // No linked-only controls.
    expect(Setting.instances.some((r) => r.name === 'Status')).toBe(false);
  });

  it('typing the worker URL and device name persists into plugin data', async () => {
    tab.display();
    findSetting('Worker URL').text!.onChange('personal.x.workers.dev');
    findSetting('Device name').text!.onChange('MacBook');
    await flush();

    expect(plugin.data.url).toBe('personal.x.workers.dev');
    expect(plugin.data.deviceName).toBe('MacBook');
    expect(asMockPlugin(plugin).store).toMatchObject({
      url: 'personal.x.workers.dev',
      deviceName: 'MacBook',
    });
  });

  it('Pair: unclaimed worker → guidance Notice and hint update, nothing stored', async () => {
    fetcher.health(false);
    tab.display();
    findSetting('Worker URL').text!.onChange('https://w.example');
    findSetting('Pairing code').text!.onChange('7F3K-Q9M2');
    await flush();

    await findButton('Pair this vault').click();

    expect(plugin.data.token).toBe('');
    const notice = Notice.messages[0]!;
    expect(notice.message).toContain('not claimed yet');
    expect(notice.message).toContain('Open https://w.example');
    expect(findSetting('Getting started').desc).toContain('admin passphrase');
  });

  it('Pair: claimed worker → token stored, sync started, tab re-renders with status', async () => {
    fetcher.health(true).pair(200, { ok: true, token: 'tok-1', deviceId: 'dev-1' });
    tab.display();
    findSetting('Worker URL').text!.onChange('https://w.example');
    findSetting('Device name').text!.onChange('MacBook');
    findSetting('Pairing code').text!.onChange('7F3K-Q9M2');
    await flush();

    await findButton('Pair this vault').click();

    expect(plugin.data).toMatchObject({
      url: 'https://w.example',
      token: 'tok-1',
      deviceId: 'dev-1',
      deviceName: 'MacBook',
    });
    expect(asMockPlugin(plugin).store).toMatchObject({ token: 'tok-1' });
    expect(plugin.client).not.toBeNull();
    // Re-rendered into the linked view: status readout + controls present.
    expect(findSetting('Status').desc).toContain('State:');
    expect(findButton('Sync now')).toBeDefined();
    expect(findButton('Unlink this vault')).toBeDefined();
    // The FR-44 device marker landed in the vault.
    expect(vault.adapter.files.has('.vaultsyncforagents/device.json')).toBe(true);
  });

  it('Pair: rejected code → clear error Notice', async () => {
    fetcher.health(true).pair(401, { error: 'pairing code is invalid' });
    tab.display();
    findSetting('Worker URL').text!.onChange('https://w.example');
    findSetting('Pairing code').text!.onChange('BAD');
    await flush();

    await findButton('Pair this vault').click();

    expect(Notice.messages[0]!.message).toContain('one-time');
    expect(plugin.data.token).toBe('');
  });

  it('sends the platform-derived device type (mobile toggle)', async () => {
    Platform.isMobileApp = true;
    Platform.isDesktopApp = false;
    fetcher.health(true).pair(200, { ok: true, token: 't', deviceId: 'd' });
    tab.display();
    findSetting('Worker URL').text!.onChange('https://w.example');
    findSetting('Pairing code').text!.onChange('X');
    await flush();

    await findButton('Pair this vault').click();

    const pairCall = fetcher.calls.find((c) => c.url.endsWith('/pair'))!;
    expect(JSON.parse(String(pairCall.init?.body))).toMatchObject({ deviceType: 'mobile' });
  });

  it('rescan dropdown persists the interval choice', async () => {
    Object.assign(plugin.data, { url: 'https://w', token: 't', deviceId: 'd' });
    await plugin.savePluginData();
    plugin.data.settings.rescanIntervalSec = 30;
    tab.display();

    findSetting('Rescan interval').dropdown!.onChange('60');
    await flush();

    expect(plugin.data.settings.rescanIntervalSec).toBe(60);
    expect(asMockPlugin(plugin).store).toMatchObject({ settings: { rescanIntervalSec: 60 } });
  });

  it('obsidianSync toggle persists and maps to the core ignore setting', async () => {
    Object.assign(plugin.data, { url: 'https://w', token: 't', deviceId: 'd' });
    plugin.data.settings.obsidianSync = false;
    tab.display();

    findSetting('Sync .obsidian/ folder').toggle!.onChange(true);
    await flush();

    expect(plugin.data.settings.obsidianSync).toBe(true);
    expect(asMockPlugin(plugin).store).toMatchObject({ settings: { obsidianSync: true } });
    expect(Notice.messages[0]!.message).toContain('.obsidian/');
  });

  it('Unlink asks for confirmation, then clears link + local state', async () => {
    Object.assign(plugin.data, { url: 'https://w', token: 't', deviceId: 'd' });
    vault.adapter.files.set('.vaultsyncforagents/device.json', new TextEncoder().encode('{}'));
    vault.adapter.files.set('.vaultsyncforagents/state', new TextEncoder().encode('{}'));
    tab.display();

    await findButton('Unlink this vault').click();
    // Confirmation modal rendered its own buttons; nothing cleared yet.
    expect(plugin.data.token).toBe('t');
    await findButton('Unlink').click();

    expect(plugin.data.token).toBe('');
    expect(plugin.data.url).toBe('');
    expect(plugin.client).toBeNull();
    expect(vault.adapter.files.has('.vaultsyncforagents/device.json')).toBe(false);
    expect(vault.adapter.files.has('.vaultsyncforagents/state')).toBe(false);
    // Tab re-rendered into the unlinked (pairing) view.
    expect(findSetting('Pairing code').name).toBe('Pairing code');
  });

  it('Sync now surfaces the offline state as a Notice', async () => {
    asMockPlugin(plugin).store = { url: 'https://w', token: 't', deviceId: 'd' };
    const linkedPlugin = plugin;
    await linkedPlugin.onload();
    const linkedTab = asMockPlugin(linkedPlugin).settingTabs[0] as unknown as VaultSyncSettingTab;
    linkedTab.display();

    await findButton('Sync now').click();
    expect(
      Notice.messages.some((n) => n.message.includes('offline') || n.message.includes('up to date')),
    ).toBe(true);
    linkedTab.hide();
  });

  it('FR-21: Getting started offers the one-click Cloudflare deploy button', async () => {
    const open = vi.fn();
    vi.stubGlobal('window', { open });
    try {
      tab.display();
      expect(findSetting('Getting started').desc).toContain('Deploy');
      await findButton('Deploy your worker').click();
      expect(open).toHaveBeenCalledWith(DEPLOY_URL, '_blank');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('registers a refresh interval while open; hide() stops it cleanly', async () => {
    vi.useFakeTimers();
    try {
      tab.display();
      expect(asMockPlugin(plugin).registeredIntervals.length).toBeGreaterThan(0);
      await vi.advanceTimersByTimeAsync(2100); // refresh ticks happen without error
      // Unlinked: the status readout stays hidden.
      expect(Setting.instances.some((r) => r.name === 'Status')).toBe(false);
      tab.hide();
    } finally {
      vi.useRealTimers();
    }
  });

  // --- linked-mode helpers -------------------------------------------------------

  /** Mark the (offline) plugin linked and re-render the tab. */
  async function linkAndDisplay(overrides: Record<string, unknown> = {}): Promise<void> {
    Object.assign(plugin.data, { url: 'https://w.example', token: 'tok-1', deviceId: 'dev-1', deviceName: 'Desk', ...overrides });
    await plugin.savePluginData();
    tab.display();
  }

  // --- the new settings (status bar, startup, ignores, log level) ------------------

  it('status bar dropdown offers Detailed/Compact/Hidden and persists the choice', async () => {
    await linkAndDisplay();
    const dropdown = findSetting('Status bar indicator').dropdown!;
    expect(dropdown.options).toEqual({ detailed: 'Detailed', compact: 'Compact', hidden: 'Hidden' });
    expect(dropdown.value).toBe('detailed'); // the default

    dropdown.onChange('compact');
    await flush();
    expect(plugin.data.settings.statusBarMode).toBe('compact');
    expect(asMockPlugin(plugin).store).toMatchObject({ settings: { statusBarMode: 'compact' } });

    dropdown.onChange('hidden');
    await flush();
    expect(asMockPlugin(plugin).store).toMatchObject({ settings: { statusBarMode: 'hidden' } });
  });

  it('sync-on-startup toggle defaults ON and persists OFF', async () => {
    await linkAndDisplay();
    const toggle = findSetting('Sync on startup').toggle!;
    expect(toggle.value).toBe(true); // the documented default

    toggle.onChange(false);
    await flush();
    expect(plugin.data.settings.syncOnStartup).toBe(false);
    expect(asMockPlugin(plugin).store).toMatchObject({ settings: { syncOnStartup: false } });
    expect(Notice.messages.some((n) => n.message.includes('idle until you press'))).toBe(true);
  });

  it('ignore patterns textarea persists the raw multi-line text', async () => {
    await linkAndDisplay();
    const area = findSetting('Ignore patterns').textarea!;
    expect(area).not.toBeNull();
    // The description documents the glob-lite syntax.
    expect(findSetting('Ignore patterns').desc).toContain('**');

    area.onChange('private/**\n*.tmp\n');
    await flush();
    expect(plugin.data.settings.ignorePatterns).toBe('private/**\n*.tmp\n');
    expect(asMockPlugin(plugin).store).toMatchObject({
      settings: { ignorePatterns: 'private/**\n*.tmp\n' },
    });
  });

  it('diagnostics log-level dropdown offers info/debug/warn and persists', async () => {
    await linkAndDisplay();
    const dropdown = findSetting('Diagnostics log level').dropdown!;
    expect(dropdown.options).toEqual({ info: 'info', debug: 'debug', warn: 'warn' });
    expect(dropdown.value).toBe('info'); // the default

    dropdown.onChange('debug');
    await flush();
    expect(plugin.data.settings.logLevel).toBe('debug');
    expect(asMockPlugin(plugin).store).toMatchObject({ settings: { logLevel: 'debug' } });
  });

  it('Copy diagnostics reports where the bundle went (no clipboard → console)', async () => {
    vi.stubGlobal('navigator', {}); // clipboard unavailable
    try {
      await linkAndDisplay();
      await findButton('Copy diagnostics').click();
      expect(Notice.messages.some((n) => n.message.includes('clipboard unavailable'))).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  // --- pause / resume buttons ------------------------------------------------------

  it('Pause syncing flips the button and status readout; Resume restores', async () => {
    await linkAndDisplay();
    expect(findButton('Pause syncing')).toBeDefined();
    expect(findSetting('Status').desc).not.toContain('State: paused');

    await findButton('Pause syncing').click();

    expect(plugin.syncingPaused).toBe(true);
    expect(plugin.linked).toBe(true); // pause never unlinks
    // Re-rendered: the button flipped and the readout says paused.
    expect(findButton('Resume syncing')).toBeDefined();
    expect(findLastSetting('Status').desc).toContain('State: paused');
    expect(findLastSetting('Syncing paused').name).toBe('Syncing paused'); // label flips too

    await findButton('Resume syncing').click();
    expect(plugin.syncingPaused).toBe(false);
    expect(findButton('Pause syncing')).toBeDefined();
  });

  // --- linked device rename (PATCH /device behind the button) ----------------------

  it('Rename device: button PATCHes, updates data + marker, and re-renders', async () => {
    fetcher.on('PATCH', '/device', (call) => {
      const body = JSON.parse(String(call.init?.body)) as { name?: unknown };
      return new Response(
        JSON.stringify({ ok: true, device: { id: 'dev-1', name: body.name ?? '?', type: 'desktop' } }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    });
    await linkAndDisplay();

    findSetting('Device name').text!.onChange('Renamed Desk');
    await findButton('Rename device').click();

    const call = fetcher.calls.find((c) => c.url === 'https://w.example/device')!;
    expect(call.init?.method).toBe('PATCH');
    expect(JSON.parse(String(call.init?.body))).toEqual({ name: 'Renamed Desk' });
    expect(plugin.data.deviceName).toBe('Renamed Desk');
    expect(vault.adapter.files.has('.vaultsyncforagents/device.json')).toBe(true);
    expect(
      JSON.parse(
        new TextDecoder().decode(vault.adapter.files.get('.vaultsyncforagents/device.json')),
      ),
    ).toMatchObject({ deviceName: 'Renamed Desk' });
    // Re-rendered with the persisted name in the field.
    expect(findLastSetting('Device name').text!.value).toBe('Renamed Desk');
  });

  // --- the About section --------------------------------------------------------------

  it('About: versions + platform line, README link opens the project home', async () => {
    const open = vi.fn();
    vi.stubGlobal('window', { open });
    try {
      await linkAndDisplay();
      const versions = findSetting('Versions');
      expect(versions.desc).toContain('Plugin unknown'); // manifest {} in tests
      expect(versions.desc).toContain(`protocol v1`); // core ProtocolVersion
      expect(versions.desc).toContain('desktop');

      await findButton('Open README').click();
      expect(open).toHaveBeenCalledWith(
        'https://github.com/anuchin/vaultsyncforagents#readme',
        '_blank',
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('About: storage line loads from /api/status with the device token', async () => {
    fetcher.json('GET', '/api/status', 200, {
      vaultName: 'personal',
      devices: [{ id: 'dev-1', name: 'Desk', type: 'desktop', online: true, revoked: false }],
      attachments: { count: 3, bytes: 1024 },
      storageBytes: 2048,
    });
    await linkAndDisplay();
    expect(findSetting('Vault storage').desc).toContain('Checking the worker');
    // The fill is fire-and-forget async (fetch + response.json) — poll for it.
    await vi.waitFor(
      () => expect(findSetting('Vault storage').desc).toContain('Storage used: 2.0 KB'),
      { timeout: 2000 },
    );

    expect(findSetting('Vault storage').desc).toContain('3 attachments');
    const call = fetcher.calls.find((c) => c.url === 'https://w.example/api/status')!;
    expect(((call.init?.headers ?? {}) as Record<string, string>)['authorization']).toBe(
      'Bearer tok-1',
    );
  });

  it('About: storage shows the unavailable fallback when the worker is down', async () => {
    await linkAndDisplay();
    // Unrouted fetch → null summary → the unavailable line.
    await vi.waitFor(
      () => expect(findSetting('Vault storage').desc).toContain('unavailable'),
      { timeout: 2000 },
    );
  });

  it('About (unlinked): storage prompts to pair instead of fetching', async () => {
    tab.display();
    expect(findSetting('Vault storage').desc).toContain('Pair this vault');
    expect(fetcher.calls).toHaveLength(0);
  });

  // --- persistence across reload -----------------------------------------------------

  it('every setting survives a plugin reload (data.json round-trip)', async () => {
    // Exercise the real controls so the persisted shape is what the UI writes.
    tab.display();
    findSetting('Worker URL').text!.onChange('https://w.example');
    findSetting('Device name').text!.onChange('MacBook');
    await flush();

    await linkAndDisplay({ deviceName: 'MacBook' }); // keep the typed name
    findSetting('Rescan interval').dropdown!.onChange('60');
    findSetting('Sync .obsidian/ folder').toggle!.onChange(true);
    findSetting('Sync on startup').toggle!.onChange(false);
    findSetting('Status bar indicator').dropdown!.onChange('compact');
    findSetting('Ignore patterns').textarea!.onChange('private/**\n*.tmp');
    findSetting('Diagnostics log level').dropdown!.onChange('debug');
    await flush();

    // A "reload": a fresh plugin instance loading the same data.json.
    const { app: app2 } = makeFakeApp(new FakeVault());
    const reloaded = new VaultSyncPlugin(app2 as unknown as App, {} as PluginManifest, {
      fetchImpl: fetcher.fetchImpl,
      wsFactory: offlineWsFactory,
    });
    asMockPlugin(reloaded).store = asMockPlugin(plugin).store;
    await reloaded.onload();

    expect(reloaded.data).toMatchObject({
      url: 'https://w.example',
      deviceName: 'MacBook',
      settings: {
        rescanIntervalSec: 60,
        obsidianSync: true,
        syncOnStartup: false,
        statusBarMode: 'compact',
        ignorePatterns: 'private/**\n*.tmp',
        logLevel: 'debug',
      },
    });
    reloaded.onunload();
  });
});
