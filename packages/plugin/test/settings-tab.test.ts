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
});
