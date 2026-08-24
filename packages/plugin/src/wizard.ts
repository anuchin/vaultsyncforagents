/**
 * The in-app setup wizard's orchestration (FR-21's promise, minus GitHub):
 * one vault name in, one live worker URL out. Sequences the Cloudflare REST
 * client and the bundle download/verify into the deploy pipeline
 *
 *   verify token → resolve account → derive names → ensure the R2 bucket →
 *   download + verify the pinned release bundle → upload dashboard assets →
 *   upload the worker (bindings + DO migration) → schedule the weekly GC →
 *   resolve the workers.dev URL → probe /health.
 *
 * Every network touch rides injected seams (`fetchImpl`, deterministic
 * `random`) — tests drive the whole pipeline against a fake Cloudflare.
 * The API token is a parameter, never a return value or persisted state:
 * the wizard uses it for this deploy and drops it.
 */

import { deriveBucketName, deriveWorkerName, randomSuffix, RELEASE_BUNDLE_URL } from '@vsa/core';
import { downloadWorkerBundle, extractBundle } from './bundle.js';
import {
  bucketExists,
  createBucket,
  getWorkersDevUrl,
  listAccounts,
  putSchedules,
  uploadAssets,
  uploadWorker,
  verifyApiToken,
  type CloudflareAccountInfo,
} from './cloudflare-deploy.js';

/** The token is valid but the account must be chosen explicitly. */
export class MultipleAccountsError extends Error {
  constructor(readonly accounts: CloudflareAccountInfo[]) {
    super(
      `this Cloudflare token can see ${accounts.length} accounts — pick the one to deploy into`,
    );
    this.name = 'MultipleAccountsError';
  }
}

export interface WizardDeps {
  /** Injectable fetch (tests). Defaults to the global. */
  fetchImpl?: typeof fetch;
  /** Deterministic suffix source (tests). */
  random?: () => number;
  /** Bundle-digest override (tests); defaults to the pinned release digest. */
  pinnedBundleSha256?: string;
}

export interface DeployWorkerParams {
  /** What the user calls the vault — becomes the worker/bucket name slug. */
  vaultName: string;
  /** Cloudflare API token; used for this deploy only, never persisted. */
  token: string;
  /** Account to deploy into — required when the token sees more than one. */
  accountId?: string;
  /** Worker-name override (tests / power users); default is derived. */
  workerName?: string;
  /** Deterministic name suffix (tests). */
  suffix?: string;
}

export interface DeployWorkerResult {
  workerName: string;
  bucketName: string;
  accountId: string;
  /** `https://<worker>.<subdomain>.workers.dev` — open this to claim. */
  workerUrl: string;
  createdBucket: boolean;
  /** The post-deploy /health probe answered (false = propagation lag, not failure). */
  healthOk: boolean;
}

/** Human labels for the modal's progress lines, in pipeline order. */
export const WIZARD_STEPS = [
  'Verifying your Cloudflare token…',
  'Resolving your Cloudflare account…',
  'Naming your worker…',
  'Preparing storage (R2 bucket)…',
  'Downloading the VaultSync worker…',
  'Uploading the dashboard…',
  'Deploying your worker…',
  'Scheduling weekly maintenance…',
  'Resolving your worker URL…',
] as const;

/**
 * Token preflight shared by the wizard's first screen: throws on an invalid
 * token, returns the accounts (so the UI can offer a picker when needed).
 */
export async function prepareWizard(
  token: string,
  deps: WizardDeps = {},
): Promise<CloudflareAccountInfo[]> {
  await verifyApiToken(token, deps);
  return listAccounts(token, deps);
}

/** Run the full deploy pipeline. `onStep` receives the step label as it starts. */
export async function deployWorker(
  params: DeployWorkerParams,
  deps: WizardDeps = {},
  onStep: (step: string) => void = () => {},
): Promise<DeployWorkerResult> {
  const options = { fetchImpl: deps.fetchImpl };

  onStep(WIZARD_STEPS[0]);
  await verifyApiToken(params.token, options);

  onStep(WIZARD_STEPS[1]);
  const accounts = await listAccounts(params.token, options);
  if (accounts.length === 0) {
    throw new Error('this Cloudflare token can see no accounts — check its account permissions');
  }
  const account =
    params.accountId !== undefined
      ? accounts.find((a) => a.id === params.accountId)
      : accounts.length === 1
        ? accounts[0]
        : undefined;
  if (account === undefined) {
    if (accounts.length > 1) throw new MultipleAccountsError(accounts);
    throw new Error(`account ${params.accountId} is not visible to this Cloudflare token`);
  }

  onStep(WIZARD_STEPS[2]);
  const workerName =
    params.workerName ?? deriveWorkerName(params.vaultName, params.suffix ?? randomSuffix(deps.random));
  const bucketName = deriveBucketName(workerName);

  onStep(WIZARD_STEPS[3]);
  const existed = await bucketExists(params.token, account.id, bucketName, options);
  let createdBucket = false;
  if (!existed) {
    await createBucket(params.token, account.id, bucketName, options);
    createdBucket = true;
  }

  onStep(WIZARD_STEPS[4]);
  const zipBytes = await downloadWorkerBundle(RELEASE_BUNDLE_URL, {
    fetchImpl: deps.fetchImpl,
    pinnedSha256: deps.pinnedBundleSha256,
  });
  const { workerJs, assets } = await extractBundle(zipBytes);

  onStep(WIZARD_STEPS[5]);
  const assetsJwt = await uploadAssets(
    { token: params.token, accountId: account.id, scriptName: workerName, assets },
    options,
  );

  onStep(WIZARD_STEPS[6]);
  await uploadWorker(
    { token: params.token, accountId: account.id, scriptName: workerName, bucketName, workerJs, assetsJwt },
    options,
  );

  onStep(WIZARD_STEPS[7]);
  await putSchedules({ token: params.token, accountId: account.id, scriptName: workerName }, options);

  onStep(WIZARD_STEPS[8]);
  const workerUrl = await getWorkersDevUrl(
    { token: params.token, accountId: account.id, scriptName: workerName },
    options,
  );

  // Post-deploy sanity probe: a fresh workers.dev route can take a few
  // seconds to answer, so a miss is a warning, not a failure.
  let healthOk = false;
  try {
    const probe = await (deps.fetchImpl ?? globalThis.fetch.bind(globalThis))(`${workerUrl}/health`);
    healthOk = probe.ok && /"ok"\s*:\s*true/.test(await probe.text());
  } catch {
    healthOk = false;
  }

  return { workerName, bucketName, accountId: account.id, workerUrl, createdBucket, healthOk };
}
