/**
 * VaultSync for Agents — the Worker (ARCHITECTURE.md §1, §5).
 *
 * One worker per vault. This module is the thin outer shell: routing, blob
 * streaming to/from R2, auth gating, and the weekly GC cron. ALL state and
 * arbitration live in the `VaultRoom` Durable Object (`room.ts`), which
 * imports the shared sync brain from `@vsa/core`.
 *
 * Claim lifecycle: until claimed, the API/sync/blob/pairing surface answers
 * `421 unclaimed` (§3, §14) so uptime checks and `vsa doctor` keep working
 * against a fresh deployment. The dashboard SPA itself is served in BOTH
 * claim states (the SPA branches on `GET /health`), which is what makes the
 * claim page reachable from a fresh deploy.
 *
 * Static assets ride the `ASSETS` binding (§10, FR-30) with
 * `run_worker_first: true`: this router stays the single decision point, and
 * only explicitly delegates non-API GET/HEAD requests to asset serving.
 *
 * CORS: split policy. The plugin-facing routes (GET /health, POST /pair,
 * PATCH /device, GET /api/status with the device token, GET/PUT /blob/:hash)
 * answer preflights and carry permissive CORS headers: the Obsidian plugin's
 * renderer calls the worker cross-origin (`app://obsidian.md` on desktop,
 * `capacitor://` origins on mobile), and those routes authenticate by Bearer
 * device token or one-time pairing code — no cookies — so a wildcard ACAO adds
 * no exposure. Everything else the dashboard uses (/admin/*, the rest of
 * /api/*, /claim, /ws) stays same-origin only: no CORS headers are ever
 * emitted there, keeping the session-cookie CSRF surface at zero.
 */

import { ProtocolVersion } from '@vsa/core';
import { ADMIN_COOKIE_NAME, blobKey, type VaultRoom } from './room.js';
import { SERVER_VERSION } from './version.js';

/** Hard cap on blob uploads (§5: ~100 MB, enforced while streaming). */
const BLOB_MAX_BYTES = 100 * 1024 * 1024;
const SESSION_COOKIE_MAX_AGE = 12 * 60 * 60; // seconds — matches the DO's 12 h TTL

/**
 * Paths that belong to the API/sync surface and therefore stay behind the
 * 421 unclaimed gate (and never fall through to SPA asset serving).
 */
const API_PATH_PREFIXES = ['/api/', '/blob/', '/admin/'];
const API_PATH_EXACT = new Set(['/ws', '/sync', '/pair', '/device']);

function isApiPath(path: string): boolean {
  return API_PATH_EXACT.has(path) || API_PATH_PREFIXES.some((prefix) => path.startsWith(prefix));
}

// --- plugin CORS ---------------------------------------------------------------------------

/**
 * CORS headers for the plugin-facing routes (see the module comment): the
 * Obsidian plugin's renderer cannot rely on cookies cross-origin, and these
 * routes authenticate by Bearer device token or one-time pairing code, so a
 * wildcard ACAO is safe. Dashboard routes NEVER emit these.
 */
const PLUGIN_CORS_HEADERS: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, PUT, PATCH, OPTIONS',
  'access-control-allow-headers': 'Authorization, Content-Type',
  'access-control-max-age': '86400',
};

/**
 * Paths the plugin's cross-origin renderer talks to. `/api/status` and
 * `/api/snapshots` are here deliberately: the plugin's About section reads the
 * storage summary and the snapshot list with the device's Bearer token from
 * the renderer — token-authenticated, no cookies involved, so a wildcard ACAO
 * adds no exposure. The admin dashboard calls the same routes same-origin and
 * is unaffected (the headers are additive); every OTHER /api/* route
 * (/api/history included) stays same-origin only.
 */
function isPluginCorsPath(path: string): boolean {
  return (
    path === '/health' ||
    path === '/pair' ||
    path === '/device' ||
    path === '/api/status' ||
    path === '/api/snapshots' ||
    path.startsWith('/blob/')
  );
}

/** Copy `response` (DO-fetched responses are header-immutable) with CORS. */
function withPluginCors(response: Response): Response {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(PLUGIN_CORS_HEADERS)) headers.set(name, value);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export { VaultRoom } from './room.js';

// --- plumbing ---------------------------------------------------------------------------

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

function roomStub(env: Env): DurableObjectStub<VaultRoom> {
  return env.ROOM.get(env.ROOM.idFromName('vault'));
}

/** Send a request to the room DO's internal surface. */
function roomFetch(env: Env, path: string, init?: RequestInit): Promise<Response> {
  return roomStub(env).fetch(new Request(`https://room${path}`, init));
}

function roomPost(
  env: Env,
  path: string,
  body: Record<string, unknown>,
  headers?: Record<string, string>,
): Promise<Response> {
  return roomFetch(env, path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(headers ?? {}) },
    body: JSON.stringify(body),
  });
}

async function isClaimed(env: Env): Promise<boolean> {
  const res = await roomFetch(env, '/internal/health');
  const body = (await res.json().catch(() => ({ claimed: false }))) as { claimed?: boolean };
  return body.claimed === true;
}

// --- router ------------------------------------------------------------------------------

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // CORS preflights for the plugin-facing routes answer BEFORE the 421
    // gate: an unclaimed worker must stay reachable from the plugin's
    // cross-origin renderer (/health probe, /pair flow) even pre-claim.
    if (request.method === 'OPTIONS' && isPluginCorsPath(path)) {
      return new Response(null, { status: 204, headers: PLUGIN_CORS_HEADERS });
    }

    // The two endpoints that work on an unclaimed worker (§3). The body also
    // reports the worker's own version + wire protocol version, so `vsa
    // doctor` and the plugin can assess skew against an unclaimed worker too.
    if (request.method === 'GET' && path === '/health') {
      return withPluginCors(
        json(200, {
          ok: true,
          claimed: await isClaimed(env),
          serverVersion: SERVER_VERSION,
          protocolVersion: ProtocolVersion,
        }),
      );
    }
    if (path === '/claim') {
      if (request.method !== 'POST') return json(405, { error: 'POST required' });
      return roomFetch(env, '/claim', { method: 'POST', body: request.body, headers: request.headers });
    }
    if (!(await isClaimed(env)) && isApiPath(path)) {
      // Plugin paths get the CORS headers even on the 421 so the renderer
      // can read the error; the gate itself stays.
      const gate = json(421, { error: 'unclaimed', hint: 'POST /claim first' });
      return isPluginCorsPath(path) ? withPluginCors(gate) : gate;
    }

    if (request.method === 'POST' && path === '/pair') {
      return withPluginCors(await roomPost(env, '/pair', await readJsonBody(request), clientIpHeaders(request)));
    }
    if (request.method === 'PATCH' && path === '/device') {
      // Device self-service rename (the settings tab's "Rename device"):
      // authenticated by the caller's own Bearer device token — an admin
      // session cookie is deliberately NOT forwarded as authorization.
      return withPluginCors(
        await roomFetch(env, '/device', {
          method: 'PATCH',
          headers: { 'content-type': 'application/json', ...authForwardHeaders(request) },
          body: JSON.stringify(await readJsonBody(request)),
        }),
      );
    }
    if (request.method === 'POST' && path === '/admin/login') {
      return handleAdminLogin(request, env);
    }
    if (request.method === 'POST' && path === '/admin/logout') {
      return handleAdminLogout(request, env);
    }
    if (request.method === 'POST' && path === '/admin/passphrase-change') {
      return handleAdminPassphraseChange(request, env);
    }
    if (request.method === 'POST' && path === '/admin/pair') {
      return roomPost(env, '/admin/pair', await readJsonBody(request), cookieHeader(request));
    }
    if (request.method === 'POST' && path === '/admin/revoke') {
      return roomPost(env, '/admin/revoke', await readJsonBody(request), cookieHeader(request));
    }
    if (request.method === 'GET' && path === '/api/status') {
      // Plugin-CORS route: the About section fetches this cross-origin with
      // the device token (see `isPluginCorsPath`). Auth is unchanged — the
      // room still accepts the device Bearer token OR the admin cookie.
      return withPluginCors(await roomFetch(env, '/api/status', { headers: authForwardHeaders(request) }));
    }
    if (request.method === 'GET' && path === '/api/snapshots') {
      // Plugin-CORS route like /api/status: the snapshot list is read with the
      // device token cross-origin (the plugin's snapshot UI); token-authenticated,
      // no cookies involved, so a wildcard ACAO adds no exposure.
      return withPluginCors(await roomFetch(env, '/api/snapshots', { headers: authForwardHeaders(request) }));
    }
    if (request.method === 'GET' && path === '/api/history') {
      // Read-only version-chain lookup for `vsa history` / `vsa restore`
      // (FR-54). Query string (`?path=…`) is forwarded verbatim.
      return roomFetch(env, `/api/history${url.search}`, { headers: authForwardHeaders(request) });
    }
    if ((path === '/ws' || path === '/sync') && request.method === 'GET') {
      return handleWebSocket(request, env);
    }
    if (path.startsWith('/blob/')) {
      const hash = path.slice('/blob/'.length);
      if (request.method === 'PUT') return withPluginCors(await handleBlobPut(request, env, hash));
      if (request.method === 'GET') return withPluginCors(await handleBlobGet(request, env, hash));
      return withPluginCors(json(405, { error: 'GET or PUT required' }));
    }
    // Everything else is dashboard surface (§10): delegate to the static
    // assets binding in BOTH claim states. With `not_found_handling:
    // single-page-application`, unknown GET paths land on index.html (SPA
    // deep links); API-looking methods/paths never reach here.
    if (request.method === 'GET' || request.method === 'HEAD') {
      return env.ASSETS.fetch(request);
    }
    return json(404, { error: 'not found' });
  },

  // --- weekly GC cron (§7) -----------------------------------------------------------------
  //
  // Two jobs ride the same weekly trigger:
  //  - orphan-blob GC: ask the DO for unreferenced hashes (refcount 0, older
  //    than the grace window), then have the DO purge the bookkeeping rows
  //    and CONFIRM which hashes are still orphans (re-checked inside its
  //    serialized queue — a commit that re-referenced one since listing
  //    wins), and only then delete the confirmed ones from R2. Referenced
  //    blobs are never enumerated, so they always survive.
  //  - events pruning (§6): the event log is bounded (30 days / newest 10k);
  //    the DO prunes opportunistically between cron runs as a second net.
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(
      (async () => {
        await roomPost(env, '/internal/events-prune', {});
        const list = await roomFetch(env, '/internal/gc');
        const { orphans } = (await list.json()) as { orphans: string[] };
        if (orphans.length === 0) return;
        const purge = await roomPost(env, '/internal/gc-purge', { hashes: orphans });
        const { purged } = (await purge.json()) as { purged: string[] };
        await Promise.all(purged.map((hash) => env.BUCKET.delete(blobKey(hash))));
      })().catch((error: unknown) => {
        // Cron failures must never propagate; Cloudflare retries the trigger.
        console.error('gc failed', error);
      }),
    );
  },
};

// --- handlers --------------------------------------------------------------------------------

async function readJsonBody(request: Request): Promise<Record<string, unknown>> {
  return (await request.json().catch(() => ({}))) as Record<string, unknown>;
}

function cookieHeader(request: Request): Record<string, string> {
  const cookie = request.headers.get('cookie');
  return cookie === null ? {} : { cookie };
}

function authForwardHeaders(request: Request): Record<string, string> {
  const headers: Record<string, string> = {};
  const authorization = request.headers.get('authorization');
  if (authorization !== null) headers.authorization = authorization;
  const cookie = request.headers.get('cookie');
  if (cookie !== null) headers.cookie = cookie;
  return headers;
}

/**
 * Forward the client IP to the DO for per-IP auth throttling (§3, §14): the
 * guessing surfaces (`/pair`, `/admin/login`) budget failures per address.
 */
function clientIpHeaders(request: Request): Record<string, string> {
  return { 'cf-connecting-ip': request.headers.get('cf-connecting-ip') ?? 'unknown' };
}

/** `POST /admin/login` → verify in the DO, then set the signed session cookie. */
async function handleAdminLogin(request: Request, env: Env): Promise<Response> {
  const body = await readJsonBody(request);
  const res = await roomPost(env, '/admin/login', { passphrase: body.passphrase }, clientIpHeaders(request));
  if (!res.ok) return res;
  const { cookie, expiresAt } = (await res.json()) as { cookie: string; expiresAt: number };
  const response = json(200, { ok: true, expiresAt });
  response.headers.append(
    'set-cookie',
    `${ADMIN_COOKIE_NAME}=${cookie}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${SESSION_COOKIE_MAX_AGE}`,
  );
  return response;
}

/**
 * `POST /admin/logout` — clear the admin session cookie AND revoke
 * server-side: the DO bumps the session revocation floor, so every
 * outstanding admin cookie (other tabs, stolen copies) dies at once.
 * Unauthenticated callers still get the clearing 200 — idempotent, and
 * without a valid session there is no floor to bump.
 */
async function handleAdminLogout(request: Request, env: Env): Promise<Response> {
  await roomPost(env, '/admin/logout', {}, cookieHeader(request)).catch(() => {});
  const response = json(200, { ok: true });
  response.headers.append(
    'set-cookie',
    `${ADMIN_COOKIE_NAME}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`,
  );
  return response;
}

/**
 * `POST /admin/passphrase-change` → the DO verifies `current` (argon2, with
 * the shared per-IP failure budget), stores the new hash, and ROTATES the
 * session secret so every pre-existing admin cookie dies instantly. The DO
 * hands back a freshly signed session, re-issued here as a cookie so the
 * acting admin stays signed in mid-action. Same cookie shape/lifetime as
 * login; same-origin only (admin routes never carry CORS headers).
 */
async function handleAdminPassphraseChange(request: Request, env: Env): Promise<Response> {
  const body = await readJsonBody(request);
  const res = await roomPost(
    env,
    '/admin/passphrase-change',
    { current: body.current, next: body.next },
    { ...cookieHeader(request), ...clientIpHeaders(request) },
  );
  if (!res.ok) return res;
  const { cookie, expiresAt } = (await res.json()) as { cookie: string; expiresAt: number };
  const response = json(200, { ok: true, expiresAt });
  response.headers.append(
    'set-cookie',
    `${ADMIN_COOKIE_NAME}=${cookie}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${SESSION_COOKIE_MAX_AGE}`,
  );
  return response;
}

/** `GET /ws` (or `/sync`) → upgrade and hand the socket to the DO. */
async function handleWebSocket(request: Request, env: Env): Promise<Response> {
  if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
    return json(426, { error: 'websocket upgrade required' });
  }
  return roomStub(env).fetch(request);
}

/** Auth for blob routes: device token (Bearer) or admin session cookie. */
async function blobAuth(request: Request, env: Env): Promise<boolean> {
  const res = await roomPost(env, '/internal/auth', {}, authForwardHeaders(request));
  return res.ok;
}

/**
 * `PUT /blob/:hash` — put-if-absent, streamed to R2 while hashing it
 * (`crypto.DigestStream`). An object already under the key IS the blob
 * (content-addressability), so a re-upload never overwrites it — which also
 * means a garbage upload can no longer destroy a referenced blob. On mismatch
 * only the object THIS request wrote is deleted and the client gets 422: the
 * upload carries a random ownership tag in its R2 custom metadata, and the
 * reject path deletes only while that tag still owns the key — a racing
 * uploader's verified object can never be evicted by an impostor's cleanup.
 * Oversize bodies are rejected with 413 mid-stream.
 */
async function handleBlobPut(request: Request, env: Env, hash: string): Promise<Response> {
  if (!/^[0-9a-f]{64}$/.test(hash)) {
    return json(400, { error: 'hash must be lowercase sha256 hex' });
  }
  if (!(await blobAuth(request, env))) {
    return json(401, { error: 'device token or admin session required' });
  }
  if (request.body === null) {
    return json(400, { error: 'body required' });
  }
  const declared = Number(request.headers.get('content-length') ?? '0');
  if (declared > BLOB_MAX_BYTES) {
    return json(413, { error: `blob exceeds the ${BLOB_MAX_BYTES} byte cap` });
  }

  const key = blobKey(hash);
  const uploadTag = hexOf(crypto.getRandomValues(new Uint8Array(16)));
  const existing = await env.BUCKET.head(key);
  if (existing !== null) {
    await request.body.cancel().catch(() => {});
    await roomPost(env, '/internal/blob-uploaded', { hash, size: existing.size });
    return json(200, { ok: true, hash, size: existing.size });
  }
  const [toR2, toHash] = request.body.tee();
  const digestStream = new crypto.DigestStream('SHA-256');
  let total = 0;
  let oversize = false;
  const sizeGuard = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      total += chunk.byteLength;
      if (total > BLOB_MAX_BYTES) {
        oversize = true;
        throw new Error('blob exceeds cap');
      }
      controller.enqueue(chunk);
    },
  });
  const digestPromise = toHash
    .pipeThrough(sizeGuard)
    .pipeTo(digestStream)
    .then(() => digestStream.digest)
    .then((ab) => hexOf(ab))
    .catch((error: unknown) => Promise.reject(error instanceof Error ? error : new Error(String(error))));

  const putPromise = env.BUCKET.put(key, toR2, {
    httpMetadata: { contentType: 'application/octet-stream' },
    customMetadata: { 'vsa-upload': uploadTag },
  });

  let digest: string;
  try {
    digest = await digestPromise;
  } catch {
    await putPromise.catch(() => {});
    // Nothing may remain stored after a rejected upload (CAS contract): the
    // mid-stream oversize path completes the R2 put before we can bail, so
    // evict it exactly like a hash mismatch — but only if this request's
    // upload still owns the key (see the ownership tag).
    if (oversize) {
      await deleteIfOwned(env, key, uploadTag);
      return json(413, { error: `blob exceeds the ${BLOB_MAX_BYTES} byte cap` });
    }
    return json(400, { error: 'failed to hash request body' });
  }
  if (digest !== hash) {
    // Same hash ⇒ same content is the CAS contract; evict the impostor this
    // request wrote (put-if-absent above guarantees a pre-existing object was
    // never touched) — unless a concurrent verified upload already took the
    // key back, which the ownership tag proves.
    await putPromise.catch(() => {});
    await deleteIfOwned(env, key, uploadTag);
    return json(422, { error: 'content does not hash to the claimed hash' });
  }
  try {
    await putPromise;
  } catch (error) {
    // A race with an identical (already verified) object is fine; else 500.
    const head = await env.BUCKET.head(key);
    if (head === null) {
      console.error('blob put failed', error);
      return json(500, { error: 'failed to store blob' });
    }
  }
  await roomPost(env, '/internal/blob-uploaded', { hash, size: total });
  return json(201, { ok: true, hash, size: total });
}

/** Delete `key` only while it still carries this upload's ownership tag. */
async function deleteIfOwned(env: Env, key: string, uploadTag: string): Promise<void> {
  const head = await env.BUCKET.head(key).catch(() => null);
  if (head?.customMetadata?.['vsa-upload'] === uploadTag) {
    await env.BUCKET.delete(key);
  }
}

/** `GET /blob/:hash` — stream back, immutable (content is addressable). */
async function handleBlobGet(request: Request, env: Env, hash: string): Promise<Response> {
  if (!/^[0-9a-f]{64}$/.test(hash)) {
    return json(400, { error: 'hash must be lowercase sha256 hex' });
  }
  if (!(await blobAuth(request, env))) {
    return json(401, { error: 'device token or admin session required' });
  }
  const obj = await env.BUCKET.get(blobKey(hash));
  if (obj === null) {
    return json(404, { error: 'no such blob' });
  }
  return new Response(obj.body, {
    status: 200,
    headers: {
      'content-type': 'application/octet-stream',
      // Content-addressed and immutable, but the response is authorized —
      // `private` keeps shared caches from ever storing it.
      'cache-control': 'private, max-age=31536000, immutable',
      etag: obj.httpEtag,
    },
  });
}

/** ArrayBuffer or view → lowercase hex. */
function hexOf(input: ArrayBuffer | Uint8Array): string {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  let out = '';
  for (const byte of bytes) out += byte.toString(16).padStart(2, '0');
  return out;
}
