/**
 * The pair flow shared by the settings form and the `obsidian://` deep link
 * (ARCHITECTURE §3): probe `GET /health` first — an *unclaimed* worker gets
 * friendly onboarding guidance instead of a cryptic 421 — then `POST /pair`
 * and hand the credentials back to be persisted.
 */

import {
  fetchHealth,
  normalizeWorkerUrl,
  requestPair,
  PairRejectedError,
  UnclaimedWorkerError,
  WorkerApiError,
} from './workerapi.js';

export type PairOutcome =
  | { status: 'paired'; url: string; token: string; deviceId: string }
  | { status: 'unclaimed'; url: string; guidance: string }
  | { status: 'unreachable'; url: string; reason: string }
  | { status: 'rejected'; url: string; reason: string }
  | { status: 'invalid-url'; input: string };

export interface PairFlowParams {
  /** Worker URL as typed / deep-linked (schemeless is tolerated). */
  url: string;
  /** One-time pairing code from the worker dashboard. */
  code: string;
  deviceName: string;
  deviceType: 'desktop' | 'mobile';
  fetchImpl: typeof fetch;
}

/** Onboarding text shown when the worker is deployed but not claimed. */
export function unclaimedGuidance(url: string): string {
  return [
    `The worker at ${url} is deployed but not claimed yet. Finish setup in a browser:`,
    '',
    `1. Open ${url}`,
    '2. Set the admin passphrase and name the vault (the claim page).',
    '3. On the dashboard, create a pairing code (Devices → Pair new device).',
    '4. Enter that code here (or click the obsidian:// link the dashboard shows) and pair.',
  ].join('\n');
}

/**
 * Run the pair flow. Never throws — every failure mode is a typed outcome the
 * UI can render (and the deep-link handler can turn into a Notice).
 */
export async function pairWithWorker(params: PairFlowParams): Promise<PairOutcome> {
  let origin: string;
  try {
    origin = normalizeWorkerUrl(params.url);
  } catch {
    return { status: 'invalid-url', input: params.url };
  }

  const health = await fetchHealth(origin, params.fetchImpl);
  if (!health.reachable) {
    return {
      status: 'unreachable',
      url: origin,
      reason:
        `${health.reason ?? 'unknown error'} — check the URL, your network, and that the ` +
        'worker is deployed.',
    };
  }
  if (!health.claimed) {
    return { status: 'unclaimed', url: origin, guidance: unclaimedGuidance(origin) };
  }

  try {
    const credentials = await requestPair({
      origin,
      code: params.code,
      deviceName: params.deviceName,
      deviceType: params.deviceType,
      fetchImpl: params.fetchImpl,
    });
    return { status: 'paired', url: origin, ...credentials };
  } catch (error) {
    if (error instanceof UnclaimedWorkerError) {
      return { status: 'unclaimed', url: origin, guidance: unclaimedGuidance(origin) };
    }
    if (error instanceof PairRejectedError) {
      return { status: 'rejected', url: origin, reason: error.message };
    }
    const reason = error instanceof Error ? error.message : String(error);
    return { status: 'rejected', url: origin, reason };
  }
}

/** Render any outcome as user-facing text (Notices, deep-link feedback). */
export function pairOutcomeMessage(outcome: PairOutcome): string {
  switch (outcome.status) {
    case 'paired':
      return `Paired with ${outcome.url} — syncing now.`;
    case 'unclaimed':
      return outcome.guidance;
    case 'unreachable':
      return `Could not reach the worker: ${outcome.reason}`;
    case 'rejected':
      return `Pairing failed: ${outcome.reason}`;
    case 'invalid-url':
      return `That does not look like a worker URL: ${JSON.stringify(outcome.input)}`;
  }
}
