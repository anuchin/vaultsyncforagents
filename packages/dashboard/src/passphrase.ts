/**
 * Pure model for the admin passphrase-change form (the status view's "Admin"
 * card): inline validation mirroring the worker's claim rule (min 4 chars)
 * and the open/submit/notice lifecycle as a tiny reducer — same DOM-free
 * philosophy as rows.ts, unit-testable in the plain node pool.
 *
 * The wire call is `api.adminPassphraseChange`. On success the server has
 * ALREADY rotated the session secret and set a fresh cookie on this tab;
 * every OTHER tab's cookie dies and collapses to the login view via the app
 * state machine's existing `unauthorized` transition (state.ts).
 */

export interface PassphraseChangeInput {
  current: string;
  next: string;
  confirm: string;
}

/**
 * Inline validation; returns the error to show, or null when the form may be
 * submitted. The server re-validates `next` (min 4 chars) — this is UX, not
 * the enforcement point. `next === current` is deliberately ALLOWED (the
 * server still rotates salt + session secret).
 */
export function validatePassphraseChange(input: PassphraseChangeInput): string | null {
  if (input.current.length === 0) return 'Enter your current passphrase.';
  if (input.next.length < 4) return 'New passphrase must be at least 4 characters.';
  if (input.next !== input.confirm) return 'New passphrases do not match.';
  return null;
}

// --- form lifecycle --------------------------------------------------------------------------

export type PassphraseFormState =
  | { phase: 'closed' }
  | { phase: 'editing'; error: string | null }
  | { phase: 'submitting' }
  | { phase: 'success'; notice: string };

export type PassphraseFormEvent =
  /** The "Change admin passphrase" toggle was pressed. */
  | { type: 'open' }
  /** The user cancelled / dismissed the notice. */
  | { type: 'cancel' }
  | { type: 'dismissed' }
  /** Local validation failed (stay open, show the error). */
  | { type: 'validation-failed'; error: string }
  /** The POST went out (form locked while in flight). */
  | { type: 'submit' }
  /** The server accepted the rotation — show the notice. */
  | { type: 'succeeded' }
  /** The server rejected it (wrong current, throttle, …) — back to editing. */
  | { type: 'failed'; error: string }
  /** Hard reset (stale session collapse, view dispose). */
  | { type: 'reset' };

/** Notice shown after a successful rotation (the acting admin stays signed in). */
export const PASSPHRASE_CHANGED_NOTICE =
  'Passphrase changed — other admin sessions were signed out. Devices keep syncing.';

export const INITIAL_PASSPHRASE_FORM: PassphraseFormState = { phase: 'closed' };

export function reducePassphraseForm(
  state: PassphraseFormState,
  event: PassphraseFormEvent,
): PassphraseFormState {
  switch (event.type) {
    case 'open':
      return { phase: 'editing', error: null };
    case 'cancel':
    case 'dismissed':
    case 'reset':
      return INITIAL_PASSPHRASE_FORM;
    case 'submit':
      return { phase: 'submitting' };
    case 'validation-failed':
    case 'failed':
      return { phase: 'editing', error: event.error };
    case 'succeeded':
      return { phase: 'success', notice: PASSPHRASE_CHANGED_NOTICE };
    default: {
      // Exhaustiveness guard (noFallthroughCasesInSwitch + never default).
      const exhaustive: never = event;
      return exhaustive;
    }
  }
}

// --- render model ----------------------------------------------------------------------------

/** What the DOM layer renders for each phase — the view stays a dumb mapper. */
export interface PassphraseFormViewModel {
  formVisible: boolean;
  errorText: string | null;
  noticeText: string | null;
  submitDisabled: boolean;
  submitLabel: string;
}

export function passphraseFormView(state: PassphraseFormState): PassphraseFormViewModel {
  switch (state.phase) {
    case 'closed':
      return {
        formVisible: false,
        errorText: null,
        noticeText: null,
        submitDisabled: false,
        submitLabel: 'Change passphrase',
      };
    case 'editing':
      return {
        formVisible: true,
        errorText: state.error,
        noticeText: null,
        submitDisabled: false,
        submitLabel: 'Change passphrase',
      };
    case 'submitting':
      return {
        formVisible: true,
        errorText: null,
        noticeText: null,
        submitDisabled: true,
        submitLabel: 'Changing…',
      };
    case 'success':
      return {
        formVisible: false,
        errorText: null,
        noticeText: state.notice,
        submitDisabled: false,
        submitLabel: 'Change passphrase',
      };
  }
}
