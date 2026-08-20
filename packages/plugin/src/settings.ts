/**
 * The settings tab (plugin scope item #6): worker URL + device name +
 * pairing code + "Pair" (with unclaimed-worker onboarding guidance), "Sync
 * now", unlink-with-confirm, rescan-interval and `.obsidian/` toggles, and a
 * live status readout (connected, last sync, pending, conflicts).
 *
 * All logic lives on `VaultSyncPlugin`; the tab is presentation plus wiring.
 */

import { Modal, Notice, PluginSettingTab, Setting } from 'obsidian';
import type { App } from 'obsidian';
import {
  defaultDeviceName,
  RESCAN_INTERVAL_CHOICES,
  type VaultSyncPluginData,
} from './data.js';
import type { PairOutcome } from './pairing.js';
import { pairOutcomeMessage } from './pairing.js';
import { formatSince } from './statusbar.js';
import type { VaultSyncPlugin } from './plugin.js';

/**
 * Cloudflare Deploy Button target (FR-21): provisions a preconfigured worker
 * + Durable Object + R2 bucket in the user's own account — no wrangler, no
 * manual config. The template repo pins a released worker version.
 */
export const DEPLOY_URL =
  'https://deploy.workers.cloudflare.com/?url=' +
  'https://github.com/vaultsyncforagents/vaultsyncforagents-template';

/** Open the deploy page in the system browser (no-op where `window` is absent). */
export function openDeployPage(): void {
  if (typeof window === 'undefined') return;
  window.open(DEPLOY_URL, '_blank');
}

/** Small confirmation dialog (the unlink button's safety net). */
export class ConfirmModal extends Modal {
  constructor(
    app: App,
    private readonly options: {
      title: string;
      body: string;
      confirmText: string;
      onConfirm: () => void | Promise<void>;
    },
  ) {
    super(app);
  }

  override onOpen(): void {
    new Setting(this.contentEl).setName(this.options.title).setDesc(this.options.body);
    new Setting(this.contentEl).addButton((button) =>
      button.setButtonText('Cancel').onClick(() => this.close()),
    );
    new Setting(this.contentEl).addButton((button) =>
      button
        .setCta()
        .setButtonText(this.options.confirmText)
        .onClick(async () => {
          this.close();
          await this.options.onConfirm();
        }),
    );
  }
}

export class VaultSyncSettingTab extends PluginSettingTab {
  private readonly plugin: VaultSyncPlugin;
  /** Pairing codes never touch disk — they are one-time, short-lived secrets. */
  private pairingCode = '';
  private hintSetting: Setting | null = null;
  private statusSetting: Setting | null = null;
  private refreshHandle: ReturnType<typeof setInterval> | null = null;

  constructor(app: App, plugin: VaultSyncPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  override display(): void {
    this.stopRefresh();
    const { containerEl } = this;
    containerEl.empty();
    this.hintSetting = null;
    this.statusSetting = null;

    this.renderConnectionSection();
    if (this.plugin.linked) {
      this.renderLinkedSection();
    } else {
      this.renderPairingSection();
    }
    this.startRefresh();
  }

  override hide(): void {
    this.stopRefresh();
  }

  // --- sections -----------------------------------------------------------------

  private renderConnectionSection(): void {
    const { containerEl } = this;
    new Setting(containerEl)
      .setName('Worker URL')
      .setDesc(
        'Your sync worker, e.g. https://personal.x.workers.dev. No worker yet? Use "Deploy your worker" below, open the URL in a browser, and claim it.',
      )
      .addText((text) =>
        text
          .setPlaceholder('https://personal.x.workers.dev')
          .setValue(this.plugin.data.url)
          .onChange(async (value) => {
            this.plugin.data.url = value.trim();
            await this.plugin.savePluginData();
          }),
      );

    new Setting(containerEl)
      .setName('Device name')
      .setDesc(`Shown in the worker dashboard's device list. Applies when (re)pairing.`)
      .addText((text) =>
        text
          .setPlaceholder(defaultDeviceName())
          .setValue(this.plugin.data.deviceName)
          .onChange(async (value) => {
            this.plugin.data.deviceName = value.trim();
            await this.plugin.savePluginData();
          }),
      );
  }

  private renderPairingSection(): void {
    const { containerEl } = this;
    new Setting(containerEl)
      .setName('Pairing code')
      .setDesc('From your worker dashboard: Devices → Pair new device. Codes are one-time and expire after 10 minutes.')
      .addText((text) =>
        text
          .setPlaceholder('7F3K-Q9M2')
          .onChange((value) => {
            this.pairingCode = value.trim();
          }),
      );

    new Setting(containerEl).addButton((button) =>
      button
        .setCta()
        .setButtonText('Pair this vault')
        .onClick(async () => {
          button.setDisabled(true);
          try {
            const outcome = await this.plugin.pairFromSettings(this.pairingCode);
            this.showOutcome(outcome);
          } finally {
            button.setDisabled(false);
          }
        }),
    );

    this.hintSetting = new Setting(containerEl)
      .setName('Getting started')
      .setClass('vsa-settings-hint')
      .setDesc(
        [
          '1. Deploy your own worker with the button below (your Cloudflare account, preconfigured — no wrangler).',
          '2. Open the worker URL in a browser and set the admin passphrase (claim).',
          '3. Create a pairing code on the dashboard, paste it above, and pair.',
          'On a phone, scanning the dashboard QR or tapping its obsidian:// link pairs without typing.',
        ].join('\n'),
      )
      .addButton((button) =>
        button.setButtonText('Deploy your worker').onClick(() => openDeployPage()),
      );
  }

  private renderLinkedSection(): void {
    const { containerEl } = this;
    const data = this.plugin.data;

    this.statusSetting = new Setting(containerEl)
      .setName('Status')
      .setClass('vsa-status-readout')
      .setDesc(this.statusText());

    new Setting(containerEl).addButton((button) =>
      button.setButtonText('Sync now').onClick(async () => {
        button.setDisabled(true);
        try {
          await this.plugin.syncNow();
        } finally {
          button.setDisabled(false);
          this.refreshStatus();
        }
      }),
    );

    new Setting(containerEl)
      .setName('Rescan interval')
      .setDesc(
        'Periodic full reconciliation — catches external edits while Obsidian is open and covers mobile background limits. Vault events and app-open sync always run.',
      )
      .addDropdown((dropdown) => {
        for (const choice of RESCAN_INTERVAL_CHOICES) {
          dropdown.addOption(String(choice.value), choice.label);
        }
        dropdown.setValue(String(data.settings.rescanIntervalSec));
        dropdown.onChange(async (value) => {
          await this.plugin.applyRescanInterval(Number(value));
        });
      });

    new Setting(containerEl)
      .setName('Sync .obsidian/ folder')
      .setDesc(
        'Opt in to syncing .obsidian/ (settings and plugins), excluding workspace.json and caches. ' +
          'The worker\u2019s per-vault setting takes precedence once connected.',
      )
      .addToggle((toggle) =>
        toggle.setValue(data.settings.obsidianSync).onChange(async (value) => {
          await this.plugin.applyObsidianSync(value);
        }),
      );

    new Setting(containerEl).addButton((button) =>
      button.setButtonText('Unlink this vault').onClick(() => {
        new ConfirmModal(this.app, {
          title: 'Unlink VaultSync?',
          body: 'This stops syncing and clears this device\u2019s local sync state. Files already in the vault are untouched. The worker keeps this device in its registry \u2014 revoke it from the dashboard if you are done with it.',
          confirmText: 'Unlink',
          onConfirm: async () => {
            await this.plugin.unlink();
            this.display();
          },
        }).open();
      }),
    );
  }

  // --- status / feedback -----------------------------------------------------------

  private statusText(): string {
    const data: VaultSyncPluginData = this.plugin.data;
    const status = this.plugin.client?.status();
    if (status === undefined) {
      return `Linked to ${data.url} (device ${data.deviceName || data.deviceId}).`;
    }
    const lastSync =
      status.lastSyncAt === null
        ? 'never'
        : `${formatSince(Date.now() - status.lastSyncAt)} ago`;
    const state = status.state === 'live' ? 'connected' : status.state;
    return [
      `State: ${state}`,
      `Worker: ${data.url}`,
      `Last sync: ${lastSync}`,
      `Pending changes: ${status.pending}`,
      `Conflicts: ${status.conflicts.length}${status.conflicts.length > 0 ? ' (conflict copies were written into the vault)' : ''}`,
    ].join('\n');
  }

  private refreshStatus(): void {
    this.statusSetting?.setDesc(this.statusText());
  }

  /** Pair feedback: success re-renders; failures land in the hint Setting. */
  private showOutcome(outcome: PairOutcome): void {
    if (outcome.status === 'paired') {
      new Notice(pairOutcomeMessage(outcome));
      this.display();
      return;
    }
    const message = pairOutcomeMessage(outcome);
    new Notice(message, 10000);
    if (this.hintSetting !== null) this.hintSetting.setDesc(message);
  }

  // --- live refresh loop ------------------------------------------------------------

  /** Refresh the status readout ~1 Hz while the tab is open. */
  private startRefresh(): void {
    this.stopRefresh();
    const handle = setInterval(() => this.refreshStatus(), 1000);
    this.refreshHandle = handle;
    // Obsidian clears registered intervals when the plugin unloads — no leak
    // even if the settings modal is force-closed.
    this.plugin.registerInterval(handle as unknown as number);
  }

  private stopRefresh(): void {
    if (this.refreshHandle !== null) {
      clearInterval(this.refreshHandle);
      this.refreshHandle = null;
    }
  }
}
