/**
 * Device self-service rename (the settings tab's "Rename device" button →
 * `PATCH /device`): the fetch mock verifies the wire request (method, URL,
 * Bearer auth, body), and the success path updates plugin data, the saved
 * store, and the in-vault device marker (FR-44), with a user Notice.
 * Failures (invalid name, server refusal, unreachable worker) keep the
 * previous local name.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import type { App, PluginManifest } from 'obsidian';
import { VaultSyncPlugin } from '../src/plugin.js';
import { asMockPlugin, Notice, resetObsidianMock } from './helpers/obsidian-mock.js';
import { makeFakeApp, FakeVault } from './helpers/fake-vault.js';
import { FakeFetch, jsonResult, offlineWsFactory } from './helpers/network-fakes.js';

const LINKED = {
  url: 'https://w.example',
  token: 'tok-1',
  deviceId: 'dev-1',
  deviceName: 'Desk',
  settings: { rescanIntervalSec: 0, obsidianSync: false, syncOnStartup: false },
};

/** A PATCH /device route that echoes the requested name back in the device doc. */
function renameRoute(fetcher: FakeFetch): void {
  fetcher.on('PATCH', '/device', (call) => {
    const body = JSON.parse(String(call.init?.body)) as { name?: unknown };
    return jsonResult(200, {
      ok: true,
      device: { id: 'dev-1', name: typeof body.name === 'string' ? body.name : '?', type: 'desktop' },
    });
  });
}

function renameCalls(fetcher: FakeFetch) {
  return fetcher.calls.filter((c) => c.url === 'https://w.example/device');
}

function markerOf(vault: FakeVault): Record<string, unknown> {
  const bytes = vault.adapter.files.get('.vaultsyncforagents/device.json');
  if (bytes === undefined) throw new Error('device marker was not written');
  return JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>;
}

describe('VaultSyncPlugin.renameDevice (PATCH /device)', () => {
  let vault: FakeVault;
  let fetcher: FakeFetch;
  let plugin: VaultSyncPlugin;

  beforeEach(async () => {
    resetObsidianMock();
    vault = new FakeVault();
    const { app } = makeFakeApp(vault);
    fetcher = new FakeFetch();
    plugin = new VaultSyncPlugin(app as unknown as App, {} as PluginManifest, {
      fetchImpl: fetcher.fetchImpl,
      wsFactory: offlineWsFactory,
    });
    asMockPlugin(plugin).store = JSON.parse(JSON.stringify(LINKED));
    await plugin.onload();
  });

  it('an unlinked plugin refuses and never calls the worker', async () => {
    const unlinked = new VaultSyncPlugin(
      makeFakeApp(new FakeVault()).app as unknown as App,
      {} as PluginManifest,
      { fetchImpl: fetcher.fetchImpl, wsFactory: offlineWsFactory },
    );
    await unlinked.onload();

    await expect(unlinked.renameDevice('Nope')).resolves.toBe(false);
    expect(renameCalls(fetcher)).toHaveLength(0);
    expect(Notice.messages[0]!.message).toContain('pair this vault first');
    unlinked.onunload();
  });

  it('sends PATCH with Bearer auth and {name}, then updates data, store, marker, Notice', async () => {
    renameRoute(fetcher);

    const ok = await plugin.renameDevice('MacBook Pro');
    expect(ok).toBe(true);

    // The wire request: method, URL, auth header, trimmed name in the body.
    const calls = renameCalls(fetcher);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.init?.method).toBe('PATCH');
    expect(JSON.parse(String(calls[0]!.init?.body))).toEqual({ name: 'MacBook Pro' });
    const headers = (calls[0]!.init?.headers ?? {}) as Record<string, string>;
    expect(headers['authorization']).toBe('Bearer tok-1');

    // Plugin data + persisted store carry the worker-confirmed name.
    expect(plugin.data.deviceName).toBe('MacBook Pro');
    expect(asMockPlugin(plugin).store).toMatchObject({ deviceName: 'MacBook Pro' });

    // The in-vault FR-44 marker reflects the rename.
    expect(markerOf(vault)).toMatchObject({ deviceId: 'dev-1', deviceName: 'MacBook Pro' });

    expect(Notice.messages.some((n) => n.message.includes('MacBook Pro'))).toBe(true);
  });

  it('rejects invalid names locally — no request, previous name kept', async () => {
    renameRoute(fetcher);
    for (const name of ['', '   ', 'x'.repeat(31), 'bad\nbreak', 'bell\u0007']) {
      const ok = await plugin.renameDevice(name);
      expect(ok, JSON.stringify(name)).toBe(false);
    }
    expect(renameCalls(fetcher)).toHaveLength(0);
    expect(plugin.data.deviceName).toBe('Desk');
    expect(Notice.messages[0]!.message).toContain('1-30');
  });

  it('a server 400 keeps the local name and surfaces the worker error', async () => {
    fetcher.json(
      'PATCH',
      '/device',
      400,
      { error: 'name must be 1-30 characters, without control characters' },
    );
    const ok = await plugin.renameDevice('Too Long Maybe');
    expect(ok).toBe(false);
    expect(plugin.data.deviceName).toBe('Desk');
    expect(asMockPlugin(plugin).store).toMatchObject({ deviceName: 'Desk' });
    const notice = Notice.messages[0]!;
    expect(notice.message).toContain('renaming failed');
    expect(notice.message).toContain('1-30');
  });

  it('a 401 (revoked token) points at re-pairing; an unreachable worker reports it', async () => {
    fetcher.json('PATCH', '/device', 401, { error: 'device token required' });
    expect(await plugin.renameDevice('Ghost')).toBe(false);
    expect(Notice.messages[0]!.message).toContain('re-pair');

    const offline = new FakeFetch(); // no routes → fetch rejects
    const { app } = makeFakeApp(new FakeVault());
    const plugin2 = new VaultSyncPlugin(app as unknown as App, {} as PluginManifest, {
      fetchImpl: offline.fetchImpl,
      wsFactory: offlineWsFactory,
    });
    asMockPlugin(plugin2).store = JSON.parse(JSON.stringify(LINKED));
    await plugin2.onload();
    expect(await plugin2.renameDevice('Ghost')).toBe(false);
    expect(Notice.messages[1]!.message).toContain('could not reach the worker');
    plugin2.onunload();
  });
});
