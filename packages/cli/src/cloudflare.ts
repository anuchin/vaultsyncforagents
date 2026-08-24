/**
 * The Cloudflare surface `vsa setup` drives (FR-50): an injectable `Exec`
 * seam (same shape as @vsa/daemon's service plumbing, plus env + stdio
 * options) that shells out to `npx wrangler`, a REST account probe for the
 * API-token path, and the cross-platform browser opener.
 *
 * Wrangler facts this module relies on (verified against
 * developers.cloudflare.com/workers/wrangler/commands/general/):
 * - `wrangler whoami --json` returns machine-readable auth state and exits
 *   non-zero when not authenticated;
 * - `wrangler login` opens the browser and blocks until the OAuth callback
 *   lands (`--browser=false` prints the link instead);
 * - `wrangler r2 bucket info <name>` / `create <name>` manage the bucket;
 * - `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` env vars make every
 *   wrangler command non-interactive (they also override stored OAuth creds).
 *
 * The release-bundle download additionally verifies integrity (a pinned
 * SHA-256 or the release's `.sha256` sidecar) and enforces download/zip size
 * caps — the extracted worker.js is deployed into the user's Cloudflare
 * account, so a tampered or bomb archive must never get that far.
 */

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { unzip, type Unzipped } from 'fflate';
import { MAX_BUNDLE_DOWNLOAD_BYTES, assertWithinZipCaps } from '@vsa/core';

// Deploy-domain size caps and the zip-bomb gate moved to @vsa/core
// (core/src/deploy.ts) — shared verbatim with the plugin's in-app wizard.
// Re-exported for the CLI's own tests and callers.
export {
  MAX_ARCHIVE_UNCOMPRESSED_BYTES,
  MAX_BUNDLE_DOWNLOAD_BYTES,
  MAX_ENTRY_UNCOMPRESSED_BYTES,
} from '@vsa/core';

/** Result of one command invocation (exit status + captured output). */
export interface ExecResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface ExecOptions {
  /** Extra environment variables (merged over the current process env). */
  env?: Record<string, string>;
  /** Wire stdio through to the terminal (`wrangler login` needs it). */
  inheritStdio?: boolean;
  /** Working directory for the child (default: the current one). */
  cwd?: string;
}

/**
 * Injectable process runner. Never throws — failures are `{code≠0}`.
 * Mirrors @vsa/daemon's `Exec` (packages/daemon/src/services/service.ts)
 * with the extra options `vsa setup` needs.
 */
export type Exec = (command: string, args: readonly string[], options?: ExecOptions) => Promise<ExecResult>;

export const defaultExec: Exec = (command, args, options = {}) =>
  new Promise((resolve) => {
    // Windows needs `shell: true` for .cmd shims (`npx` is npx.cmd); Node's
    // shell mode joins args with spaces unquoted, so quote them ourselves.
    const useShell = process.platform === 'win32';
    const shellArgs = useShell ? args.map((arg) => (/[\s"]/.test(arg) ? `"${arg.replace(/"/g, '\\"')}"` : arg)) : args;
    const child = spawn(command, shellArgs, {
      stdio: options.inheritStdio === true ? 'inherit' : ['ignore', 'pipe', 'pipe'],
      env: options.env === undefined ? process.env : { ...process.env, ...options.env },
      ...(options.cwd !== undefined ? { cwd: options.cwd } : {}),
      shell: useShell,
    });
    let stdout = '';
    let stderr = '';
    if (child.stdout !== null) child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString('utf8')));
    if (child.stderr !== null) child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString('utf8')));
    child.on('error', (error: NodeJS.ErrnoException) => {
      resolve({
        code: typeof error.code === 'number' ? error.code : 127,
        stdout,
        stderr: stderr === '' ? `${command}: ${error.message}` : stderr,
      });
    });
    child.on('close', (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });

// --- whoami --------------------------------------------------------------------------------

export type WhoamiStatus = 'ok' | 'not-logged-in' | 'expired';

export interface CloudflareAccount {
  id: string;
  name: string;
}

export interface WhoamiInfo {
  status: WhoamiStatus;
  accounts: CloudflareAccount[];
  /** Raw `--json` payload when one was produced (diagnostics). */
  raw?: unknown;
}

/**
 * Parse `wrangler whoami --json` output. Tolerant by design — wrangler's JSON
 * shape carries auth type, email, accounts, and token scopes, and the exact
 * field set varies across versions, so only what setup needs is read.
 */
export function parseWhoami(stdout: string, code: number): WhoamiInfo {
  const text = stdout.trim();
  const jsonStart = text.indexOf('{');
  if (jsonStart === -1) return { status: code === 0 ? 'ok' : 'not-logged-in', accounts: [] };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.slice(jsonStart)) as unknown;
  } catch {
    return { status: code === 0 ? 'ok' : 'not-logged-in', accounts: [] };
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return { status: code === 0 ? 'ok' : 'not-logged-in', accounts: [] };
  }
  const doc = parsed as Record<string, unknown>;
  const status = whoamiStatus(doc, code);
  return { status, accounts: parseAccounts(doc), raw: parsed };
}

function whoamiStatus(doc: Record<string, unknown>, code: number): WhoamiStatus {
  // Both OAuth expiry and API-token rejection surface as an auth error string.
  const authError = typeof doc.auth_error === 'string' ? doc.auth_error.toLowerCase() : '';
  const tokenStatus =
    typeof doc.token_status === 'string'
      ? doc.token_status.toLowerCase()
      : typeof doc.tokenStatus === 'string'
        ? doc.tokenStatus.toLowerCase()
        : '';
  if (/expir/.test(authError) || /expir/.test(tokenStatus)) return 'expired';
  const authenticated =
    code === 0 &&
    (doc.accounts !== undefined || doc.email !== undefined || doc.scopes !== undefined);
  const explicitlyUnauthenticated =
    /not logged in|not authenticated|no user/.test(authError) ||
    doc.authenticated === false;
  return authenticated && !explicitlyUnauthenticated ? 'ok' : 'not-logged-in';
}

function parseAccounts(doc: Record<string, unknown>): CloudflareAccount[] {
  const source = Array.isArray(doc.accounts) ? doc.accounts : [];
  const accounts: CloudflareAccount[] = [];
  for (const entry of source) {
    if (typeof entry !== 'object' || entry === null) continue;
    const record = entry as Record<string, unknown>;
    const id = firstString(record.id, record.account_id, record.accountId);
    const name = firstString(record.name, record.accountName);
    if (id !== undefined) accounts.push({ id, name: name ?? id });
  }
  return accounts;
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value !== '') return value;
  }
  return undefined;
}

// --- Cloudflare REST (API-token path) -------------------------------------------------------

export interface RestAccount {
  id: string;
  name: string;
}

/**
 * Verify an API token and list its accounts via
 * `GET https://api.cloudflare.com/client/v4/accounts` (the documented
 * envelope: `{ success, result: [{ id, name, … }] }`).
 */
export async function restListAccounts(
  token: string,
  fetchImpl: typeof fetch,
): Promise<RestAccount[]> {
  let response: Response;
  try {
    response = await fetchImpl('https://api.cloudflare.com/client/v4/accounts?per_page=50', {
      headers: { authorization: `Bearer ${token}` },
    });
  } catch (error) {
    throw new Error(
      `could not reach the Cloudflare API (${
        error instanceof Error ? error.message : String(error)
      })`,
    );
  }
  if (response.status === 401 || response.status === 403) {
    throw new Error('Cloudflare rejected the API token — check that it is valid and not expired');
  }
  if (!response.ok) {
    throw new Error(`Cloudflare API returned HTTP ${response.status}`);
  }
  const body = (await response.json().catch(() => null)) as
    | { success?: boolean; result?: unknown }
    | null;
  if (body === null || body.success !== true || !Array.isArray(body.result)) {
    throw new Error('unexpected response from the Cloudflare accounts API');
  }
  const accounts: RestAccount[] = [];
  for (const entry of body.result) {
    if (typeof entry !== 'object' || entry === null) continue;
    const record = entry as Record<string, unknown>;
    const id = typeof record.id === 'string' ? record.id : undefined;
    if (id === undefined) continue;
    accounts.push({ id, name: typeof record.name === 'string' ? record.name : id });
  }
  return accounts;
}

// --- browser open ---------------------------------------------------------------------------

/** The command that opens `url` in the default browser on this platform. */
export function browserOpenCommand(platform: string, url: string): { command: string; args: string[] } {
  if (platform === 'win32') return { command: 'cmd', args: ['/c', 'start', '', url] };
  if (platform === 'darwin') return { command: 'open', args: [url] };
  return { command: 'xdg-open', args: [url] };
}

// --- the control surface --------------------------------------------------------------------

/** Options for wrangler invocations (env vars + cwd + stdio passthrough). */
export type WranglerRunOptions = ExecOptions;

/** Injectable Cloudflare surface used by `vsa setup`; see commands/setup.ts. */
export interface CloudflareControl {
  /** `npx wrangler whoami --json`, parsed. */
  whoami(env?: Record<string, string>): Promise<WhoamiInfo>;
  /** `npx wrangler login` (interactive; stdio inherited so the browser flow works). */
  login(): Promise<ExecResult>;
  /** `npx wrangler r2 bucket info <name> --json`. */
  bucketInfo(name: string, env?: Record<string, string>): Promise<ExecResult>;
  /** `npx wrangler r2 bucket create <name>`. */
  bucketCreate(name: string, env?: Record<string, string>): Promise<ExecResult>;
  /** `npx wrangler deploy` in `cwd`. */
  deploy(cwd: string, env?: Record<string, string>): Promise<ExecResult>;
  /**
   * Download a release URL (the worker bundle zip) — sha-verified and
   * size-capped (see `downloadBundle`).
   */
  download(url: string): Promise<Uint8Array>;
  /** `GET /client/v4/accounts` with a pasted API token (verify + list). */
  restListAccounts(token: string): Promise<RestAccount[]>;
  /** Extract a zip into `destDir` (pure-JS fflate — no system tar/unzip). */
  extractZip(zipPath: string, destDir: string, env?: Record<string, string>): Promise<ExecResult>;
  /** Open the default browser at `url` (platform dispatch). */
  openBrowser(url: string): Promise<ExecResult>;
}

/** How `npx` is invoked; overridable for tests/pinned installs. */
export interface WranglerCliOptions {
  /** npm client command (`npx`, `yarn`, `pnpm` — default `npx`). */
  npmCommand?: string;
  /** Wrangler version spec for `npx -y wrangler@<spec>` (default `4`). */
  wranglerVersion?: string;
  exec?: Exec;
  fetchImpl?: typeof fetch;
  platform?: string;
  /**
   * SHA-256 (hex) the downloaded release bundle must hash to — a hard fail
   * on mismatch. Empty/undefined = not pinned: the release's `.sha256`
   * sidecar decides, and when even that is missing (releases before v0.1.3)
   * only a warning is emitted. Wired from `PINNED_BUNDLE_SHA256` in
   * commands/setup.ts.
   */
  bundleSha256?: string;
  /** Warning sink for the download path (default: console.warn). */
  warn?: (message: string) => void;
  /** Refuse bundle bodies above this many bytes (default: 100 MB). */
  maxDownloadBytes?: number;
}

export function createCloudflareControl(options: WranglerCliOptions = {}): CloudflareControl {
  const exec = options.exec ?? defaultExec;
  const fetchImpl = options.fetchImpl ?? fetch;
  const platform = options.platform ?? process.platform;
  const npm = options.npmCommand ?? 'npx';
  const bundleSha256 = options.bundleSha256 ?? '';
  const warn = options.warn ?? ((message: string) => console.warn(message));
  const maxDownloadBytes = options.maxDownloadBytes ?? MAX_BUNDLE_DOWNLOAD_BYTES;
  // -y: never stop to ask about installing the wrangler package.
  const wrangler = ['-y', `wrangler@${options.wranglerVersion ?? '4'}`];

  const run = (args: readonly string[], runOptions: WranglerRunOptions = {}): Promise<ExecResult> =>
    exec(npm, [...wrangler, ...args], runOptions);

  return {
    whoami: (env) => run(['whoami', '--json'], { env }).then(parse),
    login: () => run(['login'], { inheritStdio: true }),
    bucketInfo: (name, env) => run(['r2', 'bucket', 'info', name, '--json'], { env }),
    bucketCreate: (name, env) => run(['r2', 'bucket', 'create', name], { env }),
    deploy: (cwd, env) => run(['deploy'], { cwd, env }),
    async download(url) {
      return downloadBundle(url, {
        fetchImpl,
        pinnedSha256: bundleSha256,
        warn,
        maxBytes: maxDownloadBytes,
      });
    },
    restListAccounts: (token) => restListAccounts(token, fetchImpl),
    async extractZip(zipPath, destDir) {
      // Pure-JS unzip (fflate) — no system tar/unzip, so the published npm
      // package works with nothing but Node installed. Same contract as the
      // shell-out it replaced: {code: 0} on success, {code≠0, stderr} on
      // failure (setup.ts surfaces the message verbatim).
      try {
        const bytes = new Uint8Array(await readFile(zipPath));
        // Zip-bomb gate BEFORE inflating anything (fflate's unzip fully
        // materializes every entry in memory).
        assertWithinZipCaps(bytes);
        const entries = await unzipFile(bytes);
        const root = resolve(destDir);
        let files = 0;
        for (const [name, bytes] of Object.entries(entries)) {
          if (name === '' || name.endsWith('/')) continue; // directory marker
          const target = resolve(root, name);
          const rel = relative(root, target);
          if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) {
            throw new Error(`refusing to extract ${name} (escapes ${destDir})`);
          }
          await mkdir(dirname(target), { recursive: true });
          await writeFile(target, bytes);
          files += 1;
        }
        return { code: 0, stdout: `extracted ${files} file(s)`, stderr: '' };
      } catch (error) {
        return {
          code: 1,
          stdout: '',
          stderr: error instanceof Error ? error.message : String(error),
        };
      }
    },
    openBrowser: (url) => {
      const { command, args } = browserOpenCommand(platform, url);
      return exec(command, args);
    },
  };
}

// --- release-bundle download (integrity + caps) ----------------------------------------------

export interface BundleDownloadOptions {
  fetchImpl: typeof fetch;
  /**
   * Pinned SHA-256 (hex) of the bundle — hard-fails on mismatch. Empty =
   * not pinned: the `.sha256` sidecar uploaded next to the asset decides,
   * and when even that is absent (releases before v0.1.3) only a warning
   * is emitted. Hex comparison is case-insensitive.
   */
  pinnedSha256?: string;
  /** Sink for non-fatal notices (default: console.warn). */
  warn?: (message: string) => void;
  /** Refuse bodies above this many bytes (default: 100 MB). */
  maxBytes?: number;
}

/**
 * Download a release bundle with a size cap and integrity verification. The
 * extracted worker.js is deployed into the user's Cloudflare account, so a
 * tampered or runaway download must never get that far:
 *
 *   1. a pinned sha256 (when baked in) must match — hard fail on mismatch;
 *   2. else the release's `.sha256` sidecar (`<url>.sha256`, uploaded by
 *      release.yml since v0.1.3) must match — hard fail on mismatch;
 *   3. else (older releases, no sidecar) warn and proceed.
 */
export async function downloadBundle(
  url: string,
  options: BundleDownloadOptions,
): Promise<Uint8Array> {
  const warn = options.warn ?? ((message: string) => console.warn(message));
  const maxBytes = options.maxBytes ?? MAX_BUNDLE_DOWNLOAD_BYTES;

  let response: Response;
  try {
    response = await options.fetchImpl(url);
  } catch (error) {
    throw new Error(
      `could not download the worker bundle from ${url} (${
        error instanceof Error ? error.message : String(error)
      })`,
    );
  }
  if (!response.ok) {
    throw new Error(
      `could not download the worker bundle from ${url} (HTTP ${response.status})`,
    );
  }
  const bytes = await readBodyCapped(response, maxBytes, url);

  const actual = createHash('sha256').update(bytes).digest('hex');
  const pinned = (options.pinnedSha256 ?? '').trim().toLowerCase();
  if (pinned !== '') {
    if (pinned !== actual) {
      throw new Error(
        `worker bundle integrity check FAILED for ${url}: sha256 ${actual} does not match the pinned ${pinned} — the download is corrupted or tampered with; refusing to deploy it`,
      );
    }
    return bytes;
  }

  // No pin baked in: the release's sidecar is the authority.
  let sidecar: Response | null = null;
  try {
    const probe = await options.fetchImpl(`${url}.sha256`);
    if (probe.ok) sidecar = probe;
  } catch {
    // unreachable sidecar — same as absent, handled below
  }
  if (sidecar === null) {
    warn(
      `no integrity check available for the worker bundle (${url} ships no .sha256 sidecar and no digest is pinned) — proceeding unverified`,
    );
    return bytes;
  }
  const expected = firstHex64(await sidecar.text());
  if (expected === null) {
    throw new Error(
      `invalid .sha256 sidecar at ${url}.sha256 (no 64-hex digest found) — refusing to deploy`,
    );
  }
  if (expected !== actual) {
    throw new Error(
      `worker bundle integrity check FAILED for ${url}: sha256 ${actual} does not match the release's ${expected} — the download is corrupted or tampered with; refusing to deploy it`,
    );
  }
  return bytes;
}

/** First run of 64 hex chars in `text` (`sha256sum` writes `<hex>  <file>`). */
function firstHex64(text: string): string | null {
  return /[0-9a-fA-F]{64}/.exec(text)?.[0]?.toLowerCase() ?? null;
}

/**
 * Buffer at most `maxBytes` of the body: refuse up front on a declared
 * `content-length`, abort the stream as it crosses the cap otherwise — the
 * body is never buffered whole and then counted.
 */
async function readBodyCapped(
  response: Response,
  maxBytes: number,
  url: string,
): Promise<Uint8Array> {
  const declared = Number(response.headers.get('content-length') ?? '');
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new Error(
      `refusing to download the worker bundle from ${url}: ${formatBytes(declared)} declared, over the ${formatBytes(maxBytes)} cap`,
    );
  }
  if (response.body === null) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > maxBytes) {
      throw new Error(
        `refusing to download the worker bundle from ${url}: body exceeds the ${formatBytes(maxBytes)} cap`,
      );
    }
    return bytes;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done === true || value === undefined) break;
    if (total + value.byteLength > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new Error(
        `refusing to download the worker bundle from ${url}: body passed the ${formatBytes(maxBytes)} cap — download aborted`,
      );
    }
    chunks.push(value);
    total += value.byteLength;
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${bytes} bytes`;
}

// --- zip extraction (pure JS) ----------------------------------------------------------------

/** Promisified fflate `unzip` — `{ name: bytes }` for every entry in the archive. */
function unzipFile(data: Uint8Array): Promise<Unzipped> {
  return new Promise((resolve, reject) => {
    unzip(data, (error, unzipped) => {
      if (error !== null) reject(new Error(`invalid zip archive: ${error.message}`));
      else resolve(unzipped);
    });
  });
}

function parse(result: ExecResult): WhoamiInfo {
  return parseWhoami(result.stdout, result.code);
}
