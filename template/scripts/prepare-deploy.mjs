#!/usr/bin/env node
/**
 * Prepare a deploy from the pinned release bundle — the build half of the
 * template's `npm run deploy` (executed by Cloudflare Workers Builds on
 * every deploy-button deployment and every push to main):
 *
 *   1. read the pinned release tag from VERSION;
 *   2. download its `worker-bundle.zip` + `.sha256` sidecar from the
 *      VaultSyncforAgents releases and VERIFY the digest (hard fail) —
 *      the worker code is deployed into the user's account, so a tampered
 *      download must never get that far;
 *   3. extract `worker.js` + `dashboard/**` into `dist/` (the layout
 *      wrangler.jsonc points at);
 *   4. resolve the `__WORKER_NAME__` / `__R2_BUCKET__` placeholders left
 *      in wrangler.jsonc (the deploy button usually rewrites them; manual
 *      clones get sane defaults derived from the repo directory name) into
 *      `wrangler.resolved.jsonc`;
 *   5. create the R2 bucket if it does not exist yet (wrangler is
 *      authenticated in Workers Builds; locally it uses your `wrangler
 *      login`).
 *
 * No size-cap zoo on the zip: the sha256 verification pins the archive
 * bit-for-bit to the release we shipped, so a bomb cannot ride in.
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { basename } from 'node:path';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { unzipSync } from 'fflate';

const RELEASES = 'https://github.com/anuchin/vaultsyncforagents/releases/download';

const tag = readFileSync('VERSION', 'utf8').trim();
const bundleUrl = `${RELEASES}/${tag}/worker-bundle.zip`;
console.log(`release: ${tag}`);

// --- download + verify -------------------------------------------------------------------------

async function download(url) {
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok) {
    throw new Error(`could not download ${url} (HTTP ${response.status})`);
  }
  return new Uint8Array(await response.arrayBuffer());
}

const [bundle, sidecar] = await Promise.all([download(bundleUrl), download(`${bundleUrl}.sha256`)]);
const expected = /[0-9a-fA-F]{64}/.exec(new TextDecoder().decode(sidecar))?.[0]?.toLowerCase();
if (expected === undefined) {
  throw new Error(`invalid .sha256 sidecar at ${bundleUrl}.sha256 — refusing to deploy`);
}
const actual = createHash('sha256').update(bundle).digest('hex');
if (actual !== expected) {
  throw new Error(
    `worker bundle integrity check FAILED: sha256 ${actual} does not match the release's ` +
      `${expected} — refusing to deploy a corrupted or tampered bundle`,
  );
}
console.log(`bundle:  ${bundleUrl} (sha256 verified, ${(bundle.length / 1024).toFixed(1)} KiB)`);

// --- extract -----------------------------------------------------------------------------------

const entries = unzipSync(bundle);
rmSync('dist', { recursive: true, force: true });
mkdirSync('dist/dashboard', { recursive: true });
for (const [name, bytes] of Object.entries(entries)) {
  if (name === '' || name.endsWith('/')) continue;
  if (name.includes('..')) continue; // defensive: no traversal-shaped keys
  if (name === 'worker.js') {
    writeFileSync('dist/worker.js', bytes);
  } else if (name.startsWith('dashboard/')) {
    const rel = name.slice('dashboard/'.length);
    const slash = rel.lastIndexOf('/');
    if (slash > 0) mkdirSync(`dist/dashboard/${rel.slice(0, slash)}`, { recursive: true });
    writeFileSync(`dist/${name}`, bytes);
  } else {
    throw new Error(`unexpected entry in the release bundle: ${name}`);
  }
}
if (readFileSync('dist/worker.js', 'utf8').length === 0) throw new Error('dist/worker.js is empty');
console.log(`extracted worker.js + ${Object.keys(entries).filter((n) => n.startsWith('dashboard/') && !n.endsWith('/')).length} dashboard files → dist/`);

// --- resolve names -----------------------------------------------------------------------------

const sanitize = (value, fallback) => {
  const cleaned = String(value ?? fallback ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 63)
    .replace(/-+$/g, '');
  if (cleaned.length < 3) {
    throw new Error(`resolved name "${cleaned}" is too short — set WORKER_NAME`);
  }
  return cleaned;
};

// The deploy button rewrites wrangler.jsonc in the user's clone; when the
// placeholders survived (manual clone), default the worker name to the
// repository directory name — in Workers Builds that is the user's chosen
// repo name — and the bucket to vaultsync-<worker>.
const workerName = sanitize(process.env.WORKER_NAME, basename(process.cwd()));
const bucketName = sanitize(process.env.R2_BUCKET_NAME, `vaultsync-${workerName}`);

const resolved = readFileSync('wrangler.jsonc', 'utf8')
  .replaceAll('__WORKER_NAME__', workerName)
  .replaceAll('__R2_BUCKET__', bucketName);
writeFileSync('wrangler.resolved.jsonc', resolved);
console.log(`worker:  ${workerName}`);
console.log(`bucket:  ${bucketName}`);

// --- ensure the R2 bucket exists (wrangler deploy does not create it) ---------------------------

const bucketInConfig = /"bucket_name"\s*:\s*"([^"]+)"/.exec(resolved)?.[1] ?? bucketName;
try {
  execFileSync('npx', ['--yes', 'wrangler@4', 'r2', 'bucket', 'create', bucketInConfig], {
    stdio: 'pipe',
    env: process.env,
  });
  console.log(`bucket:  created ${bucketInConfig}`);
} catch (error) {
  // Exists (or no permission to pre-create) — wrangler deploy reports a
  // missing bucket clearly if this was something else.
  console.log(`bucket:  ${bucketInConfig} already exists or could not be pre-created (continuing)`);
  void error;
}
