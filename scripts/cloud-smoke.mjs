/**
 * Disposable live-cloud smoke (weekly cron, .github/workflows/cloud-smoke.yml).
 *
 * Provisions a REAL disposable Cloudflare Worker from the deploy template,
 * claims it, pairs a device, syncs a file over the REAL WebSocket protocol,
 * asserts it round-trips, and tears everything down — the drift tripwire for
 * the wizard's raw-REST deploy path and the worker's live behavior. Uses
 * only fetch + the global WebSocket (Node ≥ 22): no build, no repo state
 * carried in, exactly what a fresh user's machine can do.
 *
 * Required environment:
 *   CLOUDFLARE_API_TOKEN   — token with Workers Scripts + R2 edit rights
 *   CLOUDFLARE_ACCOUNT_ID  — the account to deploy the disposable into
 * Optional:
 *   SMOKE_WORKER_NAME      — default vsa-smoke-<timestamp>-<rand>
 *
 * Exits 0 on success, 1 on any failure (teardown runs regardless).
 */

import { execFile } from 'node:child_process';
import { mkdtemp, cp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);
const API = 'https://api.cloudflare.com/client/v4';

const TOKEN = process.env.CLOUDFLARE_API_TOKEN;
const ACCOUNT = process.env.CLOUDFLARE_ACCOUNT_ID;
if (TOKEN === undefined || TOKEN === '' || ACCOUNT === undefined || ACCOUNT === '') {
  console.error('cloud-smoke: CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID are required — nothing was touched.');
  process.exit(1);
}

const SUFFIX = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const WORKER_NAME = process.env.SMOKE_WORKER_NAME ?? `vsa-smoke-${SUFFIX}`;
const BUCKET_NAME = `${WORKER_NAME}-blobs`;
const URL_ORIGIN = `https://${WORKER_NAME}.<account>.workers.dev`.replace('<account>', ACCOUNT);
const PASSPHRASE = `smoke-${SUFFIX}-passphrase`;

const fail = (step, error) => {
  console.error(`cloud-smoke FAILED at ${step}: ${error instanceof Error ? error.stack : String(error)}`);
  process.exitCode = 1;
};

async function api(path, init = {}) {
  const response = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${TOKEN}`,
      'content-type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
  const body = (await response.json().catch(() => ({})));
  if (!response.ok || body.success === false) {
    throw new Error(`${init.method ?? 'GET'} ${path} → ${response.status}: ${JSON.stringify(body.errors ?? body)}`);
  }
  return body;
}

async function deploy() {
  // A temp copy of the deploy template with our names substituted — the
  // same shape the GitHub Deploy button produces.
  const dir = await mkdtemp(join(tmpdir(), 'vsa-smoke-'));
  await cp(new URL('../template', import.meta.url), dir, { recursive: true });
  const wranglerPath = join(dir, 'wrangler.jsonc');
  let wrangler = await readFile(wranglerPath, 'utf8');
  wrangler = wrangler
    .replace(/"name":\s*"[^"]*"/, `"name": "${WORKER_NAME}"`)
    .replace(/"bucket_name":\s*"[^"]*"/, `"bucket_name": "${BUCKET_NAME}"`);
  await writeFile(wranglerPath, wrangler);
  const packagePath = join(dir, 'package.json');
  const pkg = JSON.parse(await readFile(packagePath, 'utf8'));
  pkg.name = WORKER_NAME;
  await writeFile(packagePath, `${JSON.stringify(pkg, null, 2)}\n`);
  await run('node', [join(dir, 'scripts', 'prepare-deploy.mjs')], { cwd: dir });
  await run('npx', ['--yes', 'wrangler@latest', 'deploy'], {
    cwd: dir,
    env: { ...process.env, CLOUDFLARE_API_TOKEN: TOKEN, CLOUDFLARE_ACCOUNT_ID: ACCOUNT },
  });
  await rm(dir, { recursive: true, force: true });
}

async function teardown() {
  try {
    await api(`/accounts/${ACCOUNT}/workers/scripts/${WORKER_NAME}`, { method: 'DELETE' });
    await api(`/accounts/${ACCOUNT}/r2/buckets/${BUCKET_NAME}`, { method: 'DELETE' });
    console.log(`cloud-smoke: tore down ${WORKER_NAME}`);
  } catch (error) {
    console.error(`cloud-smoke: teardown of ${WORKER_NAME} failed — clean up manually: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** The real WS protocol: hello → commit (inline) → reconnect → manifest. */
async function syncRoundTrip(deviceToken) {
  const CONTENT = `smoke note ${SUFFIX}\n`;
  const bytes = new TextEncoder().encode(CONTENT);
  const hash = await crypto.subtle.digest('SHA-256', bytes).then((b) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join(''));

  const speak = async (messages) => {
    const ws = new WebSocket(`${URL_ORIGIN.replace('https', 'wss')}/ws`);
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve, { once: true });
      ws.addEventListener('error', () => reject(new Error('ws open failed')), { once: true });
    });
    const replies = [];
    const done = new Promise((resolve) => {
      ws.addEventListener('message', (event) => {
        const message = JSON.parse(String(event.data));
        replies.push(message);
        if (message.type === 'manifest' || message.type === 'error') resolve();
      });
    });
    for (const message of messages) ws.send(JSON.stringify(message));
    await Promise.race([done, new Promise((_, reject) => setTimeout(() => reject(new Error('ws reply timeout')), 20_000))]);
    ws.close();
    return replies;
  };

  const helloReply = await speak([
    { type: 'hello', token: deviceToken, protocolVersion: 1, cursor: 0 },
    { type: 'commit', path: '/smoke.md', parentVersion: null, hash, size: bytes.byteLength, kind: 'edit', inline: Buffer.from(bytes).toString('base64') },
    { type: 'getManifest' },
  ]);
  const ack = helloReply.find((m) => m.type === 'commitAck');
  if (ack === undefined) throw new Error(`commit was not acked: ${JSON.stringify(helloReply)}`);

  // A FRESH connection (no shared state) must see the file in the manifest.
  const second = await speak([
    { type: 'hello', token: deviceToken, protocolVersion: 1, cursor: 0 },
    { type: 'getManifest' },
  ]);
  const manifest = second.find((m) => m.type === 'manifest');
  const entry = manifest?.entries?.['/smoke.md'];
  if (entry === undefined || entry.hash !== hash) {
    throw new Error(`round-trip failed: ${JSON.stringify(manifest?.entries ?? {})}`);
  }
}

try {
  console.log(`cloud-smoke: deploying ${WORKER_NAME}…`);
  await deploy();
  console.log('cloud-smoke: claiming…');
  let claimed = false;
  for (let attempt = 0; attempt < 30 && !claimed; attempt++) {
    const response = await fetch(`${URL_ORIGIN}/claim`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ passphrase: PASSPHRASE, vaultName: 'smoke' }),
    }).catch(() => null);
    if (response !== null && response.ok) {
      claimed = true;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 2000)); // cold start / propagation
  }
  if (!claimed) throw new Error('claim never succeeded (worker unreachable after deploy?)');

  const login = await fetch(`${URL_ORIGIN}/admin/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ passphrase: PASSPHRASE }),
  });
  const cookie = (login.headers.get('set-cookie') ?? '').split(';')[0];
  if (!login.ok || cookie === '') throw new Error(`admin login failed: HTTP ${login.status}`);
  const pairCode = await fetch(`${URL_ORIGIN}/admin/pair`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ deviceName: 'smoke' }),
  }).then((r) => r.json());
  const paired = await fetch(`${URL_ORIGIN}/pair`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code: pairCode.code, deviceName: 'smoke', deviceType: 'cli' }),
  }).then((r) => r.json());
  if (paired.token === undefined) throw new Error(`pairing failed: ${JSON.stringify(paired)}`);

  console.log('cloud-smoke: syncing a note over the real protocol…');
  await syncRoundTrip(paired.token);
  console.log('cloud-smoke: PASS — deploy, claim, pair, and sync all round-tripped');
} catch (error) {
  fail('smoke', error);
} finally {
  await teardown();
}
process.exit(process.exitCode ?? 0);
