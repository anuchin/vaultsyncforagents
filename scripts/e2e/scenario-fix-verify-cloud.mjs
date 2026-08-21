/**
 * LIVE FIX-VERIFY against a DEPLOYED Cloudflare worker (VSA_E2E_WORKER) —
 * completes the cancelled verification of the recent fixes on the REAL
 * two-vault dogfood setup (TestVault4 + TestVault5, real Obsidian via CDP):
 *
 *   A1  launch: vault4 auto-reconnects (pairing persisted); vault5 loads
 *       UNLINKED after the disk-level unlink mirroring plugin.unlink()
 *   A2  F-A regression (the original bug repro): fresh pairing code minted
 *       via the admin API, vault5 paired through the plugin's pairing UI
 *       (settings modal path first — this Obsidian build never rendered it in
 *       prior runs, so a NEW-WINDOW probe + direct tab render are tried —
 *       then the settings button's exact handler fallback), full sync over
 *       ~47 pre-existing byte-identical files. ASSERT: conflicts === 0 both
 *       vaults, no `⚠ conflicts` status bar, zero ` (conflict …- from …)`
 *       copies anywhere, file set converged (spot-checks e2e-h-01.md,
 *       blob-smoke.bin sha, one RVP file, vps-cli-check file).
 *   A3  genuine-conflict guard + lifecycle: divergent same-path creates on
 *       both vaults (paused) → conflict copy + ⚠ + conflicts >= 1; then a
 *       clean cycle → counter back to 0 (conflicts list REPLACED per cycle,
 *       not append-only) and copy count stable across extra cycles.
 *   A4  F-2 About tab: settings → About; "Vault storage" renders REAL
 *       numbers from the worker; zero CORS/console errors for /api/status.
 *
 * Evidence: scripts/e2e/report-fix-verify-cloud.json + stdout. Exit 0 iff
 * every step passed. TEARDOWN: kills Obsidian, LEAVES the deployed worker
 * untouched and both vaults paired+synced.
 *
 * Usage: node scripts/e2e/scenario-fix-verify-cloud.mjs
 *   VSA_E2E_WORKER      worker base URL (default http://127.0.0.1:8797)
 *   VSA_E2E_PASSPHRASE  admin passphrase (default two-vault-test — LOCAL
 *                       wrangler-dev rooms only; set this for a deployed room)
 */

import { execFile, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { Cdp, connectPage, listTargets } from './cdp.mjs';

const execFileP = promisify(execFile);
const HERE = join(fileURLToPath(import.meta.url), '..');

// --- constants ---------------------------------------------------------------------------------

// Target worker + admin passphrase come from the env (see header) — no
// deployed URL or live passphrase is hardcoded here.
const WORKER = process.env.VSA_E2E_WORKER ?? 'http://127.0.0.1:8797';
const PASSPHRASE = process.env.VSA_E2E_PASSPHRASE ?? 'two-vault-test';

const OBSIDIAN_EXE = 'C:\\Program Files\\Obsidian\\Obsidian.exe';
const PLUGIN_PKG = 'Z:/Projects/syncv2/packages/plugin';
const V4_DIR = 'Z:/Projects/TestVaults/TestVault4';
const V5_DIR = 'Z:/Projects/TestVaults/TestVault5';
const PROFILE_A = 'Z:/Projects/TestVaults/e2e-hardened-profile'; // opens TestVault4
const PROFILE_B = 'Z:/Projects/TestVaults/e2e-hardened-profile-b'; // opens TestVault5
const PORT_A = 9222;
const PORT_B = 9223;
const CDP_A = `http://127.0.0.1:${PORT_A}`;
const CDP_B = `http://127.0.0.1:${PORT_B}`;

const DEVICE4 = 'e2e-vault4';
const DEVICE5 = 'e2e-vault5-renamed';
const SYNC_TIMEOUT_MS = 45_000; // real-network propagation budget
const FULL_SYNC_TIMEOUT_MS = 180_000; // fresh-pair pulls ~47 files + 600KB blob through real R2
const PAIR_RACE_MS = 40_000;

/** The conflict-copy suffix format from core/conflictnames.ts: ` (conflict … - from DEVICE)`. */
const CONFLICT_COPY_RE = /\(conflict .+ - from /i;

const jstr = JSON.stringify;

// --- reporting -----------------------------------------------------------------------------------

const report = {
  startedAt: new Date().toISOString(),
  worker: WORKER,
  steps: [],
  decisions: [],
};
const lines = [];
function step(id, name) {
  const entry = { id, name, status: 'RUNNING', t0: Date.now() };
  report.steps.push(entry);
  lines.push(`[RUN ] ${id} ${name}`);
  return {
    pass(detail) {
      entry.status = 'PASS';
      entry.ms = Date.now() - entry.t0;
      entry.detail = detail;
      lines.push(`[PASS] ${id} ${name} (${entry.ms} ms)${detail === undefined ? '' : ` — ${fmt(detail)}`}`);
    },
    fail(detail) {
      entry.status = 'FAIL';
      entry.ms = Date.now() - entry.t0;
      entry.detail = detail;
      lines.push(`[FAIL] ${id} ${name} (${entry.ms} ms) — ${fmt(detail)}`);
    },
  };
}
function fmt(d) {
  return typeof d === 'string' ? d : JSON.stringify(d);
}
function log(...a) {
  lines.push(a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' '));
}
function decide(text) {
  report.decisions.push(text);
  log(`[DECISION] ${text}`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(fn, timeoutMs, everyMs = 500, label = '') {
  const t0 = Date.now();
  let lastErr;
  for (;;) {
    try {
      const v = await fn();
      if (v !== undefined && v !== null && v !== false) return { value: v, elapsedMs: Date.now() - t0 };
    } catch (e) {
      lastErr = e;
    }
    if (Date.now() - t0 > timeoutMs) {
      throw new Error(`waitFor${label ? `(${label})` : ''} timed out after ${timeoutMs} ms${lastErr ? ` (last: ${lastErr})` : ''}`);
    }
    await sleep(everyMs);
  }
}

/** Run a step body once; on throw, retry once (evidence rule), then give up. BOTH attempts caught. */
async function withRetry(fn) {
  try {
    return { ok: true, result: await fn(false) };
  } catch (first) {
    log(`  retry-after-error: ${String(first.message ?? first).slice(0, 300)}`);
    try {
      return { ok: true, result: await fn(true) };
    } catch (second) {
      log(`  retry-also-failed: ${String(second.message ?? second).slice(0, 300)}`);
      return { ok: false, error: second };
    }
  }
}

// --- worker HTTP -----------------------------------------------------------------------------------

async function wk(path, init = {}) {
  const res = await fetch(`${WORKER}${path}`, { signal: AbortSignal.timeout(15_000), ...init });
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: res.status, body, headers: res.headers };
}

async function adminLogin() {
  const login = await wk('/admin/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ passphrase: PASSPHRASE }),
  });
  if (login.status !== 200) throw new Error(`admin login HTTP ${login.status}: ${fmt(login.body)}`);
  const cookie = (login.headers.get('set-cookie') ?? '').split(';')[0];
  if (!cookie.startsWith('vsa_admin=')) throw new Error(`unexpected cookie: ${cookie.slice(0, 30)}`);
  return cookie;
}

// --- vault helpers (via CDP) -------------------------------------------------------------------------

async function readTextOrNull(cdp, path) {
  const r = await cdp.eval(
    `(async()=>{ try { return { ok:true, text: await app.vault.adapter.read(${jstr(path)}) }; } catch(e){ return { ok:false }; } })()`,
  );
  if (!r.ok) throw new Error(`readText eval: ${r.error}`);
  return r.value.ok ? r.value.text : null;
}
async function exists(cdp, path) {
  const r = await cdp.eval(
    `app.vault.adapter.exists(${jstr(path)}).then(v => ({ok:true, v}), e => ({ok:false, error:String(e)}))`,
  );
  if (!r.ok) throw new Error(`exists eval: ${r.error}`);
  return r.value.v === true;
}
async function sha256InVault(cdp, path) {
  const r = await cdp.eval(`(async () => {
    try {
      let data;
      const f = app.vault.getAbstractFileByPath(${jstr(path)});
      if (f) data = new Uint8Array(await app.vault.readBinary(f));
      else data = new Uint8Array(await app.vault.adapter.readBinary(${jstr(path)}));
      const h = await crypto.subtle.digest('SHA-256', data);
      return { ok: true, sha: [...new Uint8Array(h)].map(b => b.toString(16).padStart(2, '0')).join(''), size: data.length };
    } catch (e) { return { ok: false, error: String(e) }; }
  })()`);
  if (!r.ok) throw new Error(`sha256 eval: ${r.error}`);
  return r.value;
}
async function pluginStatus(cdp) {
  const r = await cdp.eval(`(() => { const p = app.plugins?.plugins?.vaultsyncforagents; if (!p) return null;
    return { statusBar: p.statusBarItem?.textContent ?? null, status: p.client?.status?.() ?? null,
      url: p.data?.url ?? null, deviceId: p.data?.deviceId ?? null, tokenLen: (p.data?.token || '').length,
      deviceName: p.data?.deviceName ?? null, paused: !!p.syncingPaused, linked: !!p.linked,
      hasClient: !!p.client }; })()`);
  if (!r.ok) throw new Error(`pluginStatus eval: ${r.error}`);
  return r.value;
}
/** Strict conflict-COPY files (core suffix format); `generic` also returns loose /conflict/i hits. */
async function conflictFiles(cdp, { generic = false } = {}) {
  const re = generic ? 'conflict' : String.raw`\(conflict .+ - from `;
  const r = await cdp.eval(`app.vault.getFiles().filter(f => /${re}/i.test(f.path)).map(f => f.path)`);
  if (!r.ok) throw new Error(`conflictFiles eval: ${r.error}`);
  return r.value;
}
async function syncNow(cdp) {
  return cdp.eval(`(async()=>{ const p = app.plugins?.plugins?.vaultsyncforagents; if (!p?.syncNow) return 'no-plugin'; await p.syncNow(); return 'synced'; })()`);
}
async function awaitNoteArrival(cdp, path, want, timeoutMs = SYNC_TIMEOUT_MS) {
  const r = await waitFor(async () => {
    if (!(await exists(cdp, path))) return null;
    return (await readTextOrNull(cdp, path)) === want ? true : null;
  }, timeoutMs, 400, `arrival ${path}`);
  return r.elapsedMs;
}

// --- launch / first-run dialogs -----------------------------------------------------------------------

function launchObsidian(profileDir, port) {
  if (!existsSync(OBSIDIAN_EXE)) throw new Error(`Obsidian.exe not found at ${OBSIDIAN_EXE}`);
  const child = spawn(OBSIDIAN_EXE, [`--user-data-dir=${profileDir}`, `--remote-debugging-port=${port}`], {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
  return child.pid;
}

async function driveFirstRunDialogs(cdp) {
  const r = await cdp.eval(`(() => {
    const clicked = [];
    for (const b of document.querySelectorAll('.modal button')) {
      const t = (b.textContent || '').trim();
      if (/trust author/i.test(t) || /turn on community plugins/i.test(t) || /enable community plugins/i.test(t)) { b.click(); clicked.push(t); }
    }
    return clicked;
  })()`);
  return r.ok ? r.value : [];
}

async function awaitInstanceReady({ http, match, label }) {
  const t0 = Date.now();
  await waitFor(async () => {
    try {
      const targets = await listTargets(http);
      return targets.some((t) => t.type === 'page');
    } catch {
      return null;
    }
  }, 60_000, 1000, `${label}: CDP endpoint up`);

  let cdp = null;
  const dialogsClicked = [];
  await waitFor(async () => {
    if (cdp === null) {
      try {
        cdp = await connectPage({ match, http });
      } catch {
        try {
          const tmp = await connectPage({ http });
          dialogsClicked.push(...(await driveFirstRunDialogs(tmp)));
          tmp.close();
        } catch { /* no page yet */ }
        return null;
      }
    }
    dialogsClicked.push(...(await driveFirstRunDialogs(cdp)));
    const probe = await cdp.eval('!!(app.plugins?.plugins?.vaultsyncforagents)');
    return probe.ok && probe.value === true;
  }, 120_000, 1500, `${label}: plugin loaded`);

  return { cdp, dialogsClicked: [...new Set(dialogsClicked)], readyMs: Date.now() - t0 };
}

// --- settings modal helpers (this Obsidian build has never rendered app.setting.open() in a run) ------

/**
 * Open the plugin's settings UI. Returns how the UI became reachable:
 *   'modal'          — settings rendered in the app page's own DOM
 *   'settings-window'— a NEW window/page target appeared and holds the settings DOM
 *   'detached-tab'   — modal never rendered; the REAL registered tab instance was
 *                      displayed into a mounted host div (same render code path)
 */
async function openPluginSettingsUi(cdp, cdpHttp, { timeoutMs = 20_000 } = {}) {
  const before = (await listTargets(cdpHttp)).map((t) => t.url).sort();
  const openR = await cdp.eval(`(() => { try { app.setting.open(); return 'opened'; } catch (e) { return 'threw: ' + String(e); } })()`);
  if (!openR.ok || openR.value !== 'opened') return { how: null, open: openR.value ?? openR.error };

  // Watch both the app page DOM and the target list (settings-in-a-window theory).
  let domProbe;
  try {
    domProbe = await waitFor(async () => {
      const r = await cdp.eval(`(() => { const items = document.querySelectorAll('.setting-item').length; return items > 0 ? { items } : null; })()`);
      return r.ok ? r.value : null;
    }, Math.min(timeoutMs, 10_000), 400, 'settings modal renders in-page');
  } catch {
    domProbe = null;
  }
  if (domProbe) {
    await cdp.eval(`(() => { try { app.setting.openTabById('vaultsyncforagents'); } catch (e) {} return 'tab'; })()`);
    return { how: 'modal', open: openR.value, inPage: true };
  }
  // New window target?
  const after = await listTargets(cdpHttp);
  const freshUrls = after.map((t) => t.url).filter((u) => !before.includes(u));
  if (freshUrls.length > 0) {
    const target = after.find((t) => freshUrls.includes(t.url));
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve, { once: true });
      ws.addEventListener('error', () => reject(new Error('settings-window ws open failed')), { once: true });
    });
    const win = new Cdp(ws);
    await win.send('Runtime.enable');
    await win.send('Log.enable');
    return { how: 'settings-window', open: openR.value, newTargets: freshUrls, windowCdp: win };
  }
  // Fallback: display the REAL registered tab instance into a mounted host div.
  const det = await cdp.eval(`(async () => {
    try {
      const tabs = [...((app.setting && app.setting.settingTabs) || []), ...((app.setting && app.setting.pluginTabs) || [])];
      let tab = tabs.find(t => t.plugin?.manifest?.id === 'vaultsyncforagents')
        || tabs.find(t => t.id === 'vaultsyncforagents')
        || tabs.find(t => t.constructor && t.constructor.name === 'VaultSyncSettingTab');
      if (!tab) {
        const p = app.plugins.plugins.vaultsyncforagents;
        tab = p.settingTab ?? null;
      }
      if (!tab) return { ok: false, why: 'no-tab-instance', tabCount: tabs.length, ids: tabs.map(t => t.id ?? '?').slice(0, 20) };
      const host = document.createElement('div');
      host.id = 'vsa-e2e-settings-host';
      document.body.appendChild(host);
      tab.containerEl = host;
      await tab.display();
      return { ok: true, via: tab.plugin ? 'app.setting.settingTabs' : 'plugin.settingTab' };
    } catch (e) { return { ok: false, why: String(e) }; }
  })()`);
  if (!det.ok || det.value?.ok !== true) return { how: null, open: openR.value, detached: det.value ?? det.error };
  return { how: 'detached-tab', open: openR.value, detached: det.value };
}

/** Text of the About "Vault storage" description row (polls until filled with real data). */
async function vaultStorageLine(cdp) {
  const r = await cdp.eval(`(() => {
    const item = [...document.querySelectorAll('.setting-item')].find(el => el.querySelector('.setting-item-name')?.textContent?.trim() === 'Vault storage');
    return item ? (item.querySelector('.setting-item-description')?.textContent ?? '') : null;
  })()`);
  if (!r.ok) throw new Error(`vaultStorageLine eval: ${r.error}`);
  return r.value;
}

// --- CORS / Illegal-invocation tripwire ---------------------------------------------------------------

const FATAL_PATTERNS = [
  /blocked by CORS policy/i,
  /Access-Control-Allow-Origin/i,
  /Illegal invocation/i,
  /Failed to execute 'fetch'/i,
];
function fatalConsoleHits(cdps) {
  const hits = [];
  for (const [name, cdp] of Object.entries(cdps)) {
    if (!cdp) continue;
    for (const entry of cdp.consoleLog) {
      if (FATAL_PATTERNS.some((re) => re.test(entry.text))) hits.push({ vault: name, ...entry });
    }
  }
  return hits;
}

// --- disk-level unlink (mirrors plugin unlink()) + prep ----------------------------------------------

function unlinkVaultOnDisk(dir) {
  const stateDir = join(dir, '.vaultsyncforagents');
  const removed = { stateDir: false, marker: false, stateIndex: false };
  if (existsSync(stateDir)) {
    removed.marker = existsSync(join(stateDir, 'device.json'));
    removed.stateIndex = existsSync(join(stateDir, 'state'));
    rmSync(stateDir, { recursive: true, force: true });
    removed.stateDir = true;
  }
  const pluginDir = join(dir, '.obsidian/plugins/vaultsyncforagents');
  const dataPath = join(pluginDir, 'data.json');
  const before = existsSync(dataPath) ? JSON.parse(readFileSync(dataPath, 'utf8')) : null;
  const after = {
    url: '',
    token: '',
    deviceId: '',
    deviceName: typeof before?.deviceName === 'string' ? before.deviceName : '',
    settings:
      before?.settings ??
      { rescanIntervalSec: 30, obsidianSync: false, statusBarMode: 'detailed', syncOnStartup: true, logLevel: 'info', ignorePatterns: '' },
  };
  writeFileSync(dataPath, JSON.stringify(after, null, 2));
  return {
    removed,
    dataBefore: before ? { url: before.url, deviceId: before.deviceId, deviceName: before.deviceName, tokenLen: (before.token || '').length } : null,
    dataAfter: { url: after.url, deviceId: after.deviceId, deviceName: after.deviceName, tokenLen: 0 },
  };
}

function refreshPluginFiles(dir) {
  const dest = join(dir, '.obsidian/plugins/vaultsyncforagents');
  const evidence = {};
  for (const f of ['main.js', 'manifest.json', 'styles.css']) {
    copyFileSync(join(PLUGIN_PKG, f), join(dest, f));
    evidence[f] = createHash('sha256').update(readFileSync(join(dest, f))).digest('hex').slice(0, 16);
  }
  return evidence;
}

/** The two F-A fix markers must be present in the bundle we just installed. */
function assertBundleHasFix(dir) {
  const main = readFileSync(join(dir, '.obsidian/plugins/vaultsyncforagents/main.js'), 'utf8');
  const markers = {
    hashEqualityGuard: (main.match(/local\.hash === remote\.hash/g) ?? []).length,
    conflictsReplacedPerCycle: main.includes('this.conflicts = [...plan.conflicts]'),
    conflictsAppendOnly: main.includes('this.conflicts = [...this.conflicts, ...plan.conflicts]'),
  };
  if (markers.hashEqualityGuard < 1 || !markers.conflictsReplacedPerCycle || markers.conflictsAppendOnly) {
    throw new Error(`installed bundle in ${dir} does not carry the F-A fix: ${fmt(markers)}`);
  }
  return markers;
}

// --- main ----------------------------------------------------------------------------------------------

let cookie = null;
let cdp4 = null;
let cdp5 = null;
let settingsWinCdp = null; // if settings render in their own window target
let exitCode = 0;

process.on('uncaughtException', (e) => {
  lines.push(`[FATAL-uncaught] ${String(e?.stack ?? e)}`);
  report.fatal = String(e?.message ?? e);
});

try {
  // ---- prep: kill Obsidian, health, refresh+verify bundle, unlink vault5, profiles ----
  {
    const s = step('prep', 'kill Obsidian; CLOUD /health; rebuild-install plugin (F-A markers verified); normalize humantest.md; disk-unlink vault5; write profiles');
    try {
      await execFileP('taskkill', ['/F', '/IM', 'Obsidian.exe']).catch(() => {});
      await sleep(2000);
      const health = await wk('/health');
      if (health.status !== 200 || health.body?.ok !== true || health.body?.claimed !== true) {
        throw new Error(`unexpected /health: ${fmt(health.body)}`);
      }
      const bundles = {};
      for (const [v, dir] of [['TestVault4', V4_DIR], ['TestVault5', V5_DIR]]) {
        bundles[v] = { installed: refreshPluginFiles(dir), fixMarkers: assertBundleHasFix(dir) };
      }
      // The fresh pairing in A2 plans add-vs-add for every pre-existing file.
      // humantest.md diverges between the vaults right now (stale local dogfood
      // edit in vault5; server head == vault4's copy) — that is a GENUINE
      // conflict which would pollute the F-A zero-conflict signal. Normalize
      // vault5's copy to the server head first (recorded decision).
      const norm = {};
      for (const v of ['TestVault4', 'TestVault5']) {
        norm[v] = createHash('sha256').update(readFileSync(join(v === 'TestVault4' ? V4_DIR : V5_DIR, 'humantest.md'))).digest('hex').slice(0, 16);
      }
      if (norm.TestVault4 !== norm.TestVault5) {
        copyFileSync(join(V4_DIR, 'humantest.md'), join(V5_DIR, 'humantest.md'));
        decide('vault5 humantest.md was byte-divergent from the server head (stale dogfood edit) — copied vault4\'s copy (= server head) over it BEFORE pairing so the only add-vs-add divergence in the F-A repro is the byte-identical set under test');
      }
      const unlink = unlinkVaultOnDisk(V5_DIR);
      const v4data = JSON.parse(readFileSync(join(V4_DIR, '.obsidian/plugins/vaultsyncforagents/data.json'), 'utf8'));
      if (v4data.url !== WORKER) throw new Error(`vault4 not pointed at the CLOUD worker: ${v4data.url}`);
      const preVault4 = { url: v4data.url, deviceId: v4data.deviceId, deviceName: v4data.deviceName, tokenLen: (v4data.token || '').length };
      cookie = await adminLogin();
      const { stdout: pa } = await execFileP(process.execPath, [join(HERE, 'write-profile.mjs'), PROFILE_A, V4_DIR, V5_DIR]);
      const { stdout: pb } = await execFileP(process.execPath, [join(HERE, 'write-profile.mjs'), PROFILE_B, V5_DIR, V4_DIR]);
      s.pass({
        health: health.body,
        bundles,
        humantestNormalized: norm,
        vault5Unlink: unlink,
        vault4PairingKept: preVault4,
        profileA: pa.trim(),
        profileB: pb.trim(),
      });
    } catch (e) {
      s.fail(String(e.message ?? e));
      throw e;
    }
  }

  // ---- A1: launch both; vault4 reconnects; vault5 UNLINKED ----
  {
    const s = step('A1', 'launch both instances: vault4 auto-reconnects live (pairing persisted); vault5 loads UNLINKED (no client, empty token)');
    try {
      const pidA = launchObsidian(PROFILE_A, PORT_A);
      const pidB = launchObsidian(PROFILE_B, PORT_B);
      const [a, b] = await Promise.all([
        awaitInstanceReady({ http: CDP_A, match: 'TestVault4', label: 'vault4' }),
        awaitInstanceReady({ http: CDP_B, match: 'TestVault5', label: 'vault5' }),
      ]);
      cdp4 = a.cdp;
      cdp5 = b.cdp;
      report.pids = { obsidianVault4: pidA, obsidianVault5: pidB };

      const st4 = await waitFor(async () => {
        const ps = await pluginStatus(cdp4);
        return ps?.statusBar?.startsWith('vsa ✓') && ps?.status?.state === 'live' ? ps : null;
      }, 60_000, 1000, 'vault4 live+✓');
      const st5 = await pluginStatus(cdp5);
      const bad = [];
      if (st5.linked !== false) bad.push(`vault5 linked=true (deviceName=${st5.deviceName})`);
      if (st5.tokenLen !== 0) bad.push(`vault5 tokenLen=${st5.tokenLen}`);
      if (st5.hasClient) bad.push('vault5 has a client while unlinked');
      if ((st5.status?.conflicts ?? []).length !== 0) bad.push(`vault5 conflicts while unlinked: ${fmt(st5.status.conflicts)}`);
      const cors = fatalConsoleHits({ vault4: cdp4, vault5: cdp5 });
      if (cors.length) bad.push(`CORS console hits: ${fmt(cors.slice(0, 2))}`);
      if (bad.length) throw new Error(bad.join('; '));
      s.pass({
        vault4: { statusBar: st4.value.statusBar, state: st4.value.status.state, deviceId: st4.value.deviceId, deviceName: st4.value.deviceName },
        vault5: { statusBar: st5.statusBar, linked: st5.linked, tokenLen: st5.tokenLen, hasClient: st5.hasClient, deviceName: st5.deviceName },
        dialogs: { vault4: a.dialogsClicked, vault5: b.dialogsClicked },
      });
    } catch (e) {
      s.fail(String(e.message ?? e));
      throw e;
    }
  }

  // ---- A2: F-A regression — fresh code, pair vault5 via the pairing UI, zero-conflict convergence ----
  {
    const s = step('A2', 'F-A regression: mint fresh code; pair vault5 through the plugin pairing UI; full sync; assert conflicts===0, no ⚠ bar, zero conflict copies, converged file set');
    const runOnce = async () => {
      const pair = await wk('/admin/pair', {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({ deviceName: DEVICE5, deviceType: 'desktop' }),
      });
      if (pair.status !== 200 || typeof pair.body?.code !== 'string') {
        throw new Error(`admin pair HTTP ${pair.status}: ${fmt(pair.body)}`);
      }
      const code = pair.body.code;
      const filesBefore = await cdp5.eval(`app.vault.getFiles().map(f => f.path).length`).then((r) => r.value);

      // --- pairing UI attempt: settings modal → fill fields → click "Pair this vault" ---
      const ui = await openPluginSettingsUi(cdp5, CDP_B, { timeoutMs: 15_000 });
      const uiTarget = ui.how === 'settings-window' ? ui.windowCdp : cdp5;
      settingsWinCdp = ui.how === 'settings-window' ? ui.windowCdp : null;
      let pairPath = null;
      let uiFill = null;
      if (ui.how === 'modal' || ui.how === 'settings-window') {
        const fill = await uiTarget.eval(`(() => {
          const setVal = (name, value) => {
            const item = [...document.querySelectorAll('.setting-item')].find(el => el.querySelector('.setting-item-name')?.textContent?.trim() === name);
            const input = item?.querySelector('input[type=text], input:not([type])');
            if (!input) return { name, found: false };
            input.value = value;
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
            return { name, found: true };
          };
          return {
            url: setVal('Worker URL', ${jstr(WORKER)}),
            code: setVal('Pairing code', ${jstr(code)}),
            device: (() => { const item = [...document.querySelectorAll('.setting-item')].find(el => el.querySelector('.setting-item-name')?.textContent?.trim() === 'Device name'); return item ? (item.querySelector('input')?.value ?? null) : null; })(),
          };
        })()`);
        uiFill = fill;
        const click = await uiTarget.eval(`(() => {
          const btn = [...document.querySelectorAll('button')].find(b => (b.textContent || '').trim() === 'Pair this vault');
          if (!btn) return 'no-button';
          btn.click();
          return 'clicked';
        })()`);
        if (click !== 'clicked') throw new Error(`pairing UI rendered but no "Pair this vault" button (${click}); fill=${fmt(fill)}`);
        pairPath = `pairing UI (${ui.how}): fields filled + button clicked`;
        // the button handler runs the whole pair flow — wait for the token to land
        const uiPaired = await waitFor(async () => {
          const ps = await pluginStatus(cdp5);
          return ps.linked === true && ps.tokenLen > 10 ? ps : null;
        }, 60_000, 1000, 'pairing-UI pair lands (linked + token)');
      } else {
        decide(`settings UI never rendered (open=${fmt(ui.open)}; detached=${fmt(ui.detached ?? null)}) — pairing via the settings button's exact handler: p.pairFromSettings(code) after staging url/deviceName exactly as the form's onChange handlers do`);
        const staged = await cdp5.eval(`(async () => {
          const p = app.plugins.plugins.vaultsyncforagents;
          p.data.url = ${jstr(WORKER)};
          p.data.deviceName = ${jstr(DEVICE5)};
          await p.savePluginData();
          return { url: p.data.url, deviceName: p.data.deviceName, linked: !!p.linked };
        })()`);
        const click = await cdp5.eval(`(async () => {
          const p = app.plugins.plugins.vaultsyncforagents;
          const raced = await Promise.race([
            p.pairFromSettings(${jstr(code)}).then(o => ({ done: true, outcome: o })),
            new Promise(r => setTimeout(() => r({ done: false }), ${PAIR_RACE_MS})),
          ]);
          return { raced, data: { url: p.data.url, deviceId: p.data.deviceId, tokenLen: (p.data.token || '').length, deviceName: p.data.deviceName } };
        })()`);
        if (!click.ok) throw new Error(`pairFromSettings eval: ${click.error}`);
        if (!click.value.raced.done) {
          const got = await waitFor(async () => {
            const r = await cdp5.eval(`(async()=>{ const d = JSON.parse(await app.vault.adapter.read('.obsidian/plugins/vaultsyncforagents/data.json')); return (d.token||'').length > 10 ? { url: d.url, deviceId: d.deviceId, deviceName: d.deviceName } : null; })()`);
            return r.ok ? r.value : null;
          }, 60_000, 1000, 'vault5 token persisted');
          click.value.raced = { done: true, outcome: { status: 'paired', late: true } };
          click.value.data = got.value;
        }
        if (click.value.raced.outcome.status !== 'paired') throw new Error(`pair outcome: ${fmt(click.value.raced.outcome)}`);
        pairPath = 'settings-button handler (pairFromSettings)';
        uiFill = staged;
        // report.pairOutcome for the evidence trail
        runOnce.pairEvidence = click.value;
      }
      if (pairPath === null) throw new Error('no pairing path executed');

      // --- full sync: live + pending 0 + ✓ (fresh pair pulls the whole room through real R2) ---
      const liveT0 = Date.now();
      const live = await waitFor(async () => {
        const ps = await pluginStatus(cdp5);
        return ps?.status?.state === 'live' && ps?.status?.pending === 0 && ps?.statusBar?.startsWith('vsa ✓') ? ps : null;
      }, FULL_SYNC_TIMEOUT_MS, 1000, 'vault5 full-sync live+✓+pending0');
      const fullSyncMs = Date.now() - liveT0;
      const filesAfter = await cdp5.eval(`app.vault.getFiles().map(f => f.path).length`).then((r) => r.value);

      // --- F-A assertions ---
      const p5 = await pluginStatus(cdp5);
      const p4 = await pluginStatus(cdp4);
      const bad = [];
      for (const [name, ps] of [['vault4', p4], ['vault5', p5]]) {
        if ((ps.status?.conflicts ?? []).length !== 0) bad.push(`${name} status().conflicts=${fmt(ps.status.conflicts.map(c => c.path))}`);
        if (ps.statusBar?.includes('⚠') || ps.statusBar?.includes('conflict')) bad.push(`${name} statusBar shows conflict state: ${ps.statusBar}`);
      }
      const copies5 = await conflictFiles(cdp5);
      const copies4 = await conflictFiles(cdp4);
      if (copies5.length || copies4.length) bad.push(`conflict copies: v4=${fmt(copies4)} v5=${fmt(copies5)}`);
      if (bad.length) throw new Error(`F-A NOT fixed: ${bad.join('; ')}`);

      // --- convergence spot-checks ---
      const spot = {};
      const h01v4 = await readTextOrNull(cdp4, 'e2e-h-01.md');
      const h01v5 = await readTextOrNull(cdp5, 'e2e-h-01.md');
      spot['e2e-h-01.md'] = { converged: h01v4 === h01v5 && h01v4 !== null, preview: String(h01v5).slice(0, 60) };
      const blob4 = await sha256InVault(cdp4, 'blob-smoke.bin');
      const blob5 = await sha256InVault(cdp5, 'blob-smoke.bin');
      spot['blob-smoke.bin'] = { sameSha: blob4.sha === blob5.sha, sizeV4: blob4.size, sizeV5: blob5.size, sha: blob4.sha.slice(0, 16) };
      for (const f of ['RVP-End-to-End-20260815.md', 'vps-cli-check-20260821.md']) {
        const t4 = await readTextOrNull(cdp4, f);
        const t5 = await readTextOrNull(cdp5, f);
        spot[f] = { converged: t4 === t5 && t4 !== null, len: (t5 ?? '').length };
      }
      for (const [k, v] of Object.entries(spot)) {
        if (v.converged !== true && v.sameSha !== true) throw new Error(`spot-check ${k} did not converge: ${fmt(v)}`);
      }
      // vault5 must now also hold the room files it was missing before the re-pair
      const missing = [];
      for (const f of ['RVP-End-to-End-20260815.md', 'vps-cli-check-20260821.md']) {
        if (!(await exists(cdp5, f))) missing.push(f);
      }
      if (missing.length) throw new Error(`vault5 still missing room files after full sync: ${fmt(missing)}`);

      return {
        headline: 'F-A FIXED: fresh re-pair over ~47 pre-existing byte-identical files produced ZERO conflicts / copies',
        pairingCodeShape: /^[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(code) ? 'ok' : `odd:${code}`,
        pairPath,
        uiRender: { how: ui.how, open: ui.open, detached: ui.detached ?? null },
        uiFill,
        ...(runOnce.pairEvidence ? { pairOutcome: runOnce.pairEvidence } : {}),
        vault5: { statusBar: p5.statusBar, state: p5.status.state, pending: p5.status.pending, deviceId: p5.deviceId, deviceName: p5.deviceName, tokenLen: p5.tokenLen, linked: p5.linked },
        vault4: { statusBar: p4.statusBar, state: p4.status.state, pending: p4.status.pending },
        conflicts: { vault4: 0, vault5: 0, conflictCopies: { vault4: copies4, vault5: copies5 } },
        filesVault5: { beforePair: filesBefore, afterFullSync: filesAfter },
        fullSyncMs,
        spotChecks: spot,
      };
    };
    const r = await withRetry(runOnce);
    if (r.ok) s.pass(r.result);
    else s.fail(String(r.error?.message ?? r.error));
  }

  // ---- A3: genuine-conflict guard + lifecycle ----
  {
    const s = step('A3', 'genuine conflict guard: divergent same-path creates on both vaults → copy + ⚠ + conflicts>=1 → clean cycle → counter back to 0 and stable');
    const runOnce = async () => {
      // defensive: a failed earlier attempt may have left probes/copies behind
      await cdp4.eval(`(async () => { for (const f of app.vault.getFiles().filter(f => /conflict-probe|\\(conflict .+ - from /i.test(f.path))) { try { await app.vault.delete(f); } catch (e) {} } return 'cleaned-v4'; })()`);
      await cdp5.eval(`(async () => { for (const f of app.vault.getFiles().filter(f => /conflict-probe|\\(conflict .+ - from /i.test(f.path))) { try { await app.vault.delete(f); } catch (e) {} } return 'cleaned-v5'; })()`);
      await sleep(3000);

      // Pause BOTH, create the same path with DIFFERENT content on each side.
      const c4 = `genuine conflict probe — vault4 side ${Date.now()} nonce=${Math.random().toString(36).slice(2, 8)}`;
      const c5 = `genuine conflict probe — VAULT5 DIVERGENT SIDE ${Date.now()} nonce=${Math.random().toString(36).slice(2, 8)}`;
      const staged = await cdp4.eval(`(async () => { const p = app.plugins.plugins.vaultsyncforagents; p.pauseSyncing(); return p.syncingPaused; })()`);
      const staged5 = await cdp5.eval(`(async () => { const p = app.plugins.plugins.vaultsyncforagents; p.pauseSyncing(); return p.syncingPaused; })()`);
      if (staged.value !== true || staged5.value !== true) throw new Error(`pause failed: v4=${fmt(staged.value)} v5=${fmt(staged5.value)}`);
      const mk4 = await cdp4.eval(`app.vault.create('conflict-probe.md', ${jstr(c4)}).then(() => 'v4-created').catch(e => String(e))`);
      const mk5 = await cdp5.eval(`app.vault.create('conflict-probe.md', ${jstr(c5)}).then(() => 'v5-created').catch(e => String(e))`);
      if (mk4.value !== 'v4-created' || mk5.value !== 'v5-created') throw new Error(`divergent creates: v4=${fmt(mk4.value)} v5=${fmt(mk5.value)}`);

      // Resume vault4 first (its create becomes the remote head), then vault5
      // (its local diverging add hits the add-vs-add conflict path).
      await cdp4.eval(`(async () => { const p = app.plugins.plugins.vaultsyncforagents; await p.resumeSyncing(); return 'resumed'; })()`);
      await waitFor(async () => {
        const ps = await pluginStatus(cdp4);
        return ps?.statusBar?.startsWith('vsa ✓') && ps?.status?.state === 'live' ? true : null;
      }, 45_000, 1000, 'vault4 live after resume');
      const v4Head = await wk(`/api/history?path=${encodeURIComponent('/conflict-probe.md')}`, { headers: { cookie } });
      const v4HeadIsOurs = (v4Head.body?.versions ?? [])[0]?.deviceId === (await pluginStatus(cdp4)).deviceId;

      const conflictT0 = Date.now();
      await cdp5.eval(`(async () => { const p = app.plugins.plugins.vaultsyncforagents; await p.resumeSyncing(); return 'resumed'; })()`);
      // Conflict observed: ⚠ bar + conflicts >= 1 + a copy file exists (either
      // vault; copies propagate). Conditions are LATCHED — the ⚠ bar can flash
      // for only a few hundred ms before the next clean cycle repaints ✓.
      const seen = { bar: null, conflicts: 0, copies: [] };
      const observed = await waitFor(async () => {
        const ps5 = await pluginStatus(cdp5);
        const ps4 = await pluginStatus(cdp4);
        const conflictsTotal = (ps5.status?.conflicts ?? []).length + (ps4.status?.conflicts ?? []).length;
        const bars = `${ps5.statusBar ?? ''}|${ps4.statusBar ?? ''}`;
        const copies = [...(await conflictFiles(cdp5)), ...(await conflictFiles(cdp4))];
        if (conflictsTotal >= seen.conflicts && conflictsTotal >= 1) seen.conflicts = conflictsTotal;
        if (/⚠/.test(bars) && seen.bar === null) seen.bar = { bar5: ps5.statusBar, bar4: ps4.statusBar };
        if (copies.length > seen.copies.length) seen.copies = copies;
        return seen.conflicts >= 1 && seen.bar !== null && seen.copies.length >= 1 ? seen : null;
      }, SYNC_TIMEOUT_MS, 300, 'genuine conflict observed (⚠ + conflicts>=1 + copy)');

      // Clean cycle: force resync; counter must return to 0 (list REPLACED per cycle, not appended).
      await syncNow(cdp5);
      await syncNow(cdp4);
      const healed = await waitFor(async () => {
        const ps5 = await pluginStatus(cdp5);
        const ps4 = await pluginStatus(cdp4);
        const barsOk = !((ps5.statusBar ?? '') + (ps4.statusBar ?? '')).match(/⚠|conflict/);
        const zero = (ps5.status?.conflicts ?? []).length === 0 && (ps4.status?.conflicts ?? []).length === 0;
        return zero && barsOk ? { bar5: ps5.statusBar, bar4: ps4.statusBar } : null;
      }, SYNC_TIMEOUT_MS, 500, 'conflict counter healed to 0');
      // Stability: two more cycles must not re-report; copy count frozen from here on.
      const copiesAtHeal = [...(await conflictFiles(cdp5)), ...(await conflictFiles(cdp4))];
      await syncNow(cdp5);
      await syncNow(cdp4);
      await sleep(4000);
      const ps5b = await pluginStatus(cdp5);
      const ps4b = await pluginStatus(cdp4);
      const copiesAfterHeal = [...(await conflictFiles(cdp5)), ...(await conflictFiles(cdp4))];
      if ((ps5b.status?.conflicts ?? []).length !== 0 || (ps4b.status?.conflicts ?? []).length !== 0) {
        throw new Error(`conflicts reappeared on clean cycles: v4=${fmt(ps4b.status.conflicts)} v5=${fmt(ps5b.status.conflicts)}`);
      }
      if (copiesAfterHeal.length !== copiesAtHeal.length) {
        throw new Error(`copy count changed across clean cycles (copy-per-cycle regression?): atHeal=${fmt(copiesAtHeal)} after=${fmt(copiesAfterHeal)}`);
      }

      // Cleanup: remove the probe + copies; wait for tombstone convergence both sides.
      await cdp5.eval(`(async () => { for (const f of app.vault.getFiles().filter(f => /conflict-probe|\\(conflict .+ - from /i.test(f.path))) { try { await app.vault.delete(f); } catch (e) {} } return 'cleaned-v5'; })()`);
      await cdp4.eval(`(async () => { for (const f of app.vault.getFiles().filter(f => /conflict-probe|\\(conflict .+ - from /i.test(f.path))) { try { await app.vault.delete(f); } catch (e) {} } return 'cleaned-v4'; })()`);
      await waitFor(async () => {
        const [g4, g5] = await Promise.all([conflictFiles(cdp4), conflictFiles(cdp5)]);
        const p4 = await exists(cdp4, 'conflict-probe.md');
        const p5 = await exists(cdp5, 'conflict-probe.md');
        return g4.length === 0 && g5.length === 0 && !p4 && !p5 ? true : null;
      }, SYNC_TIMEOUT_MS, 800, 'probe+copies tombstoned both sides');

      return {
        headline: 'genuine conflict DETECTED (copy + ⚠ + counter) then HEALED to 0 and stable — the guard only skips byte-identical adds',
        staged: { paused4: staged.value, paused5: staged5.value, created4: mk4.value, created5: mk5.value, vault4BecameRemoteHead: v4HeadIsOurs },
        conflictObservedMs: Date.now() - conflictT0,
        observed: observed.value,
        copiesAtHeal,
        copiesStableAcrossCycles: copiesAfterHeal.length === copiesAtHeal.length,
        healedBars: healed.value,
        cleanupConverged: true,
      };
    };
    const r = await withRetry(runOnce);
    if (r.ok) s.pass(r.result);
    else s.fail(String(r.error?.message ?? r.error));
  }

  // ---- A4: F-2 About tab ----
  {
    const s = step('A4', 'F-2 About tab: open plugin settings → About; "Vault storage" renders REAL worker numbers; no CORS/console error for /api/status');
    const runOnce = async () => {
      const consoleMark = cdp4.consoleLog.length;
      const ui = await openPluginSettingsUi(cdp4, CDP_A, { timeoutMs: 15_000 });
      const target = ui.how === 'settings-window' ? ui.windowCdp : cdp4;
      settingsWinCdp = settingsWinCdp ?? (ui.how === 'settings-window' ? ui.windowCdp : null);
      if (!ui.how) {
        throw new Error(`settings UI unreachable: open=${fmt(ui.open)} detached=${fmt(ui.detached ?? null)}`);
      }
      const line = (await waitFor(async () => {
        const t = await vaultStorageLine(target);
        return typeof t === 'string' && !/Checking the worker|unavailable|Pair this vault/i.test(t) && /Storage used:/i.test(t) ? t : null;
      }, 20_000, 500, 'Vault storage line renders real data')).value;

      // Cross-check the numbers against the admin view of the same worker.
      const st = await wk('/api/status', { headers: { cookie } });
      const expected = {
        storageBytes: st.body?.storageBytes ?? null,
        attachments: st.body?.attachments ?? null,
        devices: (st.body?.devices ?? []).length,
      };
      const parsed = /Storage used:\s*([\d.]+)\s*(B|KB|MB|GB)/i.exec(line) ?? [];
      if (!parsed[1]) throw new Error(`storage line has no number: ${fmt(line)}`);
      // formatBytes rendering — accept any magnitude but require the line to cite
      // the attachment count and device count the worker actually reports.
      const attMatch = new RegExp(`${expected.attachments.count}\\s*attachment`, 'i').test(line);
      const devMatch = expected.devices > 0 ? new RegExp(`${expected.devices}\\s*device`, 'i').test(line) : true;
      if (!attMatch || !devMatch) {
        throw new Error(`storage line numbers disagree with worker /api/status: line=${fmt(line)} expected=${fmt(expected)}`);
      }

      // CORS / console-error audit for the whole About interaction window.
      await sleep(1500);
      const window5 = cdp4.consoleLog.slice(consoleMark);
      const cors = window5.filter((e) => FATAL_PATTERNS.some((re) => re.test(e.text)));
      const apiErrs = window5.filter((e) => /api\/status/i.test(e.text) && String(e.level).toLowerCase() === 'error');
      if (cors.length) throw new Error(`CORS-pattern console entries around About open: ${fmt(cors.slice(0, 3))}`);
      if (apiErrs.length) throw new Error(`error-level console entries mentioning /api/status: ${fmt(apiErrs.slice(0, 3))}`);

      // Close the settings UI (modal or window) — best effort.
      await target.eval(`(() => { try { app.setting.close(); } catch (e) {} return 'closed'; })()`).catch(() => {});
      if (settingsWinCdp) {
        await settingsWinCdp.eval(`(() => { try { app.setting.close(); } catch (e) {} return 'closed'; })()`).catch(() => {});
      }
      return {
        uiPath: ui.how,
        open: ui.open,
        storageLine: line,
        workerStatus: expected,
        consoleWindowEntries: window5.length,
        corsErrors: 0,
        apiStatusErrors: 0,
      };
    };
    const r = await withRetry(runOnce);
    if (r.ok) s.pass(r.result);
    else s.fail(String(r.error?.message ?? r.error));
  }

  // ---- final sanity ----
  {
    const s = step('final', 'final sanity: both live/pending 0/conflicts 0; no ⚠ bars; no conflict copies; zero CORS-pattern console hits; devices online');
    try {
      await sleep(3000);
      const [p4, p5] = await Promise.all([pluginStatus(cdp4), pluginStatus(cdp5)]);
      const [c4, c5] = await Promise.all([conflictFiles(cdp4), conflictFiles(cdp5)]);
      const bad = [];
      for (const [name, st] of [['vault4', p4], ['vault5', p5]]) {
        if (st?.status?.state !== 'live') bad.push(`${name} state=${st?.status?.state}`);
        if (st?.status?.pending !== 0) bad.push(`${name} pending=${st?.status?.pending}`);
        if ((st?.status?.conflicts ?? []).length !== 0) bad.push(`${name} conflicts=${fmt(st?.status?.conflicts)}`);
        if (!st?.statusBar?.startsWith('vsa ✓')) bad.push(`${name} statusBar=${st?.statusBar}`);
      }
      if (c4.length || c5.length) bad.push(`conflict copies: v4=${fmt(c4)} v5=${fmt(c5)}`);
      const cors = fatalConsoleHits({ vault4: cdp4, vault5: cdp5 });
      if (cors.length) bad.push(`CORS-pattern hits: ${fmt(cors.slice(0, 3))}`);
      const st = await wk('/api/status', { headers: { cookie } });
      const devs = st.body?.devices ?? [];
      const byName = Object.fromEntries(devs.map((d) => [d.name, d]));
      if (!byName[DEVICE4]?.online) bad.push(`${DEVICE4} not online`);
      if (!byName[DEVICE5]?.online) bad.push(`${DEVICE5} not online`);
      if (bad.length) throw new Error(bad.join('; '));
      report.finalWorkerStatus = { devices: devs.map((d) => ({ name: d.name, online: d.online })), storageBytes: st.body?.storageBytes };
      s.pass({
        vault4: { state: p4.status.state, pending: p4.status.pending, statusBar: p4.statusBar, lastSyncAt: p4.status.lastSyncAt },
        vault5: { state: p5.status.state, pending: p5.status.pending, statusBar: p5.statusBar, lastSyncAt: p5.status.lastSyncAt, deviceName: p5.deviceName, deviceId: p5.deviceId },
        conflictCopies: { vault4: c4, vault5: c5 },
        devices: devs.map((d) => ({ name: d.name, online: d.online })),
      });
    } catch (e) {
      s.fail(String(e.message ?? e));
    }
  }
} catch (fatal) {
  lines.push(`[FATAL] ${String(fatal?.stack ?? fatal)}`);
  report.fatal = String(fatal?.message ?? fatal);
} finally {
  const consoles = {};
  if (cdp4) consoles.vault4 = cdp4.consoleLog;
  if (cdp5) consoles.vault5 = cdp5.consoleLog;
  report.consoleProblems = {};
  for (const [name, entries] of Object.entries(consoles)) {
    report.consoleProblems[name] = entries.filter((e) => ['error', 'warning', 'warn'].includes(String(e.level).toLowerCase()));
  }
  try {
    const h = await wk('/health');
    report.workerLeftRunning = { url: WORKER, health: h.body, note: 'deployed Cloudflare worker — LEFT RUNNING, no deploy' };
  } catch {
    report.workerLeftRunning = { url: WORKER, note: 'left deployed (health probe failed)' };
  }
  report.finishedAt = new Date().toISOString();
  const failed = report.steps.filter((x) => x.status === 'FAIL' || x.status === 'RUNNING').length;
  const passed = report.steps.filter((x) => x.status === 'PASS').length;
  report.overall = failed === 0 ? 'PASS' : 'FAIL';
  exitCode = failed === 0 ? 0 : 1;
  lines.push('');
  lines.push(`SUMMARY: ${passed} PASS, ${failed} FAIL — overall ${report.overall}`);
  const totalProblems = Object.values(report.consoleProblems).reduce((a, b) => a + b.length, 0);
  lines.push(`Console errors/warnings captured: ${totalProblems}`);
  for (const [name, entries] of Object.entries(report.consoleProblems)) {
    for (const c of entries.slice(0, 10)) lines.push(`  [${name} ${c.level}] ${c.text.slice(0, 240)}`);
  }
  try {
    writeFileSync(join(HERE, 'report-fix-verify-cloud.json'), JSON.stringify(report, null, 2));
  } catch { /* best effort */ }
  cdp4?.close();
  cdp5?.close();
  settingsWinCdp?.close();
  await execFileP('taskkill', ['/F', '/IM', 'Obsidian.exe']).catch(() => {});
  lines.push('TEARDOWN: Obsidian killed; CLOUD worker LEFT DEPLOYED (untouched); both vaults LEFT PAIRED+SYNCED.');
  console.log(lines.join('\n'));
  process.exit(exitCode);
}
