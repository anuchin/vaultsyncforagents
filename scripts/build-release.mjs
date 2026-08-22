#!/usr/bin/env node
/**
 * Build the release bundle for the deploy-button template repo
 * (`vaultsyncforagents-template`, ARCHITECTURE.md §2/§12):
 *
 *   1. esbuild-bundle packages/worker/src/index.ts → worker.js
 *      (ESM, target es2022, exports VaultRoom + the default fetch/scheduled
 *      handler — exactly what the template's wrangler.jsonc `main` expects),
 *   2. copy the built dashboard SPA (packages/dashboard/dist) → dashboard/,
 *   3. zip both into dist/worker-bundle.zip with that TOP-LEVEL layout:
 *
 *        worker-bundle.zip
 *        ├── worker.js       # bundled worker entry (ESM; exports VaultRoom)
 *        └── dashboard/      # built dashboard SPA (ASSETS binding, served at /)
 *
 * The template's CI (.github/workflows/deploy.yml in the template repo)
 * unzips the release asset into dist/ and asserts exactly this layout, so no
 * wrapping folder may appear inside the archive.
 *
 * Inputs (must exist before running):
 *   - packages/dashboard/dist  → run `npm run build --workspace @vsa/dashboard`
 * Output: <repo root>/dist/worker-bundle.zip (git-ignored).
 *
 * Dependencies: none beyond the monorepo's existing devDependencies — esbuild
 * is a direct devDependency of @vsa/plugin (^0.28.1), hoisted to the root
 * node_modules by npm workspaces, so this script resolves it without adding
 * anything new. Zipping is a small in-script deterministic writer (node:zlib
 * deflate + CRC-32): fixed 1980-01-01 DOS timestamps, entries sorted by
 * path, no extra fields — identical inputs produce a byte-identical zip (and
 * sha256) on every machine and in CI, so the CLI's PINNED_BUNDLE_SHA256 is
 * stable regardless of where the release was built.
 */
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateRawSync } from 'node:zlib';
import esbuild from 'esbuild';

// --- deterministic zip checksum/timestamp primitives ----------------------------------------

// Pinned inputs of the zip writer at the bottom of this file: every entry
// (local header AND central directory) carries the constant DOS date/time
// 1980-01-01 00:00 — the DOS epoch, the earliest encodable moment, never a
// real mtime — and the checksum is a table-driven CRC-32 (IEEE 802.3,
// reflected, poly 0xEDB88320). Defined up here so the top-level build steps
// below can already call into the writer.
const DOS_TIME = 0x0000; // 00:00:00 (two-second granularity → 0)
const DOS_DATE = 0x0021; // 1980-01-01: (1980-1980)<<9 | 1<<5 | 1

const CRC_TABLE = new Int32Array(256);
for (let n = 0; n < 256; n += 1) {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 !== 0 ? (0xedb88320 ^ (c >>> 1)) >>> 0 : c >>> 1;
  CRC_TABLE[n] = c;
}

function crc32(bytes) {
  let crc = -1;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ -1) >>> 0;
}


const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workerEntry = path.join(rootDir, 'packages', 'worker', 'src', 'index.ts');
const dashboardDist = path.join(rootDir, 'packages', 'dashboard', 'dist');
const outDir = path.join(rootDir, 'dist');
const stagingDir = path.join(outDir, 'release-bundle');
const zipPath = path.join(outDir, 'worker-bundle.zip');

// --- version injection -----------------------------------------------------------------------

/**
 * The release version baked into the worker (`__VSA_SERVER_VERSION__` in
 * packages/worker/src/version.ts): the worker reports it on /health,
 * /api/status, and helloAck so clients can assess version skew
 * (core compat.ts). Source is the ROOT package.json — the version the whole
 * monorepo ships as. Without it (missing/empty) the define is skipped and
 * the worker reports its `-dev` fallback, which would be wrong for a
 * release, so that case errors out.
 */
const releaseVersion = String(
  JSON.parse(readFileSync(path.join(rootDir, 'package.json'), 'utf8')).version ?? '',
);
if (releaseVersion === '' || releaseVersion === 'undefined') {
  console.error('error: root package.json has no version — refusing to build an unversioned release');
  process.exit(1);
}

// CI sanity: a vX.Y.Z tag checkout must match the version being baked in,
// otherwise the worker would report a version that never existed as a tag —
// and the bundle check below cannot catch it (both values would be
// consistently wrong). Hard-fail instead of shipping a mislabeled worker.
// Non-tag contexts (branch builds, local runs) keep the warning-free path.
const refName = process.env.GITHUB_REF_NAME ?? '';
const refMatch = /^v(\d+\.\d+\.\d+(?:[-+][\w.-]+)?)$/.exec(refName);
if (refMatch !== null && refMatch[1] !== releaseVersion) {
  console.error(
    `error: GITHUB_REF_NAME is ${refName} but package.json version is ${releaseVersion} — ` +
      `the worker would report ${releaseVersion} while the release ships as ${refName}; ` +
      `fix the tag or the version before building`,
  );
  process.exit(1);
}

// --- inputs ---------------------------------------------------------------------------------

if (!existsSync(workerEntry)) {
  console.error(`error: worker entry not found at ${workerEntry}`);
  process.exit(1);
}
if (!existsSync(dashboardDist)) {
  console.error(
    `error: ${path.relative(rootDir, dashboardDist)} is missing — run\n` +
      `  npm run build --workspace @vsa/dashboard\nfirst`,
  );
  process.exit(1);
}

// --- 1. bundle the worker -------------------------------------------------------------------

rmSync(stagingDir, { recursive: true, force: true });
mkdirSync(stagingDir, { recursive: true });

console.log(`bundling worker.js (server version ${releaseVersion})`);
await esbuild.build({
  entryPoints: [workerEntry],
  bundle: true,
  outfile: path.join(stagingDir, 'worker.js'),
  format: 'esm', // Workers ESM entry; re-exports VaultRoom for the DO migration
  target: 'es2022',
  // Bakes the release version into packages/worker/src/version.ts (see
  // `releaseVersion` above); the un-substituted `-dev` fallback only ever
  // applies to wrangler dev / vitest, which run the source directly.
  define: { __VSA_SERVER_VERSION__: JSON.stringify(releaseVersion) },
  // 'neutral': Workers runtime — Web APIs only (@vsa/core is Web-API-only by
  // design), no Node/browser builtins auto-polyfilled.
  platform: 'neutral',
  // Runtime-provided module (the DurableObject base class): the Workers
  // runtime injects it at deploy time, so it must never be bundled.
  external: ['cloudflare:workers'],
  // Not minified on purpose (matches `wrangler deploy` defaults): keeps the
  // deployed Durable Object debuggable; size is far under the upload cap.
  minify: false,
  sourcemap: false,
  legalComments: 'none',
  logLevel: 'info',
});

// Sanity check: the template's DO migration needs the VaultRoom export to
// survive bundling (esbuild preserves entry-point exports in ESM output,
// though it may rename the default handler to `<entry>_default as default`).
const workerJs = readFileSync(path.join(stagingDir, 'worker.js'), 'utf8');
const exportClause = workerJs.match(/export\s*\{[^{}]*\}\s*;?\s*$/s)?.[0] ?? '';
if (!/\bVaultRoom\b/.test(exportClause) || !/\bdefault\b/.test(exportClause)) {
  console.error('error: bundled worker.js lost its VaultRoom/default exports — refusing to ship');
  process.exit(1);
}
// The version define must have landed (a dropped define would silently ship
// the `-dev` fallback, and clients would mis-assess version skew). esbuild
// substitutes the identifier EVERYWHERE — including inside the `typeof`
// guard, which it folds to `true` — so a surviving `__VSA_SERVER_VERSION__`
// identifier is conclusive proof of a dropped define. (With `minify: false`
// the dead fallback branch is kept, so its literal is NOT a valid signal.)
if (workerJs.includes('__VSA_SERVER_VERSION__') || !workerJs.includes(JSON.stringify(releaseVersion))) {
  console.error(
    `error: bundled worker.js does not carry the release version ${releaseVersion} ` +
      `(the __VSA_SERVER_VERSION__ define was not substituted) — refusing to ship`,
  );
  process.exit(1);
}

// --- 2. copy the dashboard SPA --------------------------------------------------------------

cpSync(dashboardDist, path.join(stagingDir, 'dashboard'), { recursive: true });

// --- 3. zip (top-level layout: worker.js + dashboard/) --------------------------------------

rmSync(zipPath, { force: true });
createZip();

// --- verify the archive layout --------------------------------------------------------------

const entries = listZipEntries().map((name) => name.replaceAll('\\', '/'));
const files = entries.filter((name) => !name.endsWith('/'));
const problems = [];
if (!files.includes('worker.js')) problems.push('missing top-level worker.js');
if (!files.some((name) => name === 'dashboard/index.html')) problems.push('missing dashboard/index.html');
for (const name of files) {
  if (!name.startsWith('worker.js') && !name.startsWith('dashboard/')) {
    problems.push(`unexpected entry outside the required layout: ${name}`);
  }
}
if (problems.length > 0) {
  console.error(`error: worker-bundle.zip has the wrong layout:\n  ${problems.join('\n  ')}`);
  console.error(`entries:\n  ${files.join('\n  ')}`);
  process.exit(1);
}

const { size } = statSync(zipPath);
console.log('');
console.log(`worker-bundle.zip ready: ${zipPath} (${(size / 1024).toFixed(1)} KiB, ${files.length} files)`);
console.log('layout:');
for (const name of files.sort()) console.log(`  ${name}`);

// --- zip writer ------------------------------------------------------------------------------

/**
 * Deterministic zip writer: every value a conventional archiver takes from
 * the environment is pinned instead, so the output is a pure function of the
 * staged inputs —
 *
 *   - timestamps: the constant DOS epoch 1980-01-01 00:00 (DOS_TIME/DOS_DATE
 *     above) in local headers AND the central directory,
 *   - order: entries sorted by archive path (readdir order varies by
 *     filesystem),
 *   - metadata: no extra fields, no data descriptors (sizes/CRC are written
 *     up-front from the buffered entry), neutral DOS version/attributes (no
 *     host permissions), and the UTF-8 name flag (bit 11) only for non-ASCII
 *     names — the bundle's names are ASCII, so it is never set.
 *
 * The whole archive is buffered in memory (the bundle is a few hundred KiB)
 * and written with a single writeFileSync.
 */
function createZip() {
  const staged = readdirSync(stagingDir, { recursive: true, withFileTypes: true })
    .filter((dirent) => dirent.isFile())
    .map((dirent) => path.relative(stagingDir, path.join(dirent.parentPath, dirent.name)).replaceAll('\\', '/'))
    .sort();
  if (staged.length > 0xffff) {
    console.error('error: zip cannot hold more than 65535 entries');
    process.exit(1);
  }

  const localParts = [];
  const centralParts = [];
  let offset = 0;
  for (const name of staged) {
    const data = readFileSync(path.join(stagingDir, ...name.split('/')));
    const nameBytes = Buffer.from(name, 'utf8');
    const flags = /[\u0080-\uffff]/.test(name) ? 0x0800 : 0; // bit 11: UTF-8 name
    const crc = crc32(data);
    const packed = deflateRawSync(data, { level: 9 });

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); // local file header signature
    local.writeUInt16LE(20, 4); // version needed to extract (2.0 — deflate)
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(8, 8); // method: deflate
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(0, 28); // extra field length
    localParts.push(local, nameBytes, packed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); // central directory header signature
    central.writeUInt16LE(0x0014, 4); // version made by (2.0, MS-DOS — neutral)
    central.writeUInt16LE(20, 6); // version needed to extract
    central.writeUInt16LE(flags, 8);
    central.writeUInt16LE(8, 10); // method: deflate
    central.writeUInt16LE(DOS_TIME, 12);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(packed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt16LE(0, 30); // extra field length
    central.writeUInt16LE(0, 32); // file comment length
    central.writeUInt16LE(0, 34); // disk number start
    central.writeUInt16LE(0, 36); // internal file attributes
    central.writeUInt32LE(0, 38); // external file attributes (no host perms)
    central.writeUInt32LE(offset, 42); // local header offset
    centralParts.push(central, nameBytes);

    offset += local.length + nameBytes.length + packed.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); // end of central directory signature
  eocd.writeUInt16LE(0, 4); // this disk
  eocd.writeUInt16LE(0, 6); // disk with the central directory
  eocd.writeUInt16LE(staged.length, 8);
  eocd.writeUInt16LE(staged.length, 10);
  eocd.writeUInt32LE(centralDirectory.length, 12);
  eocd.writeUInt32LE(offset, 16); // central directory offset
  eocd.writeUInt16LE(0, 20); // comment length

  writeFileSync(zipPath, Buffer.concat([...localParts, centralDirectory, eocd]));
  console.log(`zipped ${staged.length} files (deterministic zip writer)`);
}

/**
 * Entry names inside the zip, parsed from the central directory in Node —
 * the layout check below needs no platform zip tool either.
 */
function listZipEntries() {
  const zip = readFileSync(zipPath);
  const eocd = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0) {
    console.error('error: worker-bundle.zip has no end-of-central-directory record');
    process.exit(1);
  }
  const names = [];
  let pos = zip.readUInt32LE(eocd + 16);
  for (let i = 0, count = zip.readUInt16LE(eocd + 10); i < count; i += 1) {
    if (zip.readUInt32LE(pos) !== 0x02014b50) {
      console.error('error: worker-bundle.zip central directory is corrupt');
      process.exit(1);
    }
    const nameLength = zip.readUInt16LE(pos + 28);
    names.push(zip.subarray(pos + 46, pos + 46 + nameLength).toString('utf8'));
    pos += 46 + nameLength + zip.readUInt16LE(pos + 30) + zip.readUInt16LE(pos + 32);
  }
  return names;
}
