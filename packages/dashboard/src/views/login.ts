/**
 * Login view (FR-32) — admin passphrase -> signed session cookie -> status.
 */

import { api, ApiError } from '../api.js';
import { field, h, primaryButton, textInput } from '../dom.js';
import type { ViewContext, ViewHandle } from '../view.js';

export function loginView(ctx: ViewContext, message: string | null): ViewHandle {
  const passphrase = textInput({ name: 'passphrase', placeholder: 'Admin passphrase', type: 'password' });
  const errorLine = h('p', { class: 'form-error', role: 'alert' });
  if (message !== null) errorLine.textContent = message;

  const submit = primaryButton('Sign in', () => void signIn());

  const root = h(
    'div',
    { class: 'auth-wrap' },
    h(
      'form',
      {
        class: 'card auth-card',
        onsubmit: (event: Event) => {
          event.preventDefault();
          void signIn();
        },
      },
      h('h1', { text: 'VaultSync for Agents' }),
      h('p', { class: 'auth-sub' }, 'This worker is claimed. Sign in with the admin passphrase.'),
      field('Admin passphrase', passphrase),
      errorLine,
      h('div', { class: 'form-actions' }, submit),
    ),
  );

  async function signIn(): Promise<void> {
    errorLine.textContent = '';
    submit.disabled = true;
    submit.textContent = 'Signing in…';
    try {
      await api.adminLogin(passphrase.value);
      ctx.dispatch({ type: 'network-ok' });
      ctx.dispatch({ type: 'login-ok' });
    } catch (error) {
      submit.disabled = false;
      submit.textContent = 'Sign in';
      if (error instanceof ApiError) {
        if (error.kind === 'unauthorized') {
          errorLine.textContent = 'Wrong passphrase — try again.';
        } else if (error.kind === 'unclaimed') {
          ctx.dispatch({ type: 'unclaimed' });
        } else if (error.kind === 'network') {
          ctx.dispatch({ type: 'network-error' });
          errorLine.textContent = 'Cannot reach the server — check your connection.';
        } else {
          errorLine.textContent = error.message;
        }
      } else {
        errorLine.textContent = 'Unexpected error — try again.';
      }
    }
  }

  return { root };
}
