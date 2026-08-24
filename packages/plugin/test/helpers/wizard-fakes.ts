/**
 * Shared fakes for the wizard suites (`wizard.test.ts`,
 * `wizard-modal.test.ts`): one routed fetch covering the three origins the
 * deploy pipeline touches (Cloudflare API, GitHub release download, the
 * deployed worker), the happy-path route table, and the in-memory bundle
 * zip — deterministic suffix and digest included.
 */

import { createHash } from 'node:crypto';
import { strToU8, zipSync } from 'fflate';
import { RELEASE_BUNDLE_URL } from '@vsa/core';
import { assetHash } from '../../src/cloudflare-deploy.js';
import type { WizardDeps } from '../../src/wizard.js';

export const WIZARD_TOKEN = 'cf-token';
export const WIZARD_ACCOUNT = 'acc-1';
export const WIZARD_SCRIPT = 'vaultsync-personal-abcd'; // slugify('Personal') + suffix 'abcd'
export const WIZARD_WORKER_URL = `https://${WIZARD_SCRIPT}.alice.workers.dev`;
export const BUNDLE_URL = RELEASE_BUNDLE_URL;

const INDEX = strToU8('<!doctype html><title>dashboard</title>');

export function bundleZip(): Uint8Array {
  return zipSync({
    'worker.js': strToU8('export { VaultRoom };\n'),
    'dashboard/': new Uint8Array(0),
    'dashboard/index.html': INDEX,
  });
}

export function bundleSha(): string {
  return createHash('sha256').update(bundleZip()).digest('hex');
}

export interface Routed {
  fetchImpl: typeof fetch;
  calls: Array<{ method: string; url: string }>;
}

/**
 * Fake covering all three origins. Keys are `METHOD path` with the origin
 * collapsed to a prefix: `cf:` (API), `gh:` (release), `worker:` (the
 * deployed worker). Unrouted requests throw (tests fail loudly).
 */
export function fakeWorld(routes: Record<string, () => unknown>): Routed {
  const calls: Array<{ method: string; url: string }> = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    calls.push({ method, url });
    const path = url
      .replace('https://api.cloudflare.com/client/v4', 'cf:')
      .replace('https://github.com', 'gh:')
      .replace(/^https:\/\/[a-z0-9.-]+\.workers\.dev/, 'worker:');
    const handler = routes[`${method} ${path}`];
    if (handler === undefined) throw new Error(`unrouted: ${method} ${path}`);
    const result = handler();
    if (result instanceof Response) return result;
    return Response.json(result);
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

const ok = (result: unknown) => ({ success: true, errors: [], result });

export function happyRoutes(): Record<string, () => unknown> {
  const zip = bundleZip();
  const hashIndex = assetHash(INDEX, 'index.html');
  return {
    'GET cf:/user/tokens/verify': () => ok({ status: 'active' }),
    'GET cf:/accounts': () => ok([{ id: WIZARD_ACCOUNT, name: 'Personal' }]),
    [`GET cf:/accounts/${WIZARD_ACCOUNT}/r2/buckets/${WIZARD_SCRIPT}`]: () =>
      Response.json(
        { success: false, errors: [{ code: 10004, message: 'not found' }], result: null },
        { status: 404 },
      ),
    [`POST cf:/accounts/${WIZARD_ACCOUNT}/r2/buckets`]: () => ok(null),
    [`POST cf:/accounts/${WIZARD_ACCOUNT}/workers/scripts/${WIZARD_SCRIPT}/assets-upload-session`]: () =>
      ok({ buckets: [[hashIndex]], jwt: 'session.jwt' }),
    [`POST cf:/accounts/${WIZARD_ACCOUNT}/workers/assets/upload?base64=true`]: () => ok({ jwt: 'completion.jwt' }),
    [`PUT cf:/accounts/${WIZARD_ACCOUNT}/workers/scripts/${WIZARD_SCRIPT}?excludeScript=true`]: () => ok({ id: 's' }),
    [`PUT cf:/accounts/${WIZARD_ACCOUNT}/workers/scripts/${WIZARD_SCRIPT}/schedules`]: () => ok([]),
    [`GET cf:/accounts/${WIZARD_ACCOUNT}/workers/subdomain`]: () => ok({ subdomain: 'alice' }),
    [`GET ` + 'gh:/' + RELEASE_BUNDLE_URL.replace('https://github.com/', '')]: () =>
      new Response(zip as unknown as BodyInit, { status: 200 }),
    'GET worker:/health': () => Response.json({ ok: true, claimed: false, serverVersion: '0.1.6' }),
  };
}

/** Deterministic wizard deps: counter random → suffix 'abcd', digest override. */
export function wizardDeps(fetchImpl: typeof fetch, pinnedBundleSha256: string = bundleSha()): WizardDeps {
  let draw = 0;
  // Draws land in alphabet buckets 0,1,2,3 → 'a','b','c','d' (the suffix
  // WIZARD_SCRIPT bakes in). bucket n = [n/32, (n+1)/32).
  const draws = [0, 0.05, 0.08, 0.11];
  return {
    fetchImpl,
    random: () => {
      const value = draws[draw] ?? draws[draws.length - 1] ?? 0;
      draw = Math.min(draw + 1, draws.length - 1);
      return value;
    },
    pinnedBundleSha256,
  };
}
