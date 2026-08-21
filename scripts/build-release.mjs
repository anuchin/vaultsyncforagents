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
 * anything new. Zipping uses platform tools only: Windows' bsdtar
 * (%SystemRoot%\System32\tar.exe, real zip via `-a` + .zip extension), any
 * bsdtar on PATH, `zip`, or PowerShell Compress-Archive as a last resort.
 */
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import esbuild from 'esbuild';

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
await createZip();

// --- verify the archive layout --------------------------------------------------------------

const entries = (await listZipEntries()).map((name) => name.replaceAll('\\', '/'));
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

// --- zip helpers -----------------------------------------------------------------------------

/**
 * Create the zip with `stagingDir` as the archive root so entries land at the
 * top level. Strategy order:
 *   1. Windows bsdtar at %SystemRoot%\System32\tar.exe (`-a` + .zip extension
 *      makes a real zip; ships with Windows 10+),
 *   2. any bsdtar on PATH (macOS default tar),
 *   3. Info-ZIP `zip` (preinstalled on ubuntu runners),
 *   4. PowerShell Compress-Archive (Windows fallback; note PS 5.1 writes
 *      backslash separators some Linux unzip versions mangle — hence last).
 */
async function createZip() {
  const relEntries = ['worker.js', 'dashboard'];
  const systemTar = process.platform === 'win32' && existsSync(`${process.env.SystemRoot ?? 'C:\\Windows'}\\System32\\tar.exe`)
    ? `${process.env.SystemRoot ?? 'C:\\Windows'}\\System32\\tar.exe`
    : null;
  const attempts = [
    systemTar && {
      label: 'bsdtar (System32)',
      cmd: systemTar,
      args: ['-a', '-cf', zipPath, '-C', stagingDir, ...relEntries],
    },
    (await tarIsBsdtar('tar')) && {
      label: 'bsdtar (PATH)',
      cmd: 'tar',
      args: ['-a', '-cf', zipPath, '-C', stagingDir, ...relEntries],
    },
    (await haveCommand('zip')) && {
      label: 'zip',
      cmd: 'zip',
      args: ['-r', '-q', zipPath, ...relEntries],
      cwd: stagingDir,
    },
    process.platform === 'win32' && {
      label: 'PowerShell Compress-Archive',
      cmd: 'powershell.exe',
      args: [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `Compress-Archive -Path @('worker.js','dashboard') -DestinationPath '${zipPath.replaceAll("'", "''")}' -Force`,
      ],
      cwd: stagingDir,
    },
  ].filter(Boolean);

  for (const attempt of attempts) {
    const result = spawnSync(attempt.cmd, attempt.args, {
      cwd: attempt.cwd ?? rootDir,
      stdio: ['ignore', 'pipe', 'pipe'],
      encoding: 'utf8',
      windowsHide: true,
    });
    if (result.status === 0) {
      console.log(`zipped via ${attempt.label}`);
      return;
    }
    console.warn(
      `${attempt.label} failed (exit ${result.status}):\n${result.stderr || result.stdout || '(no output)'}`,
    );
  }
  console.error('error: no usable zip tool (bsdtar / zip / PowerShell Compress-Archive all failed)');
  process.exit(1);
}

/** Entry names inside the zip, via bsdtar -tf or unzip -Z1 (whichever exists). */
async function listZipEntries() {
  const listers = [];
  const systemTar = process.platform === 'win32' && existsSync(`${process.env.SystemRoot ?? 'C:\\Windows'}\\System32\\tar.exe`)
    ? `${process.env.SystemRoot ?? 'C:\\Windows'}\\System32\\tar.exe`
    : null;
  if (systemTar) listers.push({ cmd: systemTar, args: ['-tf', zipPath] });
  if (await tarIsBsdtar('tar')) listers.push({ cmd: 'tar', args: ['-tf', zipPath] });
  if (await haveCommand('unzip')) listers.push({ cmd: 'unzip', args: ['-Z1', zipPath] });
  for (const lister of listers) {
    const result = spawnSync(lister.cmd, lister.args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      encoding: 'utf8',
      windowsHide: true,
    });
    if (result.status === 0) {
      return result.stdout.split(/\r?\n/).map((line) => line.trim()).filter((line) => line !== '');
    }
  }
  console.error('error: could not list worker-bundle.zip contents to verify the layout');
  process.exit(1);
}

/** True iff `tar --version` reports bsdtar (GNU tar cannot write zips). */
async function tarIsBsdtar(cmd) {
  const result = spawnSync(cmd, ['--version'], { encoding: 'utf8', windowsHide: true });
  return result.status === 0 && /bsdtar/i.test(result.stdout);
}

/** True iff `cmd` resolves (spawn failure — e.g. ENOENT — means absent). */
async function haveCommand(cmd) {
  const probe = spawnSync(cmd, ['--version'], { encoding: 'utf8', windowsHide: true });
  return probe.error === undefined;
}
