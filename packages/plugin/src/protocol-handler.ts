/**
 * `obsidian://vaultsyncforagents/pair?url=<worker>&code=<pairing>` deep-link
 * handling (ARCHITECTURE §3): the dashboard renders this link (and the QR
 * equivalent) so a new device pairs with zero typing.
 *
 * The handler is registered for the action `vaultsyncforagents`. Obsidian
 * builds differ subtly in how the `/pair` path segment of a protocol URL is
 * matched, so the same handler is registered for `vaultsyncforagents/pair`
 * too — whichever spelling a given build resolves, the link works. When
 * `url`/`code` are absent the invocation is ignored (a stray protocol hit
 * must not spam a Notice); a *malformed* pair link (one of the two present)
 * gets an actionable error.
 */

import { Notice } from 'obsidian';

/** Protocol action (the `obsidian://` "host" part). */
export const PROTOCOL_ACTION = 'vaultsyncforagents';

/** Handler shape (Obsidian passes its decoded query params). */
export type ProtocolHandler = (params: Record<string, unknown>) => void;

/** How handlers get registered — `Plugin.registerObsidianProtocolHandler`. */
export type ProtocolRegistrar = (action: string, handler: ProtocolHandler) => void;

/** Parsed pair deep link. */
export interface PairDeepLink {
  url: string;
  code: string;
}

export type DeepLinkParseResult =
  | { ok: true; link: PairDeepLink }
  | { ok: false; error: string };

/**
 * Extract `{url, code}` from Obsidian's decoded query params. Values arrive
 * as strings (usually already decoded; a double-encoded `%xx` remnant is
 * decoded once more, best effort).
 */
export function parsePairDeepLink(params: Record<string, unknown>): DeepLinkParseResult {
  const url = paramText(params, 'url');
  const code = paramText(params, 'code');
  if (url === '' && code === '') {
    return { ok: false, error: 'no pairing parameters' };
  }
  if (url === '') return { ok: false, error: 'deep link is missing the worker URL (?url=…)' };
  if (code === '') return { ok: false, error: 'deep link is missing the pairing code (?code=…)' };
  return { ok: true, link: { url, code } };
}

function paramText(params: Record<string, unknown>, key: string): string {
  const value = params[key];
  if (typeof value === 'number') return String(value);
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  // Obsidian hands over decoded values; tolerate one surviving round of
  // percent-encoding from over-eager link generators.
  if (trimmed.includes('%')) {
    try {
      return decodeURIComponent(trimmed);
    } catch {
      return trimmed;
    }
  }
  return trimmed;
}

/**
 * Register the pair deep-link handler (call from `onload` with the plugin's
 * own registrar). `onPair` runs the shared pair flow (settings + Notices
 * live in the plugin); its errors are logged, never fatal.
 */
export function registerPairProtocolHandler(
  register: ProtocolRegistrar,
  onPair: (link: PairDeepLink) => Promise<void>,
): void {
  const handler: ProtocolHandler = (params) => {
    const parsed = parsePairDeepLink(params);
    if (!parsed.ok) {
      // Missing both → a bare obsidian://vaultsyncforagents hit; stay quiet.
      if (parsed.error !== 'no pairing parameters') {
        new Notice(`VaultSync deep link: ${parsed.error}`);
      }
      return;
    }
    void onPair(parsed.link).catch((error: unknown) => {
      console.error('[vsa] deep-link pairing failed', error);
      new Notice('VaultSync: pairing via link failed — see the console for details.');
    });
  };
  register(PROTOCOL_ACTION, handler);
  // Register the path-spelled action too (build-dependent matching).
  register(`${PROTOCOL_ACTION}/pair`, handler);
}
