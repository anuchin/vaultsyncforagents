/**
 * `src/cloudflare-deploy.ts` — the REST client against a routed fake fetch:
 * envelope unwrapping and typed failures, the R2 bucket calls, the asset
 * upload flow (hash formula, bulk base64 form, single-asset raw mode, the
 * session JWT as bearer), the script-upload multipart metadata (bindings,
 * DO migration, assets config), schedules, and the subdomain URL.
 */

import { describe, expect, it } from 'vitest';
import { strToU8 } from 'fflate';
import { blake3 } from '@noble/hashes/blake3.js';
import {
  CloudflareApiError,
  assetHash,
  bucketExists,
  contentTypeFor,
  createBucket,
  getWorkersDevUrl,
  listAccounts,
  putSchedules,
  uploadAssets,
  uploadWorker,
  verifyApiToken,
} from '../src/cloudflare-deploy.js';

const TOKEN = 'cf-token';
const ACCOUNT = 'acc-1';
const SCRIPT = 'vaultsync-personal-x7q2';

interface Call {
  url: string;
  method: string;
  body?: unknown;
  headers: Headers;
}

/**
 * Route by `METHOD path` (query included); unmatched requests throw. The
 * fake records every call for assertions.
 */
function fakeCloudflare(
  routes: Record<string, (call: Call) => unknown>,
): { fetchImpl: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const path = url.replace('https://api.cloudflare.com/client/v4', '');
    const method = init?.method ?? 'GET';
    const call: Call = {
      url,
      method,
      body: init?.body,
      headers: new Headers(init?.headers as HeadersInit | undefined),
    };
    calls.push(call);
    const handler = routes[`${method} ${path}`];
    if (handler === undefined) throw new Error(`unrouted: ${method} ${path}`);
    const result = handler(call);
    if (result instanceof Response) return result;
    return Response.json(result);
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

const ok = (result: unknown) => ({ success: true, errors: [], result });
const fail = (code: number, message: string, status = 400) =>
  new Response(JSON.stringify({ success: false, errors: [{ code, message }], result: null }), {
    status,
    headers: { 'content-type': 'application/json' },
  });

describe('token + accounts', () => {
  it('verifyApiToken accepts an active token, rejects a disabled one', async () => {
    const good = fakeCloudflare({ 'GET /user/tokens/verify': () => ok({ status: 'active' }) });
    await expect(verifyApiToken(TOKEN, good)).resolves.toBeUndefined();

    const bad = fakeCloudflare({ 'GET /user/tokens/verify': () => ok({ status: 'disabled' }) });
    await expect(verifyApiToken(TOKEN, bad)).rejects.toThrow(/disabled/);
  });

  it('listAccounts unwraps the envelope', async () => {
    const cf = fakeCloudflare({
      'GET /accounts': () => ok([{ id: 'a1', name: 'Personal' }]),
    });
    await expect(listAccounts(TOKEN, cf)).resolves.toEqual([{ id: 'a1', name: 'Personal' }]);
  });

  it('error envelopes become CloudflareApiError with the message and code', async () => {
    const cf = fakeCloudflare({ 'GET /accounts': () => fail(9109, 'Unauthorized to access requested resource', 403) });
    const error = await listAccounts(TOKEN, cf).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CloudflareApiError);
    expect((error as CloudflareApiError).message).toContain('Unauthorized');
    expect((error as CloudflareApiError).codes).toContain(9109);
  });
});

describe('R2 buckets', () => {
  it('bucketExists: true on 200, false on 404', async () => {
    const yes = fakeCloudflare({ [`GET /accounts/${ACCOUNT}/r2/buckets/${SCRIPT}`]: () => ok({ name: SCRIPT }) });
    await expect(bucketExists(TOKEN, ACCOUNT, SCRIPT, yes)).resolves.toBe(true);

    const no = fakeCloudflare({
      [`GET /accounts/${ACCOUNT}/r2/buckets/${SCRIPT}`]: () => fail(10004, 'not found', 404),
    });
    await expect(bucketExists(TOKEN, ACCOUNT, SCRIPT, no)).resolves.toBe(false);
  });

  it('createBucket posts the name and tolerates already-exists', async () => {
    const cf = fakeCloudflare({
      [`POST /accounts/${ACCOUNT}/r2/buckets`]: (call) => {
        expect(JSON.parse(call.body as string)).toEqual({ name: SCRIPT });
        return ok(null);
      },
    });
    await expect(createBucket(TOKEN, ACCOUNT, SCRIPT, cf)).resolves.toBeUndefined();

    const exists = fakeCloudflare({
      [`POST /accounts/${ACCOUNT}/r2/buckets`]: () => fail(10005, 'bucket already exists on this account', 400),
    });
    await expect(createBucket(TOKEN, ACCOUNT, SCRIPT, exists)).resolves.toBeUndefined();
  });
});

describe('assets', () => {
  const INDEX = strToU8('<!doctype html>');
  const APP = new Uint8Array([1, 2, 3]);
  const assets = new Map<string, Uint8Array>([
    ['index.html', INDEX],
    ['assets/app.js', APP],
  ]);

  /** wrangler's formula, computed independently: blake3(base64 + ext), 32 hex. */
  function expectedHash(bytes: Uint8Array, path: string): string {
    const b64 = Buffer.from(bytes).toString('base64');
    const ext = path.slice(path.lastIndexOf('.') + 1);
    const input = new TextEncoder().encode(b64 + ext);
    return Buffer.from(blake3.create().update(input).digest()).toString('hex').slice(0, 32);
  }

  it('assetHash matches the wrangler formula', () => {
    expect(assetHash(INDEX, 'index.html')).toBe(expectedHash(INDEX, 'index.html'));
    expect(assetHash(APP, 'assets/app.js')).toBe(expectedHash(APP, 'assets/app.js'));
    expect(assetHash(strToU8('x'), 'noext')).toBe(
      Buffer.from(
        blake3
          .create()
          .update(new TextEncoder().encode(Buffer.from('x').toString('base64')))
          .digest(),
      )
        .toString('hex')
        .slice(0, 32),
    );
  });

  it('bulk mode: session → base64 multipart per bucket → completion jwt', async () => {
    const hashIndex = assetHash(INDEX, 'index.html');
    const hashApp = assetHash(APP, 'assets/app.js');
    const sessionJwt = 'session.jwt.token';
    const completionJwt = 'completion.jwt.token';
    const cf = fakeCloudflare({
      [`POST /accounts/${ACCOUNT}/workers/scripts/${SCRIPT}/assets-upload-session`]: (call) => {
        const body = JSON.parse(call.body as string) as { manifest: Record<string, { hash: string; size: number }> };
        expect(body.manifest['index.html']).toEqual({ hash: hashIndex, size: INDEX.byteLength });
        expect(body.manifest['assets/app.js']).toEqual({ hash: hashApp, size: APP.byteLength });
        return ok({ buckets: [[hashIndex, hashApp]], jwt: sessionJwt });
      },
      [`POST /accounts/${ACCOUNT}/workers/assets/upload?base64=true`]: (call) => {
        // Authenticated by the SESSION jwt, not the API token.
        expect(call.headers.get('authorization')).toBe(`Bearer ${sessionJwt}`);
        const form = call.body as FormData;
        const file = form.get(hashIndex) as File;
        expect(file.name).toBe(hashIndex);
        expect(file.type).toBe('text/html; charset=utf-8');
        void file.arrayBuffer().then((buffer) => {
          expect(new Uint8Array(buffer)).toEqual(strToU8(Buffer.from(INDEX).toString('base64')));
        });
        return ok({ jwt: completionJwt });
      },
    });
    await expect(uploadAssets({ token: TOKEN, accountId: ACCOUNT, scriptName: SCRIPT, assets }, cf)).resolves.toBe(
      completionJwt,
    );
  });

  it('single mode: one raw request per file, content-type on the body', async () => {
    const hashIndex = assetHash(INDEX, 'index.html');
    const payload = { wrangler_single_asset_uploads: true };
    const sessionJwt = `x.${btoa(JSON.stringify(payload)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}.y`;
    const completionJwt = 'done.jwt';
    const cf = fakeCloudflare({
      [`POST /accounts/${ACCOUNT}/workers/scripts/${SCRIPT}/assets-upload-session`]: () =>
        ok({ buckets: [[hashIndex]], jwt: sessionJwt }),
      [`POST /accounts/${ACCOUNT}/workers/assets/upload/${hashIndex}`]: (call) => {
        expect(call.headers.get('authorization')).toBe(`Bearer ${sessionJwt}`);
        expect(call.headers.get('content-type')).toBe('text/html; charset=utf-8');
        expect(call.body).toEqual(INDEX);
        return ok({ jwt: completionJwt });
      },
    });
    await expect(uploadAssets({ token: TOKEN, accountId: ACCOUNT, scriptName: SCRIPT, assets }, cf)).resolves.toBe(
      completionJwt,
    );
  });

  it('returns the session jwt unchanged when nothing needs uploading', async () => {
    const cf = fakeCloudflare({
      [`POST /accounts/${ACCOUNT}/workers/scripts/${SCRIPT}/assets-upload-session`]: () =>
        ok({ buckets: [], jwt: 'already.jwt' }),
    });
    await expect(uploadAssets({ token: TOKEN, accountId: ACCOUNT, scriptName: SCRIPT, assets }, cf)).resolves.toBe(
      'already.jwt',
    );
  });
});

describe('script upload + schedule + url', () => {
  const WORKER = strToU8('export { VaultRoom };');

  it('uploadWorker PUTs metadata + module exactly as wrangler would', async () => {
    const cf = fakeCloudflare({
      [`PUT /accounts/${ACCOUNT}/workers/scripts/${SCRIPT}?excludeScript=true`]: (call) => {
        expect(call.headers.get('authorization')).toBe(`Bearer ${TOKEN}`);
        const form = call.body as FormData;
        const metadata = JSON.parse(form.get('metadata') as string);
        expect(metadata.main_module).toBe('worker.js');
        expect(metadata.compatibility_date).toBe('2026-08-01');
        expect(metadata.bindings).toEqual([
          { name: 'BUCKET', type: 'r2', bucket_name: SCRIPT },
          { name: 'ROOM', type: 'durable_object_namespace', class_name: 'VaultRoom' },
          { name: 'ASSETS', type: 'assets' },
        ]);
        expect(metadata.migrations).toEqual({
          new_tag: '0001_initial',
          steps: [{ new_sqlite_classes: ['VaultRoom'] }],
        });
        expect(metadata.assets.jwt).toBe('the-jwt');
        expect(metadata.assets.config).toEqual({
          html_handling: 'auto-trailing-slash',
          not_found_handling: 'single-page-application',
          run_worker_first: true,
        });
        const module = form.get('worker.js') as File;
        expect(module.name).toBe('worker.js');
        expect(module.type).toBe('application/javascript+module');
        return ok({ id: 'script-id' });
      },
    });
    await expect(
      uploadWorker(
        { token: TOKEN, accountId: ACCOUNT, scriptName: SCRIPT, bucketName: SCRIPT, workerJs: WORKER, assetsJwt: 'the-jwt' },
        cf,
      ),
    ).resolves.toBeUndefined();
  });

  it('putSchedules replaces the cron set with the weekly GC', async () => {
    const cf = fakeCloudflare({
      [`PUT /accounts/${ACCOUNT}/workers/scripts/${SCRIPT}/schedules`]: (call) => {
        expect(JSON.parse(call.body as string)).toEqual([{ cron: '0 3 * * 1' }]);
        return ok([{ cron: '0 3 * * 1' }]);
      },
    });
    await expect(
      putSchedules({ token: TOKEN, accountId: ACCOUNT, scriptName: SCRIPT }, cf),
    ).resolves.toBeUndefined();
  });

  it('getWorkersDevUrl builds the claim URL from the account subdomain', async () => {
    const cf = fakeCloudflare({
      [`GET /accounts/${ACCOUNT}/workers/subdomain`]: () => ok({ subdomain: 'alice', enabled: true }),
    });
    await expect(
      getWorkersDevUrl({ token: TOKEN, accountId: ACCOUNT, scriptName: SCRIPT }, cf),
    ).resolves.toBe(`https://${SCRIPT}.alice.workers.dev`);
  });

  it('getWorkersDevUrl fails actionably when no subdomain is registered', async () => {
    const cf = fakeCloudflare({
      [`GET /accounts/${ACCOUNT}/workers/subdomain`]: () => ok({ subdomain: '' }),
    });
    await expect(
      getWorkersDevUrl({ token: TOKEN, accountId: ACCOUNT, scriptName: SCRIPT }, cf),
    ).rejects.toThrow(/workers.dev subdomain/);
  });
});

describe('contentTypeFor', () => {
  it('maps dashboard types and defaults to the type-less sentinel', () => {
    expect(contentTypeFor('index.html')).toBe('text/html; charset=utf-8');
    expect(contentTypeFor('assets/app.js')).toBe('text/javascript');
    expect(contentTypeFor('assets/logo.svg')).toBe('image/svg+xml');
    expect(contentTypeFor('unknown.bin')).toBe('application/null');
  });
});
