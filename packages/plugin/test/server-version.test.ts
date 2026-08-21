/**
 * Server version reporting + compatibility verdict (core `compat.ts`
 * consumed by the plugin): the supervision tick assesses the helloAck
 * version, surfaces one Notice per session and a tooltip note, clears the
 * note when the server reads ok again, feeds the diagnostics input, renders
 * the About row, and `fetchWorkerStatus` parses the /api/status field.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { App, PluginManifest } from 'obsidian';
import type { SyncClient, SyncClientStatus } from '@vsa/core';
import { VaultSyncPlugin } from '../src/plugin.js';
import { fetchWorkerStatus } from '../src/workerapi.js';
import type { DiagnosticsInput } from '../src/diagnostics.js';
import { VaultSyncSettingTab } from '../src/settings.js';
import { asMockPlugin, Notice, resetObsidianMock, Setting, type SettingRecord } from './helpers/obsidian-mock.js';
import { makeFakeApp, FakeVault } from './helpers/fake-vault.js';
import { FakeFetch, offlineWsFactory } from './helpers/network-fakes.js';

const LINKED = { url: 'https://w.example', token: 'tok-1', deviceId: 'dev-1', deviceName: 'Desk' };

/** A stubbed SyncClient whose status() is redirected per test phase. */
const liveStatus = (serverVersion: string | null): SyncClientStatus => ({
  state: 'live',
  lastSyncAt: 1,
  pending: 0,
  conflicts: [],
  serverVersion,
});

interface Rig {
  plugin: VaultSyncPlugin;
  setServerVersion(serverVersion: string | null): void;
}

/** Every plugin created below, unloaded after each test. */
const created: VaultSyncPlugin[] = [];

/**
 * A linked plugin under fake timers: onload starts sync (offline transport —
 * the client is immediately replaced by a stub whose helloAck version the
 * test controls), then each `advance(1000)` fires one supervision tick.
 */
async function makeRig(serverVersion: string | null): Promise<Rig> {
  vi.useFakeTimers();
  const { app } = makeFakeApp(new FakeVault());
  const plugin = new VaultSyncPlugin(app as unknown as App, { version: '1.5.0' } as PluginManifest, {
    fetchImpl: new FakeFetch().fetchImpl,
    wsFactory: offlineWsFactory,
  });
  created.push(plugin);
  asMockPlugin(plugin).store = LINKED;
  await plugin.onload();
  // The live status the stub reports; `setServerVersion` swaps it mid-test.
  // reconnect/close are the supervision loop's and onunload's only other
  // client touchpoints once sync has started.
  let current = liveStatus(serverVersion);
  plugin.client = {
    status: () => current,
    reconnect: async () => {},
    close: () => {},
  } as unknown as SyncClient;
  return {
    plugin,
    setServerVersion(next: string | null): void {
      current = liveStatus(next);
    },
  };
}

/** The mounted status-bar tooltip text (title attribute), or ''. */
function tooltipOf(plugin: VaultSyncPlugin): string {
  const item = asMockPlugin(plugin).statusBarItems[0] as unknown as {
    attributes: Record<string, string>;
  };
  return item?.attributes['title'] ?? '';
}

function findSetting(name: string): SettingRecord {
  const record = [...Setting.instances].reverse().find((r) => r.name === name);
  if (record === undefined) throw new Error(`setting not rendered: ${name}`);
  return record;
}

describe('server version compatibility (plugin)', () => {
  beforeEach(() => {
    resetObsidianMock();
  });

  afterEach(() => {
    for (const plugin of created.splice(0)) plugin.onunload();
    vi.useRealTimers();
  });

  it('a newer server warns once per session, carries the tooltip note, and never kills sync', async () => {
    const rig = await makeRig('1.6.0');
    vi.advanceTimersByTime(1000);

    expect(rig.plugin.serverCompatibility?.level).toBe('warn');
    expect(rig.plugin.serverCompatibility?.message).toContain('newer than this client (1.5.0)');
    const notices = Notice.messages.filter((n) => n.message.includes('newer than this client'));
    expect(notices).toHaveLength(1);
    expect(tooltipOf(rig.plugin)).toContain('newer than this client');

    // Further ticks — and an even newer server — must not re-Notice.
    vi.advanceTimersByTime(5000);
    rig.setServerVersion('2.0.0');
    vi.advanceTimersByTime(1000);
    expect(Notice.messages.filter((n) => n.message.includes('newer than this client'))).toHaveLength(1);
    // Sync machinery untouched: the same client keeps running.
    expect(rig.plugin.client).not.toBeNull();
    expect(rig.plugin.serverCompatibility?.message).toContain('2.0.0');
  });

  it('a server below the minimum supported is an error verdict (still without killing sync)', async () => {
    const rig = await makeRig('0.0.9');
    vi.advanceTimersByTime(1000);

    expect(rig.plugin.serverCompatibility?.level).toBe('error');
    expect(rig.plugin.serverCompatibility?.message).toContain('older than the minimum supported');
    expect(Notice.messages.some((n) => n.message.includes('older than the minimum supported'))).toBe(
      true,
    );
    expect(tooltipOf(rig.plugin)).toContain('minimum supported');
  });

  it('a legacy server (no version reported) warns with the upgrade pointer', async () => {
    const rig = await makeRig(null);
    vi.advanceTimersByTime(1000);

    expect(rig.plugin.serverCompatibility?.level).toBe('warn');
    expect(rig.plugin.serverCompatibility?.message).toMatch(/predates version reporting/);
    expect(tooltipOf(rig.plugin)).toContain('docs/UPGRADING.md');
  });

  it('a matching server is ok: no Notice, no tooltip note, and a stale note clears when it turns ok', async () => {
    const rig = await makeRig('0.0.9');
    vi.advanceTimersByTime(1000);
    expect(tooltipOf(rig.plugin)).toContain('minimum supported');

    rig.setServerVersion('1.5.0');
    vi.advanceTimersByTime(1000);
    expect(rig.plugin.serverCompatibility?.level).toBe('ok');
    // The stale note must not leak into the tooltip once the server reads ok.
    expect(tooltipOf(rig.plugin)).not.toContain('minimum supported');
    expect(Notice.messages).toHaveLength(1); // only the initial error Notice
  });

  it('an ok server from the start produces no Notice at all', async () => {
    const rig = await makeRig('1.5.2');
    vi.advanceTimersByTime(3000);
    expect(rig.plugin.serverCompatibility?.level).toBe('ok');
    expect(Notice.messages).toHaveLength(0);
    expect(tooltipOf(rig.plugin)).not.toContain('server');
  });

  it('an auth-failure note and a compat note both ride the tooltip, concatenated', async () => {
    const rig = await makeRig('1.6.0');
    // Both notes live at once (token rejected while the server also reports
    // skew): neither may hide the other. The status note arrives via the auth
    // failure path; setting it directly pins the tick's composition.
    (rig.plugin as unknown as { statusNote: string }).statusNote =
      'Device token rejected — unlink and re-pair with a fresh code.';
    vi.advanceTimersByTime(1000);
    const tooltip = tooltipOf(rig.plugin);
    expect(tooltip).toContain('Device token rejected');
    expect(tooltip).toContain('newer than this client');
    expect(tooltip).toContain(' · ');
  });

  it('pre-ack states (connecting/disconnected) do not produce a legacy-server verdict', async () => {
    const rig = await makeRig('1.5.0');
    const client = rig.plugin.client as unknown as { status: () => SyncClientStatus };
    client.status = () => ({ ...liveStatus(null), state: 'disconnected' });
    vi.advanceTimersByTime(3000);
    expect(rig.plugin.serverCompatibility).toBeNull(); // nothing assessed pre-ack
  });

  it('collectDiagnosticsInput carries the client-reported serverVersion', async () => {
    const rig = await makeRig('9.9.9');
    vi.advanceTimersByTime(1000);
    const input = (
      rig.plugin as unknown as { collectDiagnosticsInput(): DiagnosticsInput }
    ).collectDiagnosticsInput();
    expect(input.serverVersion).toBe('9.9.9');
  });
});

describe('server version compatibility (settings tab)', () => {
  beforeEach(() => {
    resetObsidianMock();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('About renders the Server version row and the 1 Hz loop refreshes it', async () => {
    vi.useFakeTimers();
    const { app } = makeFakeApp(new FakeVault());
    const plugin = new VaultSyncPlugin(app as unknown as App, { version: '1.5.0' } as PluginManifest, {
      fetchImpl: new FakeFetch().fetchImpl,
      wsFactory: offlineWsFactory,
    });
    asMockPlugin(plugin).store = LINKED;
    await plugin.onload();
    let serverVersion: string | null = '1.6.0';
    plugin.client = {
      status: () => liveStatus(serverVersion),
      reconnect: async () => {},
      close: () => {},
    } as unknown as SyncClient;

    const tab = asMockPlugin(plugin).settingTabs[0] as unknown as VaultSyncSettingTab;
    vi.advanceTimersByTime(1000); // plugin tick assesses the verdict first
    tab.display();
    expect(findSetting('Server version').desc).toContain('newer than this client');

    // The verdict clears; the tab's own 1 Hz refresh repaints the row.
    serverVersion = '1.5.3';
    vi.advanceTimersByTime(1000);
    expect(findSetting('Server version').desc).toContain('Server 1.5.3');
    expect(findSetting('Server version').desc).toContain('compatible');
    tab.hide();
    plugin.onunload();
  });

  it('unlinked: the row explains pairing instead of a version', async () => {
    const { app } = makeFakeApp(new FakeVault());
    const plugin = new VaultSyncPlugin(app as unknown as App, { version: '1.5.0' } as PluginManifest, {
      fetchImpl: new FakeFetch().fetchImpl,
      wsFactory: offlineWsFactory,
    });
    await plugin.onload();
    const tab = asMockPlugin(plugin).settingTabs[0] as unknown as VaultSyncSettingTab;
    tab.display();
    expect(findSetting('Server version').desc).toContain('Pair this vault');
    tab.hide();
    plugin.onunload();
  });
});

describe('fetchWorkerStatus serverVersion parsing', () => {
  const baseBody = {
    vaultName: 'personal',
    devices: [],
    attachments: { count: 0, bytes: 0 },
    storageBytes: 42,
  };

  it('parses serverVersion when the worker reports it', async () => {
    const fetcher = new FakeFetch().json('GET', '/api/status', 200, { ...baseBody, serverVersion: '0.2.0' });
    const summary = await fetchWorkerStatus({
      origin: 'https://w.example',
      token: 'tok-1',
      fetchImpl: fetcher.fetchImpl,
    });
    expect(summary?.serverVersion).toBe('0.2.0');
    expect(summary?.storageBytes).toBe(42);
  });

  it('omits serverVersion for legacy workers (field absent, not null)', async () => {
    const fetcher = new FakeFetch().json('GET', '/api/status', 200, baseBody);
    const summary = await fetchWorkerStatus({
      origin: 'https://w.example',
      token: 'tok-1',
      fetchImpl: fetcher.fetchImpl,
    });
    expect(summary).not.toBeNull();
    expect(summary?.serverVersion).toBeUndefined();
  });
});
