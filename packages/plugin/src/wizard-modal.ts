/**
 * The in-app setup wizard UI: one modal, four states (form → deploying →
 * done / error). Built only from Obsidian primitives the test mock covers
 * (Setting/Notice/Modal) — progress is a sequence of one-line Settings, so
 * the whole flow is assertable without a DOM.
 *
 * The Cloudflare API token lives in the modal's memory for the duration of
 * the deploy and is dropped when the modal closes — it is never written to
 * plugin data (the plugin's permanent credential remains the per-device
 * token from pairing).
 */

import { Modal, Notice, Setting } from 'obsidian';
import { normalizeWorkerUrl } from './workerapi.js';
import {
  deployWorker,
  prepareWizard,
  MultipleAccountsError,
  type DeployWorkerResult,
  type WizardDeps,
} from './wizard.js';
import type { CloudflareAccountInfo } from './cloudflare-deploy.js';
import type { VaultSyncPlugin } from './plugin.js';

/**
 * The "Create token" target: Cloudflare's token-creation page with this
 * deploy's exact permissions PRESELECTED via `permissionGroupKeys` (the
 * documented template-URL mechanism — developers.cloudflare.com/fundamentals/
 * api/how-to/account-owned-token-template/). Equivalent to the "Edit
 * Cloudflare Workers" template: Workers Scripts edit (upload the script +
 * DO migration), R2 storage edit (create the bucket), Account Settings read
 * (account lookup). Degrades gracefully: if Cloudflare ever drops the
 * preselection, the user still lands on the right page and the field's
 * description spells out the manual template.
 */
export function createTokenPageUrl(): string {
  const permissionGroupKeys = JSON.stringify([
    { key: 'workers_scripts', type: 'edit' },
    { key: 'workers_r2', type: 'edit' },
    { key: 'account_settings', type: 'read' },
  ]);
  const params = new URLSearchParams({
    permissionGroupKeys,
    accountId: '*',
    zoneId: 'all',
    name: 'VaultSync worker deploy',
  });
  return `https://dash.cloudflare.com/profile/api-tokens?${params.toString()}`;
}

type WizardState = 'form' | 'deploying' | 'done' | 'error';

export class SetupWizardModal extends Modal {
  private state: WizardState = 'form';
  private vaultName = '';
  private token = '';
  private accountId: string | null = null;
  private accounts: CloudflareAccountInfo[] | null = null;
  private result: DeployWorkerResult | null = null;
  private errorMessage = '';
  private readonly deps: WizardDeps;

  constructor(
    app: unknown,
    private readonly plugin: VaultSyncPlugin,
    private readonly callbacks: { onApplied?: () => void } = {},
    deps: WizardDeps = {},
  ) {
    // The real Modal wants `App`; the test mock passes anything. The `as
    // never` keeps both call sites honest without importing App types here.
    super(app as never);
    this.deps = deps;
  }

  override onOpen(): void {
    this.render();
  }

  private render(): void {
    const el = this.contentEl as unknown as { empty?: () => void };
    el.empty?.();
    if (this.state === 'form') this.renderForm();
    else if (this.state === 'deploying') this.renderProgress();
    else if (this.state === 'done') this.renderDone();
    else this.renderError();
  }

  // --- states -----------------------------------------------------------------------------------

  private renderForm(): void {
    new Setting(this.contentEl as never).setName('Set up a new sync worker').setHeading();

    new Setting(this.contentEl as never)
      .setName('Vault name')
      .setDesc('Names the worker and its storage, e.g. "personal" → vaultsync-personal-x7q2.')
      .addText((text) => {
        text.setPlaceholder('personal').onChange((value) => {
          this.vaultName = value.trim();
        });
      });

    new Setting(this.contentEl as never)
      .setName('Cloudflare API token')
      .setDesc(
        `A token with the "Edit Cloudflare Workers" template's permissions (Workers Scripts + R2 Storage + Account Settings). "Create token" opens Cloudflare's page with these preselected — just Continue to create. Used for this deploy only, never stored.`,
      )
      .addText((text) => {
        text.setPlaceholder('paste your token').onChange((value) => {
          this.token = value.trim();
        });
        // Mask in real Obsidian; the test stub has no inputEl.
        const input = (text as unknown as { inputEl?: HTMLInputElement }).inputEl;
        if (input !== undefined) input.type = 'password';
      })
      .addButton((button) =>
        button.setButtonText('Create token').onClick(() => {
          if (typeof window !== 'undefined') window.open(createTokenPageUrl(), '_blank');
        }),
      );

    const accounts = this.accounts;
    if (accounts !== null && accounts.length > 1) {
      const fallback = accounts[0]?.id ?? '';
      new Setting(this.contentEl as never)
        .setName('Cloudflare account')
        .setDesc('Your token can see several accounts — pick the one this worker lives in.')
        .addDropdown((dropdown) => {
          for (const account of accounts) dropdown.addOption(account.id, account.name);
          dropdown.setValue(this.accountId ?? fallback);
          dropdown.onChange((value) => {
            this.accountId = value;
          });
        });
      this.accountId ??= fallback;
    }

    new Setting(this.contentEl as never).addButton((button) =>
      button
        .setCta()
        .setButtonText('Deploy your worker')
        .onClick(async () => {
          if (this.vaultName === '') {
            new Notice('VaultSync: give the vault a name first.', 5000);
            return;
          }
          if (this.token === '') {
            new Notice('VaultSync: paste a Cloudflare API token first.', 5000);
            return;
          }
          await this.startDeploy();
        }),
    );

    new Setting(this.contentEl as never)
      .setName('What happens')
      .setDesc(
        'Deploys the released VaultSync worker + storage into YOUR Cloudflare account (free tier fits) and leaves the claim page one click away. No GitHub, no terminal. Prefer the web flow? The "Deploy your worker" button in settings still opens Cloudflare\'s deploy page.',
      );
  }

  private renderProgress(): void {
    new Setting(this.contentEl as never).setName('Deploying…').setHeading();
    new Setting(this.contentEl as never)
      .setName('In progress')
      .setClass('vsa-wizard-progress')
      .setDesc('Watch this space — each step appears as it runs. A deploy takes 10–30 seconds.');
  }

  private appendProgressLine(step: string): void {
    new Setting(this.contentEl as never).setClass('vsa-wizard-step').setDesc(step);
  }

  private renderDone(): void {
    const result = this.result;
    if (result === null) return;
    new Setting(this.contentEl as never).setName('Your worker is live').setHeading();
    new Setting(this.contentEl as never).setName('Worker URL').setDesc(
      `${result.workerUrl}\nNext: open it, set the admin passphrase (claim), then create a pairing code on its dashboard and paste it in plugin settings.` +
        (result.healthOk ? '' : '\n(The health probe got no answer yet — fresh workers.dev routes can take a minute to respond.)'),
    );
    new Setting(this.contentEl as never)
      .addButton((button) =>
        button.setButtonText('Open claim page').onClick(() => {
          if (typeof window !== 'undefined') window.open(result.workerUrl, '_blank');
        }),
      )
      .addButton((button) =>
        button
          .setCta()
          .setButtonText('Use this worker')
          .onClick(async () => {
            this.plugin.data.url = normalizeWorkerUrl(result.workerUrl);
            await this.plugin.savePluginData();
            new Notice(`VaultSync: worker set to ${this.plugin.data.url}. Claim it, then pair.`);
            this.callbacks.onApplied?.();
            this.close();
          }),
      );
  }

  private renderError(): void {
    new Setting(this.contentEl as never).setName('Deploy failed').setHeading();
    new Setting(this.contentEl as never).setClass('vsa-wizard-error').setDesc(this.errorMessage);
    new Setting(this.contentEl as never).addButton((button) =>
      button.setButtonText('Back').onClick(() => {
        this.state = 'form';
        this.render();
      }),
    );
  }

  // --- flow -------------------------------------------------------------------------------------

  private async startDeploy(): Promise<void> {
    try {
      const accounts = await prepareWizard(this.token, this.deps);
      if (accounts.length > 1 && this.accountId === null) {
        // First pass with a multi-account token: back to the form with a
        // picker. The token and vault name are kept.
        this.accounts = accounts;
        this.render();
        return;
      }
      this.state = 'deploying';
      this.render();
      this.result = await deployWorker(
        {
          vaultName: this.vaultName,
          token: this.token,
          accountId: this.accountId ?? undefined,
        },
        this.deps,
        (step) => this.appendProgressLine(step),
      );
      this.state = 'done';
      this.render();
    } catch (error) {
      if (error instanceof MultipleAccountsError) {
        this.accounts = error.accounts;
        this.state = 'form';
        this.render();
        return;
      }
      this.state = 'error';
      this.errorMessage = error instanceof Error ? error.message : String(error);
      this.render();
    }
  }
}
