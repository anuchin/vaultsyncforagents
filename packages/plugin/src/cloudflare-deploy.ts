/**
 * Minimal typed client for the Cloudflare REST API the in-app setup wizard
 * needs — the same calls `wrangler deploy` makes under the hood, so the
 * plugin can provision a worker without Node, npm, or a GitHub account:
 *
 *   verify the API token → list accounts → create the R2 bucket →
 *   upload dashboard assets (manifest → missing-file buckets → completion
 *   JWT) → PUT the worker script (module + metadata declaring the bindings
 *   and the Durable Object migration) → PUT the weekly GC cron schedule →
 *   read the account's workers.dev subdomain for the worker URL.
 *
 * Shapes verified against wrangler's own client (cloudflare/workers-sdk,
 * packages/deploy-helpers): the assets session endpoints, the blake3
 * content hash (`base64(contents) + extension`, hex, 32 chars), the bulk
 * base64 upload form, the script-upload metadata (main_module / bindings /
 * migrations / assets.jwt), and the schedules body.
 *
 * Same seams as the rest of the plugin's HTTP: an injectable `fetch`, no
 * Node imports, Web APIs only. The token is always an explicit parameter —
 * this module never stores it, and the wizard discards it after deploying.
 */

import {
  ASSETS_BINDING,
  ASSETS_NOT_FOUND_HANDLING,
  ASSETS_RUN_WORKER_FIRST,
  DO_BINDING,
  DO_CLASS,
  DO_MIGRATION_TAG,
  R2_BINDING,
  WORKER_COMPATIBILITY_DATE,
  GC_CRON,
} from '@vsa/core';
import { blake3 } from '@noble/hashes/blake3.js';

const API_BASE = 'https://api.cloudflare.com/client/v4';

/** A Cloudflare API call failed (auth, quota, shape — anything). */
export class CloudflareApiError extends Error {
  constructor(
    message: string,
    /** HTTP status of the failing response, when one arrived. */
    readonly status?: number,
    /** Cloudflare error codes (`errors[].code`), when the body carried any. */
    readonly codes: Array<number | string> = [],
  ) {
    super(message);
    this.name = 'CloudflareApiError';
  }
}

export interface CloudflareRestOptions {
  /** Injectable fetch (tests). Defaults to the global. */
  fetchImpl?: typeof fetch;
}

export interface CloudflareAccountInfo {
  id: string;
  name: string;
}

interface ApiEnvelope<T> {
  success: boolean;
  errors?: Array<{ code?: number | string; message?: string }>;
  result?: T;
}

/** One REST call: auth header, JSON envelope unwrapping, typed failures. */
async function api<T>(
  path: string,
  token: string,
  init: RequestInit,
  options: CloudflareRestOptions,
): Promise<T> {
  const doFetch = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const headers = new Headers(init.headers);
  headers.set('authorization', `Bearer ${token}`);
  if (typeof init.body === 'string') headers.set('content-type', 'application/json');

  let response: Response;
  try {
    response = await doFetch(`${API_BASE}${path}`, { ...init, headers });
  } catch (error) {
    throw new CloudflareApiError(
      `could not reach the Cloudflare API (${error instanceof Error ? error.message : String(error)})`,
    );
  }

  const text = await response.text();
  let envelope: ApiEnvelope<T> | null = null;
  try {
    envelope = text === '' ? null : (JSON.parse(text) as ApiEnvelope<T>);
  } catch {
    envelope = null;
  }

  if (response.ok && envelope !== null && envelope.success) {
    return envelope.result as T;
  }
  const errors = envelope?.errors ?? [];
  const message =
    errors.map((e) => e.message).filter(Boolean).join('; ') ||
    (text === '' ? `(HTTP ${response.status})` : text.slice(0, 300));
  const codes = errors.map((e) => e.code).filter((c): c is number | string => c !== undefined);
  throw new CloudflareApiError(`Cloudflare API: ${message}`, response.status, codes);
}

// --- token + accounts -------------------------------------------------------------------------

/** `GET /user/tokens/verify` — throws on an invalid/expired token. */
export async function verifyApiToken(
  token: string,
  options: CloudflareRestOptions = {},
): Promise<void> {
  const result = await api<{ status?: string }>('/user/tokens/verify', token, { method: 'GET' }, options);
  if (result.status !== undefined && result.status !== 'active') {
    throw new CloudflareApiError(
      `the Cloudflare API token is ${result.status} — create a fresh one and paste it again`,
    );
  }
}

/** `GET /accounts` — the accounts the token can see. */
export async function listAccounts(
  token: string,
  options: CloudflareRestOptions = {},
): Promise<CloudflareAccountInfo[]> {
  const accounts = await api<Array<{ id: string; name: string }>>(
    '/accounts',
    token,
    { method: 'GET' },
    options,
  );
  return accounts.map((a) => ({ id: a.id, name: a.name }));
}

// --- R2 ---------------------------------------------------------------------------------------

/** `GET /accounts/:id/r2/buckets/:name` — `false` when the bucket does not exist. */
export async function bucketExists(
  token: string,
  accountId: string,
  bucketName: string,
  options: CloudflareRestOptions = {},
): Promise<boolean> {
  try {
    await api(`/accounts/${accountId}/r2/buckets/${encodeURIComponent(bucketName)}`, token, {
      method: 'GET',
    }, options);
    return true;
  } catch (error) {
    if (
      error instanceof CloudflareApiError &&
      (error.status === 404 || error.codes.includes(10004) || /not found|does not exist/i.test(error.message))
    ) {
      return false;
    }
    throw error;
  }
}

/** `POST /accounts/:id/r2/buckets` — tolerates "already exists" races. */
export async function createBucket(
  token: string,
  accountId: string,
  bucketName: string,
  options: CloudflareRestOptions = {},
): Promise<void> {
  try {
    await api(
      `/accounts/${accountId}/r2/buckets`,
      token,
      { method: 'POST', body: JSON.stringify({ name: bucketName }) },
      options,
    );
  } catch (error) {
    // wrangler documents a 400 for an existing name; the create is idempotent
    // from the wizard's point of view.
    if (
      error instanceof CloudflareApiError &&
      (error.codes.includes(10005) || /already exist/i.test(error.message))
    ) {
      return;
    }
    throw error;
  }
}

// --- static assets (the dashboard SPA) --------------------------------------------------------
//
// The flow wrangler implements: hash every file, open an upload session
// with the manifest, upload the buckets the server asks for (base64 form
// data, or one raw request per file in single-asset mode), and collect the
// completion JWT for the script upload's metadata.

/** wrangler's asset hash: blake3 of `base64(contents) + extension`, hex, first 32 chars. */
export function assetHash(bytes: Uint8Array, path: string): string {
  const extension = path.includes('.') ? path.slice(path.lastIndexOf('.') + 1).toLowerCase() : '';
  const input = new TextEncoder().encode(bytesToBase64(bytes) + extension);
  const digest = blake3.create().update(input).digest();
  return toHex(digest).slice(0, 32);
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

function toHex(bytes: Uint8Array): string {
  let hex = '';
  for (const byte of bytes) hex += byte.toString(16).padStart(2, '0');
  return hex;
}

/** Decode a JWT's payload (no verification — it tells US the upload mode). */
function decodeJwtPayload(jwt: string): Record<string, unknown> {
  const part = jwt.split('.')[1] ?? '';
  const normalized = part.replace(/-/g, '+').replace(/_/g, '/');
  try {
    return JSON.parse(atob(normalized)) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/** MIME types the dashboard ships; anything else is served type-less. */
const MIME_BY_EXTENSION: Record<string, string> = {
  css: 'text/css',
  gif: 'image/gif',
  html: 'text/html; charset=utf-8',
  ico: 'image/x-icon',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  js: 'text/javascript',
  json: 'application/json',
  mjs: 'text/javascript',
  png: 'image/png',
  svg: 'image/svg+xml',
  txt: 'text/plain; charset=utf-8',
  wasm: 'application/wasm',
  webp: 'image/webp',
  woff: 'font/woff',
  woff2: 'font/woff2',
  xml: 'application/xml',
};

export function contentTypeFor(path: string): string {
  const extension = path.includes('.') ? path.slice(path.lastIndexOf('.') + 1).toLowerCase() : '';
  // "application/null" is the API's sentinel for "serve without a type".
  return MIME_BY_EXTENSION[extension] ?? 'application/null';
}

interface AssetsSessionResponse {
  buckets: string[][];
  jwt: string;
}

/**
 * Upload the dashboard assets and return the completion JWT for the script
 * upload. `assets` keys are forward-slash paths relative to `dashboard/`.
 */
export async function uploadAssets(
  params: {
    token: string;
    accountId: string;
    scriptName: string;
    assets: Map<string, Uint8Array>;
  },
  options: CloudflareRestOptions = {},
): Promise<string> {
  const manifest: Record<string, { hash: string; size: number }> = {};
  const byHash = new Map<string, { path: string; bytes: Uint8Array }>();
  for (const [path, bytes] of params.assets) {
    const hash = assetHash(bytes, path);
    manifest[path] = { hash, size: bytes.byteLength };
    if (!byHash.has(hash)) byHash.set(hash, { path, bytes });
  }

  const session = await api<AssetsSessionResponse>(
    `/accounts/${params.accountId}/workers/scripts/${params.scriptName}/assets-upload-session`,
    params.token,
    { method: 'POST', body: JSON.stringify({ manifest }) },
    options,
  );

  const filesToUpload = session.buckets.flat();
  if (filesToUpload.length === 0) return session.jwt; // everything deduped server-side

  const singleMode = decodeJwtPayload(session.jwt).wrangler_single_asset_uploads === true;
  let completionJwt = '';
  for (const bucket of session.buckets) {
    let response: { jwt?: string };
    if (singleMode) {
      // One raw request per file, content-type on the body, authenticated by
      // the SESSION jwt (not the API token).
      for (const hash of bucket) {
        const file = byHash.get(hash);
        if (file === undefined) throw new CloudflareApiError(`asset upload requested an unknown hash ${hash}`);
        response = await api<{ jwt?: string }>(
          `/accounts/${params.accountId}/workers/assets/upload/${hash}`,
          session.jwt,
          {
            method: 'POST',
            body: file.bytes as unknown as BodyInit,
            headers: { 'content-type': contentTypeFor(file.path) },
          },
          options,
        );
        if (response.jwt !== undefined && response.jwt !== '') completionJwt = response.jwt;
      }
    } else {
      // Bulk bucket: one multipart form whose fields are named by hash and
      // carry the file BASE64 (the `?base64=true` query switches the server).
      // The SESSION jwt (not the API token) authenticates asset uploads.
      const form = new FormData();
      for (const hash of bucket) {
        const file = byHash.get(hash);
        if (file === undefined) throw new CloudflareApiError(`asset upload requested an unknown hash ${hash}`);
        form.append(
          hash,
          new File([bytesToBase64(file.bytes)], hash, { type: contentTypeFor(file.path) }),
          hash,
        );
      }
      response = await api<{ jwt?: string }>(
        `/accounts/${params.accountId}/workers/assets/upload?base64=true`,
        session.jwt,
        { method: 'POST', body: form },
        options,
      );
      if (response.jwt !== undefined && response.jwt !== '') completionJwt = response.jwt;
    }
  }
  if (completionJwt === '') {
    throw new CloudflareApiError('the asset upload finished without a completion token — try again');
  }
  return completionJwt;
}

// --- the worker script ------------------------------------------------------------------------

/**
 * `PUT /accounts/:id/workers/scripts/:name` — multipart: the `metadata`
 * JSON (module, bindings, DO migration, assets JWT) plus the `worker.js`
 * module. Mirrors wrangler's upload form exactly.
 */
export async function uploadWorker(
  params: {
    token: string;
    accountId: string;
    scriptName: string;
    bucketName: string;
    workerJs: Uint8Array;
    assetsJwt: string;
  },
  options: CloudflareRestOptions = {},
): Promise<void> {
  const metadata = {
    main_module: 'worker.js',
    compatibility_date: WORKER_COMPATIBILITY_DATE,
    bindings: [
      { name: R2_BINDING, type: 'r2', bucket_name: params.bucketName },
      { name: DO_BINDING, type: 'durable_object_namespace', class_name: DO_CLASS },
      { name: ASSETS_BINDING, type: 'assets' },
    ],
    migrations: {
      new_tag: DO_MIGRATION_TAG,
      steps: [{ new_sqlite_classes: [DO_CLASS] }],
    },
    assets: {
      jwt: params.assetsJwt,
      config: {
        html_handling: 'auto-trailing-slash',
        not_found_handling: ASSETS_NOT_FOUND_HANDLING,
        run_worker_first: ASSETS_RUN_WORKER_FIRST,
      },
    },
  };

  const form = new FormData();
  form.set('metadata', JSON.stringify(metadata));
  form.set(
    'worker.js',
    new File([params.workerJs as unknown as BlobPart], 'worker.js', {
      type: 'application/javascript+module',
    }),
  );

  await api(
    `/accounts/${params.accountId}/workers/scripts/${params.scriptName}?excludeScript=true`,
    params.token,
    { method: 'PUT', body: form },
    options,
  );
}

// --- cron + URL -------------------------------------------------------------------------------

/** `PUT /accounts/:id/workers/scripts/:name/schedules` — replaces the schedule set. */
export async function putSchedules(
  params: { token: string; accountId: string; scriptName: string },
  options: CloudflareRestOptions = {},
): Promise<void> {
  await api(
    `/accounts/${params.accountId}/workers/scripts/${params.scriptName}/schedules`,
    params.token,
    { method: 'PUT', body: JSON.stringify([{ cron: GC_CRON }]) },
    options,
  );
}

/**
 * `GET /accounts/:id/workers/subdomain` → the account's workers.dev
 * subdomain, for the worker's claim URL. Fails with an actionable message
 * when the account has none registered yet (rare; the dashboard registers
 * one on first Workers use).
 */
export async function getWorkersDevUrl(
  params: { token: string; accountId: string; scriptName: string },
  options: CloudflareRestOptions = {},
): Promise<string> {
  const result = await api<{ subdomain?: string; enabled?: boolean }>(
    `/accounts/${params.accountId}/workers/subdomain`,
    params.token,
    { method: 'GET' },
    options,
  );
  if (result.subdomain === undefined || result.subdomain === '') {
    throw new CloudflareApiError(
      'this Cloudflare account has no workers.dev subdomain yet — open the Cloudflare dashboard → Workers & Pages → workers.dev and register one, then try again',
    );
  }
  return `https://${params.scriptName}.${result.subdomain}.workers.dev`;
}
