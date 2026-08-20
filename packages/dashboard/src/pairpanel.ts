/**
 * Pairing panel — the QR + code + deep-link block shared by the claim success
 * screen and the "Pair a device" modal. Renders a 10-minute expiry countdown
 * and flips to an "expired" state when it runs out (codes are one-time, §3).
 */

import { copyButton, h } from './dom.js';
import { countdownText } from './format.js';
import { pairDeepLink } from './rows.js';
import type { PairCodeDoc } from './types.js';

export interface PairingPanel {
  root: HTMLElement;
  dispose(): void;
}

export function pairingPanel(doc: PairCodeDoc): PairingPanel {
  const origin = window.location.origin;
  const deepLink = pairDeepLink(origin, doc.code);

  const countdown = h('span', { class: 'pair-countdown-time', text: countdownText(doc.expiresAt - Date.now()) });
  const qrSlot = h('div', { class: 'qr-slot' });
  const root = h(
    'div',
    { class: 'pair-panel' },
    qrSlot,
    h(
      'div',
      { class: 'pair-details' },
      h('h3', { class: 'pair-heading', text: 'Scan or enter on your device' }),
      h(
        'p',
        { class: 'pair-sub' },
        'In the VaultSync for Agents plugin open ',
        h('em', { text: 'Settings → Pair a device' }),
        ', or run ',
        h('code', { text: 'vsa link' }),
        ' in a terminal.',
      ),
      codeRow('Pairing code', doc.code),
      codeRow('Server URL', origin),
      h(
        'div',
        { class: 'pair-actions' },
        h('a', { class: 'btn btn-primary', href: deepLink, text: 'Open in Obsidian' }),
        copyButton(() => doc.code, 'Copy code'),
        copyButton(() => origin, 'Copy URL'),
      ),
      h(
        'p',
        { class: 'pair-countdown' },
        'Code expires in ',
        countdown,
        ' — one-time use.',
      ),
    ),
  );

  // QR renders asynchronously (canvas); failure just leaves the text paths.
  void import('./qr.js')
    .then(({ qrImage }) => qrImage(deepLink))
    .then((image) => qrSlot.append(image))
    .catch(() => {
      qrSlot.append(h('p', { class: 'pair-sub', text: '(QR unavailable)' }));
    });

  const timer = window.setInterval(() => {
    countdown.textContent = countdownText(doc.expiresAt - Date.now());
    if (doc.expiresAt - Date.now() <= 0) {
      countdown.parentElement?.classList.add('pair-expired');
      countdown.textContent = 'expired';
    }
  }, 1000);

  return {
    root,
    dispose(): void {
      window.clearInterval(timer);
    },
  };
}

function codeRow(label: string, value: string): HTMLElement {
  return h(
    'div',
    { class: 'pair-code-row' },
    h('span', { class: 'pair-code-label', text: label }),
    h('code', { class: 'pair-code-value', text: value }),
    copyButton(() => value),
  );
}
