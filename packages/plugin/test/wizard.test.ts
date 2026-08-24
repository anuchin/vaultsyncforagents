/**
 * `src/wizard.ts` — the deploy pipeline end to end against a faked network
 * (see `helpers/wizard-fakes.ts`): the full happy path, the multi-account
 * detour, token failure, the existing-bucket shortcut, and the integrity
 * gate refusing a tampered bundle before anything is deployed.
 */

import { describe, expect, it } from 'vitest';
import { deployWorker, prepareWizard, WIZARD_STEPS } from '../src/wizard.js';
import {
  BUNDLE_URL,
  WIZARD_ACCOUNT,
  WIZARD_SCRIPT,
  WIZARD_TOKEN,
  WIZARD_WORKER_URL,
  bundleSha,
  fakeWorld,
  happyRoutes,
  wizardDeps,
} from './helpers/wizard-fakes.js';

describe('deployWorker', () => {
  it('runs the full pipeline and reports every step in order', async () => {
    const world = fakeWorld(happyRoutes());
    const steps: string[] = [];
    const result = await deployWorker(
      { vaultName: 'Personal', token: WIZARD_TOKEN },
      wizardDeps(world.fetchImpl),
      (step) => steps.push(step),
    );

    expect(result.workerName).toBe(WIZARD_SCRIPT);
    expect(result.bucketName).toBe(WIZARD_SCRIPT);
    expect(result.accountId).toBe(WIZARD_ACCOUNT);
    expect(result.workerUrl).toBe(WIZARD_WORKER_URL);
    expect(result.createdBucket).toBe(true);
    expect(result.healthOk).toBe(true);
    expect(steps).toEqual([...WIZARD_STEPS]);

    // Pipeline shape: bucket probed then created, script PUT, schedules PUT.
    // (API paths keep their /client/v4 prefix after the origin strip.)
    const urls = world.calls.map((c) =>
      `${c.method} ${c.url.replace(/^https:\/\/[^/]+\/client\/v4/, '').replace(/^https:\/\/[^/]+/, '')}`,
    );
    expect(urls).toContain(`GET /accounts/${WIZARD_ACCOUNT}/r2/buckets/${WIZARD_SCRIPT}`);
    expect(urls).toContain(`POST /accounts/${WIZARD_ACCOUNT}/r2/buckets`);
    expect(urls).toContain(`PUT /accounts/${WIZARD_ACCOUNT}/workers/scripts/${WIZARD_SCRIPT}?excludeScript=true`);
    expect(urls).toContain(`PUT /accounts/${WIZARD_ACCOUNT}/workers/scripts/${WIZARD_SCRIPT}/schedules`);
    expect(urls.find((u) => u.endsWith('/health'))).toBe('GET /health');
  });

  it('skips bucket creation when the bucket already exists', async () => {
    const routes = happyRoutes();
    routes[`GET cf:/accounts/${WIZARD_ACCOUNT}/r2/buckets/${WIZARD_SCRIPT}`] = () => ({
      success: true,
      errors: [],
      result: { name: WIZARD_SCRIPT },
    });
    const world = fakeWorld(routes);
    const result = await deployWorker(
      { vaultName: 'Personal', token: WIZARD_TOKEN },
      wizardDeps(world.fetchImpl),
    );
    expect(result.createdBucket).toBe(false);
    expect(
      world.calls.some((c) => c.url.endsWith('/r2/buckets') && c.method === 'POST'),
    ).toBe(false);
  });

  it('refuses a tampered bundle (integrity gate inside the pipeline)', async () => {
    const world = fakeWorld(happyRoutes());
    await expect(
      deployWorker(
        { vaultName: 'Personal', token: WIZARD_TOKEN },
        wizardDeps(world.fetchImpl, '0'.repeat(64)),
      ),
    ).rejects.toThrow(/integrity check FAILED/);
    // Nothing was ever deployed.
    expect(
      world.calls.some((c) => c.method === 'PUT' && c.url.includes('/workers/scripts/')),
    ).toBe(false);
  });

  it('throws MultipleAccountsError for a multi-account token without a pick', async () => {
    const routes = happyRoutes();
    routes['GET cf:/accounts'] = () => ({
      success: true,
      errors: [],
      result: [
        { id: 'a1', name: 'One' },
        { id: 'a2', name: 'Two' },
      ],
    });
    const world = fakeWorld(routes);
    await expect(
      deployWorker({ vaultName: 'Personal', token: WIZARD_TOKEN }, wizardDeps(world.fetchImpl)),
    ).rejects.toThrow(/2 accounts/);
  });

  it('deploys into the explicitly chosen account', async () => {
    const routes = happyRoutes();
    routes['GET cf:/accounts'] = () => ({
      success: true,
      errors: [],
      result: [
        { id: 'a1', name: 'One' },
        { id: 'a2', name: 'Two' },
      ],
    });
    // The a2 account: bucket already exists, everything else runs there.
    routes[`GET cf:/accounts/a2/r2/buckets/${WIZARD_SCRIPT}`] = () => ({
      success: true,
      errors: [],
      result: { name: WIZARD_SCRIPT },
    });
    routes[`POST cf:/accounts/a2/workers/scripts/${WIZARD_SCRIPT}/assets-upload-session`] = () => ({
      success: true,
      errors: [],
      result: { buckets: [], jwt: 'session.jwt' },
    });
    routes[`PUT cf:/accounts/a2/workers/scripts/${WIZARD_SCRIPT}?excludeScript=true`] = () => ({
      success: true,
      errors: [],
      result: { id: 's' },
    });
    routes[`PUT cf:/accounts/a2/workers/scripts/${WIZARD_SCRIPT}/schedules`] = () => ({
      success: true,
      errors: [],
      result: [],
    });
    routes[`GET cf:/accounts/a2/workers/subdomain`] = () => ({
      success: true,
      errors: [],
      result: { subdomain: 'alice' },
    });

    const world = fakeWorld(routes);
    const result = await deployWorker(
      { vaultName: 'Personal', token: WIZARD_TOKEN, accountId: 'a2' },
      wizardDeps(world.fetchImpl),
    );
    expect(result.accountId).toBe('a2');
    expect(result.workerUrl).toBe(WIZARD_WORKER_URL);
  });

  it('surfaces an invalid token before touching anything else', async () => {
    const routes = happyRoutes();
    routes['GET cf:/user/tokens/verify'] = () =>
      Response.json(
        { success: false, errors: [{ code: 1000, message: 'Invalid API Token' }], result: null },
        { status: 400 },
      );
    const world = fakeWorld(routes);
    await expect(
      deployWorker({ vaultName: 'Personal', token: WIZARD_TOKEN }, wizardDeps(world.fetchImpl)),
    ).rejects.toThrow(/Invalid API Token/);
    expect(world.calls).toHaveLength(1);
  });

  it('downloads the pinned release URL', async () => {
    const world = fakeWorld(happyRoutes());
    await deployWorker({ vaultName: 'Personal', token: WIZARD_TOKEN }, wizardDeps(world.fetchImpl));
    expect(world.calls.some((c) => c.method === 'GET' && c.url === BUNDLE_URL)).toBe(true);
  });
});

describe('prepareWizard', () => {
  it('returns the accounts for the picker', async () => {
    const routes = happyRoutes();
    routes['GET cf:/accounts'] = () => ({
      success: true,
      errors: [],
      result: [
        { id: 'a1', name: 'One' },
        { id: 'a2', name: 'Two' },
      ],
    });
    const world = fakeWorld(routes);
    await expect(prepareWizard(WIZARD_TOKEN, wizardDeps(world.fetchImpl))).resolves.toHaveLength(2);
  });
});
