/**
 * The settings tab (plugin scope item #6), organized in four sections:
 *
 *   Connection — worker URL, device name (pairing-time OR rename when
 *                linked), pairing form / status readout + Sync now + unlink
 *   Sync       — rescan interval, .obsidian/ toggle, pause/resume,
 *                sync-on-startup
 *   Advanced   — status-bar indicator mode, ignore patterns, diagnostics
 *                (log level + Copy diagnostics + Save support bundle)
 *   About      — versions, storage usage, project README link
 *
 * All logic lives on `VaultSyncPlugin`; the tab is presentation plus wiring.
 */

import { Modal, Notice, PluginSettingTab, Setting } from 'obsidian';
import type { App } from 'obsidian';
import {
  defaultDeviceName,
  RESCAN_INTERVAL_CHOICES,
  type LogLevel,
  type VaultSyncPluginData,
} from './data.js';
import type { PairOutcome } from './pairing.js';
import { pairOutcomeMessage } from './pairing.js';
import { formatBytes, PROTOCOL_VERSION } from './diagnostics.js';
import { formatSince } from './statusbar.js';
import type { VaultSyncPlugin } from './plugin.js';
import { SetupWizardModal } from './wizard-modal.js';

/**
 * Cloudflare Deploy Button target (FR-21): provisions a preconfigured worker
 * + Durable Object + R2 bucket in the user's own account — no wrangler, no
 * manual config. The template repo pins a released worker version.
 */
export const DEPLOY_URL =
  'https://deploy.workers.cloudflare.com/?url=' +
  'https://github.com/anuchin/vaultsyncforagents-template';

/** The project README (the About section's link). */
export const PROJECT_README_URL = 'https://github.com/anuchin/vaultsyncforagents#readme';

/** Open the deploy page in the system browser (no-op where `window` is absent). */
export function openDeployPage(): void {
  if (typeof window === 'undefined') return;
  window.open(DEPLOY_URL, '_blank');
}

/** Open the project README in the system browser (no-op without `window`). */
export function openReadmePage(): void {
  if (typeof window === 'undefined') return;
  window.open(PROJECT_README_URL, '_blank');
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
  /**
   * Linked-mode device-name draft: edits stage here (NOT in plugin data) so a
   * failed rename cannot leave the local name out of sync with the worker.
   */
  private renameDraft: string | null = null;
  private hintSetting: Setting | null = null;
  private statusSetting: Setting | null = null;
  private storageSetting: Setting | null = null;
  private serverVersionSetting: Setting | null = null;
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
    this.storageSetting = null;
    this.serverVersionSetting = null;
    this.renameDraft = null;

    this.renderConnectionSection();
    this.renderSyncSection();
    this.renderAdvancedSection();
    this.renderAboutSection();
    this.startRefresh();
  }

  override hide(): void {
    this.stopRefresh();
  }

  // --- sections -----------------------------------------------------------------

  private heading(text: string): void {
    new Setting(this.containerEl).setName(text).setHeading();
  }

  private renderConnectionSection(): void {
    const { containerEl } = this;
    this.heading('Connection');

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

    if (this.plugin.linked) {
      this.renderLinkedDeviceName();
      this.renderLinkedStatus();
    } else {
      this.renderPairingDeviceName();
      this.renderPairingSection();
    }
  }

  /** Unlinked: the name is a pairing-time default (applies at next pair). */
  private renderPairingDeviceName(): void {
    new Setting(this.containerEl)
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

  /** Linked: the field shows the current name; Rename pushes it to the worker. */
  private renderLinkedDeviceName(): void {
    const current = this.renameDraft ?? this.plugin.data.deviceName;
    new Setting(this.containerEl)
      .setName('Device name')
      .setDesc(
        'The worker dashboard shows this name. Edit it and press "Rename device" to update this device on the worker (1-30 characters).',
      )
      .addText((text) =>
        text
          .setPlaceholder(defaultDeviceName())
          .setValue(current)
          .onChange((value) => {
            this.renameDraft = value;
          }),
      )
      .addButton((button) =>
        button.setButtonText('Rename device').onClick(async () => {
          button.setDisabled(true);
          try {
            const ok = await this.plugin.renameDevice(this.renameDraft ?? this.plugin.data.deviceName);
            if (ok) this.display(); // re-render with the persisted name
          } finally {
            button.setDisabled(false);
          }
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
          '1. Deploy your own worker with a button below — from right here (no GitHub, no terminal) or via Cloudflare\'s web page.',
          '2. Open the worker URL in a browser and set the admin passphrase (claim).',
          '3. Create a pairing code on the dashboard, paste it above, and pair.',
          'On a phone, scanning the dashboard QR or tapping its obsidian:// link pairs without typing.',
        ].join('\n'),
      )
      .addButton((button) =>
        button
          .setCta()
          .setButtonText('Set up a new worker…')
          .onClick(() => {
            new SetupWizardModal(this.app, this.plugin, {
              onApplied: () => this.display(),
            }).open();
          }),
      )
      .addButton((button) =>
        button.setButtonText('Deploy via Cloudflare').onClick(() => openDeployPage()),
      );
  }

  private renderLinkedStatus(): void {
    const { containerEl } = this;

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

  private renderSyncSection(): void {
    const { containerEl } = this;
    const data = this.plugin.data;
    this.heading('Sync');

    if (this.plugin.linked) {
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

      const paused = this.plugin.syncingPaused;
      new Setting(containerEl)
        .setName(paused ? 'Syncing paused' : 'Pause syncing')
        .setDesc(
          paused
            ? 'Syncing is paused: the connection is down and vault changes stay local. Resume reconnects and runs a full catch-up sync.'
            : 'Temporarily stop syncing without unlinking — the transport disconnects and the watcher goes idle. Your link and local state are kept.',
        )
        .addButton((button) =>
          button
            .setButtonText(paused ? 'Resume syncing' : 'Pause syncing')
            .onClick(async () => {
              button.setDisabled(true);
              try {
                if (paused) await this.plugin.resumeSyncing();
                else this.plugin.pauseSyncing();
              } finally {
                this.display(); // re-render: the button (and label) flip
              }
            }),
        );
    }

    new Setting(containerEl)
      .setName('Sync on startup')
      .setDesc(
        'ON (default): sync starts as soon as Obsidian opens. OFF: the plugin loads idle and the first "Sync now" press starts syncing (manual-only mode).',
      )
      .addToggle((toggle) =>
        toggle.setValue(data.settings.syncOnStartup).onChange(async (value) => {
          await this.plugin.applySyncOnStartup(value);
        }),
      );
  }

  private renderAdvancedSection(): void {
    const { containerEl } = this;
    const data = this.plugin.data;
    this.heading('Advanced');

    new Setting(containerEl)
      .setName('Status bar indicator')
      .setDesc(
        'Detailed: "vsa ✓ 12s" with state and age. Compact: just the symbol. Hidden: no status bar item at all.',
      )
      .addDropdown((dropdown) => {
        dropdown.addOption('detailed', 'Detailed');
        dropdown.addOption('compact', 'Compact');
        dropdown.addOption('hidden', 'Hidden');
        dropdown.setValue(data.settings.statusBarMode);
        dropdown.onChange(async (value) => {
          await this.plugin.applyStatusBarMode(
            value === 'compact' || value === 'hidden' ? value : 'detailed',
          );
        });
      });

    new Setting(containerEl)
      .setName('Ignore patterns')
      .setDesc(
        'One pattern per line, e.g. private/** or *.tmp. Glob-lite: * matches within one folder name, ** spans folders (dir/** skips the folder and everything in it); a pattern without / matches file names at any depth. Case-insensitive; applies on this device only; saving reconnects sync to apply them.',
      )
      .addTextArea((area) =>
        area
          .setPlaceholder('private/**\n*.tmp')
          .setValue(data.settings.ignorePatterns)
          .onChange(async (value) => {
            await this.plugin.applyIgnorePatterns(value);
          }),
      );

    new Setting(containerEl)
      .setName('Diagnostics log level')
      .setDesc(
        'info (default) records lifecycle events; debug additionally logs protocol round-trips (one short line per frame); warn keeps only warnings and errors.',
      )
      .addDropdown((dropdown) => {
        dropdown.addOption('info', 'info');
        dropdown.addOption('debug', 'debug');
        dropdown.addOption('warn', 'warn');
        dropdown.setValue(data.settings.logLevel);
        dropdown.onChange(async (value) => {
          const level: LogLevel = value === 'debug' || value === 'warn' ? value : 'info';
          await this.plugin.applyLogLevel(level);
        });
      });

    new Setting(containerEl)
      .setName('Copy diagnostics')
      .setDesc(
        'Copies a bug-report bundle: plugin + protocol versions, device, worker URL, pairing state, a status snapshot, the platform, and the last 20 log lines.',
      )
      .addButton((button) =>
        button.setButtonText('Copy diagnostics').onClick(async () => {
          button.setDisabled(true);
          try {
            await this.plugin.copyDiagnostics();
          } finally {
            button.setDisabled(false);
          }
        }),
      );

    new Setting(containerEl)
      .setName('Save support bundle')
      .setDesc(
        'Writes a richer markdown diagnostic file (versions, settings, sync state, recent log) to .vaultsyncforagents/ in this vault — attach it to bug reports. It never contains note contents or the device token.',
      )
      .addButton((button) =>
        button.setButtonText('Save support bundle').onClick(async () => {
          button.setDisabled(true);
          try {
            await this.plugin.saveSupportBundle();
          } finally {
            button.setDisabled(false);
          }
        }),
      );
  }

  private renderAboutSection(): void {
    const { containerEl } = this;
    this.heading('About');

    new Setting(containerEl)
      .setName('Versions')
      .setDesc(
        `Plugin ${this.plugin.manifest.version || 'unknown'} · protocol v${PROTOCOL_VERSION} · ${this.plugin.platformSummary()}`,
      );

    this.serverVersionSetting = new Setting(containerEl)
      .setName('Server version')
      .setDesc(this.serverVersionText());
    this.refreshServerVersion();

    this.storageSetting = new Setting(containerEl)
      .setName('Vault storage')
      .setDesc(this.plugin.linked ? 'Checking the worker…' : 'Pair this vault to see storage usage.');
    if (this.plugin.linked) void this.refreshStorage();

    new Setting(containerEl)
      .setName('Project home')
      .setDesc(`Documentation and source: ${PROJECT_README_URL}`)
      .addButton((button) =>
        button.setButtonText('Open README').onClick(() => openReadmePage()),
      );
  }

  /** Fill the About storage line from /api/status (device-token auth). */
  private async refreshStorage(): Promise<void> {
    const summary = await this.plugin.fetchStorageSummary();
    const desc =
      summary === null
        ? 'Storage usage is currently unavailable (the worker is unreachable).'
        : `Storage used: ${formatBytes(summary.storageBytes)} · ${summary.attachments.count} attachment${
            summary.attachments.count === 1 ? '' : 's'
          } (${formatBytes(summary.attachments.bytes)})` +
          (summary.devices.length > 0
            ? ` · ${summary.devices.length} device${summary.devices.length === 1 ? '' : 's'}`
            : '');
    // The tab may have been closed/re-rendered meanwhile; paint only if live.
    if (this.storageSetting !== null) this.storageSetting.setDesc(desc);
  }

  // --- status / feedback -----------------------------------------------------------

  private statusText(): string {
    const data: VaultSyncPluginData = this.plugin.data;
    const status = this.plugin.client?.status();
    if (this.plugin.syncingPaused) {
      return [
        'State: paused',
        `Worker: ${data.url}`,
        'Vault changes stay local until you resume syncing.',
      ].join('\n');
    }
    if (status === undefined) {
      return `Linked to ${data.url} (device ${data.deviceName || data.deviceId}).`;
    }
    const lastSync =
      status.lastSyncAt === null
        ? 'never'
        : `${formatSince(Date.now() - status.lastSyncAt)} ago`;
    const state = status.state === 'live' ? 'connected' : status.state;
    const lines = [`State: ${state}`, `Worker: ${data.url}`, `Last sync: ${lastSync}`];
    // Bulk-phase progress — the same X/Y the status bar shows during a
    // multi-minute initial sync.
    if (status.progress !== undefined) {
      lines.push(`Syncing: ${status.progress.done}/${status.progress.total} (${status.progress.phase})`);
    }
    lines.push(
      `Pending changes: ${status.pending}`,
      `Conflicts: ${status.conflicts.length}${status.conflicts.length > 0 ? ' (conflict copies were written into the vault)' : ''}`,
    );
    return lines.join('\n');
  }

  private refreshStatus(): void {
    this.statusSetting?.setDesc(this.statusText());
    this.refreshServerVersion();
  }

  /**
   * The About section's server-version line: the helloAck-reported version
   * plus the compat verdict when it is not ok. `serverVersion` may lag the
   * verdict by a tick (the plugin assesses on its own 1 Hz supervision), so
   * the verdict message is authoritative when present.
   */
  private serverVersionText(): string {
    if (!this.plugin.linked) return 'Pair this vault to see the worker version.';
    const status = this.plugin.client?.status();
    const verdict = this.plugin.serverCompatibility;
    if (verdict !== null && verdict.level !== 'ok') return verdict.message;
    const version = status?.serverVersion ?? null;
    return version === null
      ? 'Unknown — the worker has not reported a version yet.'
      : `Server ${version} · compatible with this plugin.`;
  }

  /** Repaint the server-version row (called by the 1 Hz refresh loop). */
  private refreshServerVersion(): void {
    // The tab may have been closed/re-rendered meanwhile; paint only if live.
    if (this.serverVersionSetting !== null) this.serverVersionSetting.setDesc(this.serverVersionText());
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
