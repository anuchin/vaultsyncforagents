/**
 * `vsa setup` (FR-50): the deploy flow against a fake CloudflareControl —
 * naming (slugify/suffix), the generated wrangler.jsonc, whoami states
 * (logged in / not / expired / multi-account), login detour, R2 bucket
 * exists/missing/create-race, deploy success + URL parse + failure,
 * the API-token REST path (env plumbing), bundle download vs local copy,
 * browser-open dispatch, and non-interactive refusals. No real Cloudflare,
 * no real npx, no real network.
 */

import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { VsRuntime } from '../src/runtime.js';
import { CommandError } from '../src/runtime.js';
import { ConfigStore } from '@vsa/node-runtime';
import { browserOpenCommand, parseWhoami } from '../src/cloudflare.js';
import type {
  CloudflareControl,
  ExecResult,
  RestAccount,
  WhoamiInfo,
} from '../src/cloudflare.js';
import {
  deriveWorkerName,
  parseDeployUrl,
  randomSuffix,
  renderWranglerConfig,
  runSetup,
  slugify,
  PINNED_RELEASE,
} from '../src/commands/setup.js';
import { OutputCapture, ScriptedPrompts } from './helpers.js';

// --- fakes ----------------------------------------------------------------------------------

interface Call {
  op: string;
  arg?: string;
  cwd?: string;
  env?: Record<string, string>;
}

const ok = (stdout = ''): ExecResult => ({ code: 0, stdout, stderr: '' });
const fail = (stderr: string, code = 1): ExecResult => ({ code, stdout: '', stderr });

class FakeCloudflare implements CloudflareControl {
  readonly calls: Call[] = [];
  /** Popped per whoami() call; defaults to a logged-in single account. */
  whoamiQueue: WhoamiInfo[] = [
    {
      status: 'ok',
      accounts: [
        { id: 'acc-1', name: 'Personal' },
      ],
    },
  ];
  loginResult: ExecResult = ok();
  bucketInfoResult: ExecResult = ok('{}');
  bucketCreateResult: ExecResult = ok('Created bucket');
  deployResult: ExecResult = ok(
    'Total Upload: 25.14 KiB / gzip: 6.18 KiB\nUploaded vaultsync-personal (1.2 sec)\n' +
      '  Deployed vaultsync-personal triggers (0.4 sec)\n' +
      '    https://vaultsync-personal-x7q2.jitu.workers.dev\n',
  );
  downloadBytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04]);
  downloadUrls: string[] = [];
  restAccounts: RestAccount[] | { httpStatus: number } = [
    { id: 'acc-1', name: 'Personal' },
  ];
  openBrowserResult: ExecResult = ok();
  readonly openedUrls: string[] = [];

  private record(call: Call): void {
    this.calls.push(call);
  }

  async whoami(env?: Record<string, string>): Promise<WhoamiInfo> {
    this.record({ op: 'whoami', env });
    const next = this.whoamiQueue.shift();
    if (next === undefined) throw new Error('whoami called more times than scripted');
    return next;
  }
  async login(): Promise<ExecResult> {
    this.record({ op: 'login' });
    return this.loginResult;
  }
  async bucketInfo(name: string, env?: Record<string, string>): Promise<ExecResult> {
    this.record({ op: 'bucketInfo', arg: name, env });
    return this.bucketInfoResult;
  }
  async bucketCreate(name: string, env?: Record<string, string>): Promise<ExecResult> {
    this.record({ op: 'bucketCreate', arg: name, env });
    return this.bucketCreateResult;
  }
  async deploy(cwd: string, env?: Record<string, string>): Promise<ExecResult> {
    this.record({ op: 'deploy', cwd, env });
    return this.deployResult;
  }
  async download(url: string): Promise<Uint8Array> {
    this.record({ op: 'download', arg: url });
    this.downloadUrls.push(url);
    return this.downloadBytes;
  }
  async restListAccounts(token: string): Promise<RestAccount[]> {
    this.record({ op: 'restListAccounts', arg: token });
    if ('httpStatus' in this.restAccounts) {
      throw new Error('Cloudflare rejected the API token — check that it is valid and not expired');
    }
    return this.restAccounts;
  }
  async extractZip(zipPath: string, destDir: string, env?: Record<string, string>): Promise<ExecResult> {
    this.record({ op: 'extractZip', arg: zipPath, cwd: destDir, env });
    return ok();
  }
  async openBrowser(url: string): Promise<ExecResult> {
    this.record({ op: 'openBrowser', arg: url });
    this.openedUrls.push(url);
    return this.openBrowserResult;
  }
}

interface SetupRig {
  runtime: VsRuntime;
  output: OutputCapture;
  prompts: ScriptedPrompts;
  fake: FakeCloudflare;
  dir: string;
  setup(extra?: Partial<Parameters<typeof runSetup>[1]>): ReturnType<typeof runSetup>;
}

async function makeSetupRig(options: { whoami?: WhoamiInfo[] } = {}): Promise<SetupRig> {
  const dir = await mkdtemp(join(tmpdir(), 'vsa-setup-'));
  const configStore = new ConfigStore({ configPath: join(dir, 'config.json') });
  const output = new OutputCapture();
  const prompts = new ScriptedPrompts();
  const runtime: VsRuntime = { configStore, fetchImpl: fetch, now: () => 1_735_100_000_000, output, prompts };
  const fake = new FakeCloudflare();
  if (options.whoami !== undefined) fake.whoamiQueue = [...options.whoami];
  return {
    runtime,
    output,
    prompts,
    fake,
    dir,
    setup: (extra = {}) =>
      runSetup(runtime, { vaultName: 'Personal Notes', suffix: 'x7q2', dir: join(dir, 'deploy'), open: false, ...extra }, fake),
  };
}

const notLoggedIn: WhoamiInfo = { status: 'not-logged-in', accounts: [] };
const expired: WhoamiInfo = { status: 'expired', accounts: [] };

// --- naming + pure helpers -------------------------------------------------------------------

describe('naming and config generation', () => {
  it('slugify: lowercase, collapse separators, trim, cap at 32', () => {
    expect(slugify('Personal Notes')).toBe('personal-notes');
    expect(slugify('  My *Vault* #2!! ')).toBe('my-vault-2');
    expect(slugify('Ünïcode Äccepts')).toBe('unicode-accepts');
    expect(slugify('---')).toBe('vault');
    expect(slugify('a'.repeat(50)).length).toBeLessThanOrEqual(32);
  });

  it('deriveWorkerName: vaultsync-<slug>-<suffix>', () => {
    expect(deriveWorkerName('Personal Notes', 'x7q2')).toBe('vaultsync-personal-notes-x7q2');
  });

  it('randomSuffix: 4 chars from the unambiguous alphabet', () => {
    const suffix = randomSuffix(() => 0.5);
    expect(suffix).toMatch(/^[a-z0-9]{4}$/);
  });

  it('renderWranglerConfig: mirrors the worker bindings (snapshot)', () => {
    const text = renderWranglerConfig({ workerName: 'vaultsync-personal-x7q2', bucketName: 'vaultsync-personal-x7q2' });
    expect(text).toContain('"name": "vaultsync-personal-x7q2"');
    expect(text).toContain('"main": "./dist/worker.js"');
    expect(text).toContain('"compatibility_date": "2026-08-01"');
    expect(text).toContain('"class_name": "VaultRoom"');
    expect(text).toContain('"new_sqlite_classes": ["VaultRoom"]');
    expect(text).toContain('"binding": "BUCKET"');
    expect(text).toContain('"bucket_name": "vaultsync-personal-x7q2"');
    expect(text).toContain('"crons": ["0 3 * * 1"]');
    // Dashboard assets binding mirrors packages/worker/wrangler.jsonc.
    expect(text).toContain('"directory": "./dist/dashboard"');
    expect(text).toContain('"binding": "ASSETS"');
    expect(text).toContain('"not_found_handling": "single-page-application"');
    expect(text).toContain('"run_worker_first": true');
    expect(text).toMatchSnapshot();
  });

  it('parseDeployUrl: first workers.dev URL, null when absent', () => {
    expect(parseDeployUrl('noise\nhttps://a-b.workers.dev\nmore')).toBe('https://a-b.workers.dev');
    expect(parseDeployUrl('no url here')).toBeNull();
  });

  it('parseWhoami: logged in with accounts', () => {
    const info = parseWhoami(
      '{"auth_type":"OAuth","email":"x@y.z","accounts":[{"id":"acc-1","name":"Personal"}],"scopes":["account:read"]}',
      0,
    );
    expect(info.status).toBe('ok');
    expect(info.accounts).toEqual([{ id: 'acc-1', name: 'Personal' }]);
  });

  it('parseWhoami: not logged in (non-zero exit, no auth payload)', () => {
    expect(parseWhoami('not logged in', 1).status).toBe('not-logged-in');
    expect(parseWhoami('{"message":"not logged in"}', 1).status).toBe('not-logged-in');
  });

  it('parseWhoami: expired token marker', () => {
    const info = parseWhoami('{"auth_error":"Your token has expired"}', 1);
    expect(info.status).toBe('expired');
  });

  it('parseWhoami: tolerant account field variants', () => {
    const info = parseWhoami('wrangler 4.x\n{"accounts":[{"account_id":"acc-9","accountName":"Work"}]}', 0);
    expect(info.accounts).toEqual([{ id: 'acc-9', name: 'Work' }]);
  });
});

// --- browser dispatch ------------------------------------------------------------------------

describe('browserOpenCommand', () => {
  it('Windows uses cmd /c start (empty title arg), unix uses open/xdg-open', () => {
    expect(browserOpenCommand('win32', 'https://x')).toEqual({ command: 'cmd', args: ['/c', 'start', '', 'https://x'] });
    expect(browserOpenCommand('darwin', 'https://x')).toEqual({ command: 'open', args: ['https://x'] });
    expect(browserOpenCommand('linux', 'https://x')).toEqual({ command: 'xdg-open', args: ['https://x'] });
  });
});

// --- the flow ----------------------------------------------------------------------------------

describe('runSetup', () => {
  it('happy path (wrangler OAuth): deploys, writes config + bundle, prints the claim walkthrough', async () => {
    const rig = await makeSetupRig();
    const result = await rig.setup();

    expect(result.workerName).toBe('vaultsync-personal-notes-x7q2');
    expect(result.bucketName).toBe('vaultsync-personal-notes-x7q2');
    expect(result.workerUrl).toBe('https://vaultsync-personal-x7q2.jitu.workers.dev');
    expect(result.accountId).toBe('acc-1');
    expect(result.createdBucket).toBe(false);

    // Sequence: whoami → download → extract → bucketInfo → deploy.
    expect(rig.fake.calls.map((call) => call.op)).toEqual([
      'whoami',
      'download',
      'extractZip',
      'bucketInfo',
      'deploy',
    ]);

    // The deploy directory got the bundle + the generated config.
    const deployDir = result.deployDir;
    expect(await readFile(join(deployDir, 'wrangler.jsonc'), 'utf8')).toContain(
      '"name": "vaultsync-personal-notes-x7q2"',
    );
    expect(new Uint8Array(await readFile(join(deployDir, 'worker-bundle.zip')))).toEqual(
      rig.fake.downloadBytes,
    );

    // Downloaded the pinned release.
    expect(rig.fake.downloadUrls).toEqual([
      `https://github.com/anuchin/vaultsyncforagents/releases/download/${PINNED_RELEASE}/worker-bundle.zip`,
    ]);

    // The walkthrough: URL → claim → pairing code → vsa link.
    const text = rig.output.text();
    expect(text).toContain('https://vaultsync-personal-x7q2.jitu.workers.dev');
    expect(text).toContain('CLAIMS the worker');
    expect(text).toContain('vsa link --url');
  });

  it('not logged in: confirm → wrangler login → whoami again → proceeds', async () => {
    const rig = await makeSetupRig({
      whoami: [notLoggedIn, { status: 'ok', accounts: [{ id: 'acc-1', name: 'Personal' }] }],
    });
    rig.prompts.script(true, /log in to Cloudflare now\?/);
    const result = await rig.setup();

    expect(rig.fake.calls.map((call) => call.op)).toEqual([
      'whoami',
      'login',
      'whoami',
      'download',
      'extractZip',
      'bucketInfo',
      'deploy',
    ]);
    expect(result.workerUrl).toContain('.workers.dev');
  });

  it('not logged in: user declines the browser login → cancelled', async () => {
    const rig = await makeSetupRig({ whoami: [notLoggedIn] });
    rig.prompts.script(false, /log in to Cloudflare now\?/);
    await expect(rig.setup()).rejects.toThrow(/cancelled/);
    expect(rig.fake.calls.map((call) => call.op)).toEqual(['whoami']);
  });

  it('not logged in without a TTY: points at wrangler login / --api-token', async () => {
    const rig = await makeSetupRig({ whoami: [notLoggedIn] });
    rig.runtime.prompts = null;
    await expect(rig.setup()).rejects.toThrow(/npx wrangler login|--api-token/);
  });

  it('login command fails: surfaces the wrangler error', async () => {
    const rig = await makeSetupRig({ whoami: [notLoggedIn] });
    rig.fake.loginResult = fail('could not open browser');
    rig.prompts.script(true, /log in to Cloudflare now\?/);
    await expect(rig.setup()).rejects.toThrow(/wrangler login failed.*could not open browser/);
  });

  it('still not authenticated after login: refuses to guess', async () => {
    const rig = await makeSetupRig({ whoami: [notLoggedIn, notLoggedIn] });
    rig.prompts.script(true, /log in to Cloudflare now\?/);
    await expect(rig.setup()).rejects.toThrow(/still not authenticated/);
  });

  it('expired wrangler login: treated as login-needed', async () => {
    const rig = await makeSetupRig({
      whoami: [expired, { status: 'ok', accounts: [{ id: 'acc-1', name: 'Personal' }] }],
    });
    rig.prompts.script(true, /log in to Cloudflare now\?/);
    const result = await rig.setup();
    expect(result.accountId).toBe('acc-1');
    expect(rig.output.warnings.join('\n')).toMatch(/expired/);
  });

  it('multiple accounts: interactive select picks one', async () => {
    const rig = await makeSetupRig({
      whoami: [
        {
          status: 'ok',
          accounts: [
            { id: 'acc-1', name: 'Personal' },
            { id: 'acc-2', name: 'Work' },
          ],
        },
      ],
    });
    rig.prompts.script('acc-2', /Which Cloudflare account/);
    const result = await rig.setup();
    expect(result.accountId).toBe('acc-2');
  });

  it('multiple accounts non-interactive without --account-id: lists them and fails', async () => {
    const rig = await makeSetupRig({
      whoami: [
        {
          status: 'ok',
          accounts: [
            { id: 'acc-1', name: 'Personal' },
            { id: 'acc-2', name: 'Work' },
          ],
        },
      ],
    });
    rig.runtime.prompts = null;
    await expect(rig.setup()).rejects.toThrow(/--account-id.*Work \(acc-2\)/s);
  });

  it('--account-id picks that account and skips prompting', async () => {
    const rig = await makeSetupRig({
      whoami: [
        {
          status: 'ok',
          accounts: [
            { id: 'acc-1', name: 'Personal' },
            { id: 'acc-2', name: 'Work' },
          ],
        },
      ],
    });
    const result = await rig.setup({ accountId: 'acc-2' });
    expect(result.accountId).toBe('acc-2');
    expect(rig.prompts.asked).toHaveLength(0);
  });

  it('bucket missing: creates it (createdBucket true)', async () => {
    const rig = await makeSetupRig();
    rig.fake.bucketInfoResult = fail('bucket not found');
    const result = await rig.setup();
    expect(result.createdBucket).toBe(true);
    expect(rig.fake.calls.map((call) => call.op)).toContain('bucketCreate');
    expect(rig.output.text()).toContain('creating it');
  });

  it('bucket create loses a race ("already exists"): reuses silently', async () => {
    const rig = await makeSetupRig();
    rig.fake.bucketInfoResult = fail('bucket not found');
    rig.fake.bucketCreateResult = fail(
      'Publication failed, bucket name is already taken (10004)',
    );
    const result = await rig.setup();
    expect(result.createdBucket).toBe(false);
    expect(rig.output.text()).toContain('created concurrently');
  });

  it('bucket create fails for a real reason: actionable error', async () => {
    const rig = await makeSetupRig();
    rig.fake.bucketInfoResult = fail('bucket not found');
    rig.fake.bucketCreateResult = fail('insufficient permissions for r2');
    await expect(rig.setup()).rejects.toThrow(/could not create the R2 bucket.*insufficient permissions for r2/s);
  });

  it('deploy failure: surfaces exit code + stderr', async () => {
    const rig = await makeSetupRig();
    rig.fake.deployResult = fail('Authentication error [code: 10000]', 1);
    await expect(rig.setup()).rejects.toThrow(/wrangler deploy failed \(exit 1\).*10000/s);
  });

  it('deploy prints no URL: warns via the fallback next-step line', async () => {
    const rig = await makeSetupRig();
    rig.fake.deployResult = ok('Deployed without a URL');
    const result = await rig.setup();
    expect(result.workerUrl).toBeNull();
    expect(rig.output.text()).toContain('wrangler did not print one');
  });

  it('API-token path: REST probe + wrangler env plumbing (no whoami/login)', async () => {
    const rig = await makeSetupRig();
    const result = await rig.setup({ apiToken: 'tok-123', accountId: 'acc-1' });

    const ops = rig.fake.calls.map((call) => call.op);
    expect(ops).toContain('restListAccounts');
    expect(ops).not.toContain('whoami');
    expect(ops).not.toContain('login');

    const deploy = rig.fake.calls.find((call) => call.op === 'deploy');
    expect(deploy?.env).toMatchObject({
      CLOUDFLARE_API_TOKEN: 'tok-123',
      CLOUDFLARE_ACCOUNT_ID: 'acc-1',
    });
    const bucket = rig.fake.calls.find((call) => call.op === 'bucketInfo');
    expect(bucket?.env).toMatchObject({ CLOUDFLARE_API_TOKEN: 'tok-123' });
    expect(result.accountId).toBe('acc-1');
  });

  it('API-token path: rejected token → friendly error', async () => {
    const rig = await makeSetupRig();
    rig.fake.restAccounts = { httpStatus: 401 };
    await expect(rig.setup({ apiToken: 'bad', accountId: 'acc-1' })).rejects.toThrow(
      /Cloudflare rejected the API token/,
    );
  });

  it('local --bundle: copies instead of downloading', async () => {
    const rig = await makeSetupRig();
    const zipPath = join(rig.dir, 'local-bundle.zip');
    await writeFile(zipPath, new Uint8Array([1, 2, 3]));
    const result = await rig.setup({ bundlePath: zipPath });

    expect(rig.fake.downloadUrls).toHaveLength(0);
    expect(result.bundleFrom).toBe(zipPath);
    expect(new Uint8Array(await readFile(join(result.deployDir, 'worker-bundle.zip')))).toEqual(
      new Uint8Array([1, 2, 3]),
    );
  });

  it('bundle download fails: error mentions the URL', async () => {
    const rig = await makeSetupRig();
    rig.fake.download = async () => {
      throw new Error('could not download the worker bundle from https://x (HTTP 404)');
    };
    await expect(rig.setup()).rejects.toThrow(/worker bundle.*HTTP 404/);
  });

  it('extract fails on both tar and unzip: surfaces the error', async () => {
    const rig = await makeSetupRig();
    rig.fake.extractZip = async () => fail('tar: not a zip');
    await expect(rig.setup()).rejects.toThrow(/could not extract the worker bundle.*tar: not a zip/s);
  });

  it('--open opens the browser at the worker URL; failure is a warning, not a crash', async () => {
    const rig = await makeSetupRig();
    rig.fake.openBrowserResult = fail('no display');
    await rig.setup({ open: true });
    expect(rig.fake.openedUrls).toEqual(['https://vaultsync-personal-x7q2.jitu.workers.dev']);
    expect(rig.output.warnings.join('\n')).toMatch(/could not open the browser/);
  });

  it('asks before opening by default; --no-open / decline never opens', async () => {
    const asked = await makeSetupRig();
    asked.prompts.script(true, /Open the worker URL/);
    await asked.setup({ open: undefined });
    expect(asked.fake.openedUrls).toHaveLength(1);

    const declined = await makeSetupRig();
    declined.prompts.script(false, /Open the worker URL/);
    await declined.setup({ open: undefined });
    expect(declined.fake.openedUrls).toHaveLength(0);

    const never = await makeSetupRig();
    await never.setup({ open: false });
    expect(never.fake.openedUrls).toHaveLength(0);
  });

  it('non-interactive without a vault name: tells the caller to pass --name', async () => {
    const rig = await makeSetupRig();
    rig.runtime.prompts = null;
    const error = await rig
      .setup({ vaultName: undefined })
      .then(
        () => undefined,
        (rejection: unknown) => rejection,
      );
    expect(error).toBeInstanceOf(CommandError);
    expect((error as CommandError).message).toMatch(/--name/);
  });

  it('empty vault name: refuses', async () => {
    const rig = await makeSetupRig();
    await expect(rig.setup({ vaultName: '  ' })).rejects.toThrow(/vault name required/);
  });

  it('--worker-name/--bucket override the derived names', async () => {
    const rig = await makeSetupRig();
    const result = await rig.setup({ workerName: 'my-sync', bucketName: 'my-blobs' });
    expect(result.workerName).toBe('my-sync');
    expect(result.bucketName).toBe('my-blobs');
    expect(result.deployDir).toContain('deploy');
    const bucketCall = rig.fake.calls.find((call) => call.op === 'bucketInfo');
    expect(bucketCall?.arg).toBe('my-blobs');
  });

  it('writes nothing when auth fails before provisioning', async () => {
    const rig = await makeSetupRig({ whoami: [notLoggedIn] });
    rig.runtime.prompts = null;
    await expect(rig.setup()).rejects.toThrow();
    const deployDir = join(rig.dir, 'deploy');
    const entries = await readdir(rig.dir).catch(() => [] as string[]);
    expect(entries).not.toContain('deploy');
  });
});
