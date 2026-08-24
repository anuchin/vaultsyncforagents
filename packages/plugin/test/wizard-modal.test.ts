/**
 * `src/wizard-modal.ts` — the setup modal's state machine against the mock
 * Obsidian: form validation, the happy path to "Use this worker" (which
 * persists the URL into plugin data and fires onApplied), the error state's
 * Back button, and the multi-account first pass rendering a picker.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { App, PluginManifest } from 'obsidian';
import { VaultSyncPlugin } from '../src/plugin.js';
import { SetupWizardModal } from '../src/wizard-modal.js';
import { Notice, resetObsidianMock, Setting, type SettingRecord } from './helpers/obsidian-mock.js';
import { makeFakeApp, FakeVault } from './helpers/fake-vault.js';
import { offlineWsFactory } from './helpers/network-fakes.js';
import { fakeWorld, happyRoutes, wizardDeps } from './helpers/wizard-fakes.js';

function findSetting(name: string): SettingRecord {
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
  for (let i = 0; i < 12; i += 1) await Promise.resolve();
}

describe('SetupWizardModal', () => {
  let vault: FakeVault;
  let plugin: VaultSyncPlugin;

  beforeEach(async () => {
    resetObsidianMock();
    vault = new FakeVault();
    const { app } = makeFakeApp(vault);
    plugin = new VaultSyncPlugin(app as unknown as App, {} as PluginManifest, {
      wsFactory: offlineWsFactory,
    });
    await plugin.onload();
  });

  afterEach(() => {
    plugin.onunload();
  });

  function openModal(
    fetchImpl?: typeof fetch,
    callbacks: { onApplied?: () => void } = {},
  ): SetupWizardModal {
    const modal = new SetupWizardModal(
      {},
      plugin,
      callbacks,
      fetchImpl === undefined ? {} : wizardDeps(fetchImpl),
    );
    modal.open();
    return modal;
  }

  it('renders the form and refuses to deploy without name + token', async () => {
    const modal = openModal();
    expect(findSetting('Vault name')).toBeTruthy();
    await findButton('Deploy your worker').click();
    expect(Notice.messages.some((m) => m.message.includes('vault a name'))).toBe(true);
    modal.close();
  });

  it('happy path: deploys, then "Use this worker" persists the URL and applies', async () => {
    const world = fakeWorld(happyRoutes());
    let applied = 0;
    const modal = openModal(world.fetchImpl, { onApplied: () => (applied += 1) });

    const nameField = findSetting('Vault name');
    nameField.text?.onChange('Personal');
    const tokenField = findSetting('Cloudflare API token');
    tokenField.text?.onChange('cf-token');

    await findButton('Deploy your worker').click();
    await flush();

    expect(findSetting('Your worker is live')).toBeTruthy();
    expect(findSetting('Worker URL').desc).toContain('vaultsync-personal-abcd.alice.workers.dev');

    await findButton('Use this worker').click();
    expect(plugin.data.url).toBe('https://vaultsync-personal-abcd.alice.workers.dev');
    expect(applied).toBe(1);
  });

  it('failure lands in the error state; Back returns to the form', async () => {
    const routes = happyRoutes();
    routes['GET cf:/user/tokens/verify'] = () =>
      Response.json(
        { success: false, errors: [{ code: 1000, message: 'Invalid API Token' }], result: null },
        { status: 400 },
      );
    const world = fakeWorld(routes);
    const modal = openModal(world.fetchImpl);

    findSetting('Vault name').text?.onChange('Personal');
    findSetting('Cloudflare API token').text?.onChange('cf-token');

    await findButton('Deploy your worker').click();
    await flush();

    expect(findSetting('Deploy failed')).toBeTruthy();
    expect(findSetting('Deploy failed')).toBeTruthy();
    const errorLine = Setting.instances.find((r) => r.className === 'vsa-wizard-error');
    expect(errorLine?.desc).toContain('Invalid API Token');

    await findButton('Back').click();
    expect(findSetting('Vault name')).toBeTruthy();
    modal.close();
  });

  it('a multi-account token re-renders the form with an account picker', async () => {
    const routes = happyRoutes();
    routes['GET cf:/accounts'] = () =>
      Response.json({
        success: true,
        errors: [],
        result: [
          { id: 'a1', name: 'One' },
          { id: 'a2', name: 'Two' },
        ],
      });
    const world = fakeWorld(routes);
    const modal = openModal(world.fetchImpl);

    findSetting('Vault name').text?.onChange('Personal');
    findSetting('Cloudflare API token').text?.onChange('cf-token');

    await findButton('Deploy your worker').click();
    await flush();

    const picker = findSetting('Cloudflare account');
    expect(picker.dropdown).not.toBeNull();
    expect(picker.dropdown?.options).toEqual({ a1: 'One', a2: 'Two' });
    modal.close();
  });
});
