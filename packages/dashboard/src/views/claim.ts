/**
 * Claim view (FR-22, §3) — the first-run screen of an unclaimed worker:
 * name the vault, set + confirm the admin passphrase, then the SPA
 * immediately logs the admin in and mints the FIRST pairing code so the
 * success screen can show QR + deep link + plain code with copy buttons.
 */

import { api, ApiError } from '../api.js';
import { field, h, primaryButton, textInput } from '../dom.js';
import { pairingPanel } from '../pairpanel.js';
import { DEVICE_TYPES, type DeviceTypeOption } from '../types.js';
import type { ViewContext, ViewHandle } from '../view.js';

export function claimView(ctx: ViewContext): ViewHandle {
  const root = h('div', { class: 'auth-wrap' });
  let panel: { dispose(): void } | null = null;

  function showForm(): void {
    panel?.dispose();
    panel = null;

    const vaultName = textInput({ name: 'vaultName', placeholder: 'e.g. Personal' });
    const passphrase = textInput({ name: 'passphrase', placeholder: 'Admin passphrase', type: 'password' });
    const confirm = textInput({ name: 'confirm', placeholder: 'Repeat passphrase', type: 'password' });
    const deviceName = textInput({ name: 'deviceName', placeholder: 'e.g. Desktop', value: 'My device' });
    const deviceType = h(
      'select',
      { class: 'input' },
      ...DEVICE_TYPES.map((type) => h('option', { value: type, text: type })),
    ) as HTMLSelectElement;
    deviceType.value = 'desktop';

    const errorLine = h('p', { class: 'form-error', role: 'alert' });
    const submit = primaryButton('Claim this worker', () => void submitClaim());

    root.replaceChildren(
      h(
        'form',
        {
          class: 'card auth-card',
          onsubmit: (event: Event) => {
            event.preventDefault();
            void submitClaim();
          },
        },
        h('h1', { text: 'Claim your sync worker' }),
        h(
          'p',
          { class: 'auth-sub' },
          'This worker is fresh. Claiming sets the admin passphrase for this dashboard and names the vault.',
        ),
        field('Vault name', vaultName),
        field('Admin passphrase', passphrase, 'At least 4 characters. Used only for this dashboard.'),
        field('Confirm passphrase', confirm),
        h('div', { class: 'field-sep' }),
        field('First device to pair', deviceName, 'Shown in the device list once it connects.'),
        field('Device type', deviceType),
        errorLine,
        h('div', { class: 'form-actions' }, submit),
      ),
    );

    async function submitClaim(): Promise<void> {
      errorLine.textContent = '';
      const name = vaultName.value.trim();
      const pass = passphrase.value;
      if (name.length === 0) {
        errorLine.textContent = 'Give the vault a name.';
        return;
      }
      if (pass.length < 4) {
        errorLine.textContent = 'Passphrase must be at least 4 characters.';
        return;
      }
      if (pass !== confirm.value) {
        errorLine.textContent = 'Passphrases do not match.';
        return;
      }

      const firstDevice = deviceName.value.trim() || 'My device';
      const firstType = deviceType.value as DeviceTypeOption;
      submit.disabled = true;
      submit.textContent = 'Claiming…';
      try {
        await api.claim({ passphrase: pass, vaultName: name, deviceName: firstDevice, deviceType: firstType });
        ctx.dispatch({ type: 'network-ok' });
        await finishClaim(pass, firstDevice, firstType);
      } catch (error) {
        submit.disabled = false;
        submit.textContent = 'Claim this worker';
        if (error instanceof ApiError) {
          if (error.status === 409) {
            ctx.dispatch({ type: 'already-claimed' });
            return;
          }
          if (error.kind === 'network') ctx.dispatch({ type: 'network-error' });
          errorLine.textContent = error.message;
        } else {
          errorLine.textContent = 'Unexpected error — try again.';
        }
      }
    }
  }

  /**
   * The vault is claimed; sign the browser in and mint the first pairing
   * code. Retryable on its own — never re-POSTs /claim.
   */
  async function finishClaim(pass: string, firstDevice: string, firstType: DeviceTypeOption): Promise<void> {
    const retry = primaryButton('Retry', () => void finishClaim(pass, firstDevice, firstType));
    const status = h('p', { class: 'auth-sub', text: 'Signing in and minting the first pairing code…' });
    const card = h(
      'div',
      { class: 'card auth-card' },
      h('h1', { text: 'Vault claimed' }),
      status,
      h('div', { class: 'form-actions' }, retry, h('span')),
    );
    root.replaceChildren(card);
    retry.hidden = true;

    try {
      await api.adminLogin(pass);
      const pairDoc = await api.adminPair(firstDevice, firstType);
      ctx.dispatch({ type: 'network-ok' });
      panel?.dispose();
      const pair = pairingPanel(pairDoc);
      panel = pair;
      root.replaceChildren(
        h(
          'div',
          { class: 'card auth-card' },
          h('h1', { text: 'Vault claimed' }),
          h('p', { class: 'auth-sub' }, 'Pair your devices now — you can also do it later from the dashboard.'),
          pair.root,
          h(
            'div',
            { class: 'form-actions' },
            primaryButton('Open the dashboard', () => ctx.dispatch({ type: 'claim-done' })),
          ),
        ),
      );
    } catch (error) {
      ctx.dispatch({ type: 'network-ok' });
      retry.hidden = false;
      status.className = 'form-error';
      status.textContent =
        error instanceof ApiError && error.kind !== 'network'
          ? `Could not mint the pairing code: ${error.message}.`
          : 'The connection dropped while minting the pairing code.';
      const cont = h(
        'button',
        { class: 'btn btn-quiet', type: 'button', onclick: () => ctx.dispatch({ type: 'logged-out' }) },
        'Continue to sign in',
      );
      (card.querySelector('.form-actions') as HTMLElement).replaceChildren(retry, cont);
    }
  }

  showForm();

  return {
    root,
    dispose(): void {
      panel?.dispose();
    },
  };
}
