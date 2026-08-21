/**
 * TWO-REAL-VAULT bidirectional sync E2E — CLOUD variant (real Cloudflare worker).
 *
 * Same flow as scenario-2vault.mjs, but pointed at a DEPLOYED worker
 * (VSA_E2E_WORKER) instead of a local `wrangler dev` on 127.0.0.1:8797. No
 * dev server is spawned — the worker is already deployed (R2 bucket +
 * Durable Object + assets are all real Cloudflare resources).
 *
 * Differences from scenario-2vault.mjs:
 *   • WORKER is the https workers.dev URL (real network on every op: WS
 *     fan-out, /blob PUT+GET through real R2, admin routes).
 *   • prep step additionally:
 *       - refreshes the CURRENT plugin build (main.js/manifest/styles.css
 *         from packages/plugin) into both vaults, and
 *       - UNLINKS both vaults from the previous local 8797 worker at the
 *         disk level, mirroring plugin unlink(): deletes /.vaultsyncforagents/
 *         (device.json FR-44 marker + state index + tmp) and resets
 *         data.json to defaults while KEEPING deviceName + settings, and
 *       - removes the artifact files/folders this scenario itself creates
 *         (left over from the earlier local-server run), so every create
 *         step starts from a clean slate.
 *   • timeouts are widened (pairing race 40s, propagation budget 40s) for
 *     real-network latency; assertions are unchanged.
 *
 * Phases: claim/mint → unlink+prep → pair both → bidirectional file sync
 * (create/edit/rename/delete) → >256KB binary blob smoke → history/conflict
 * audit → folder-operations phase (F1-F6).
 *
 * Usage: node scripts/e2e/scenario-cloud.mjs
 *   VSA_E2E_WORKER      worker base URL (default http://127.0.0.1:8797)
 *   VSA_E2E_PASSPHRASE  admin passphrase (default two-vault-test — LOCAL
 *                       wrangler-dev rooms only; set this for a deployed room)
 * Exit 0 iff every step passed (KNOWN-GAP-CONFIRMED passes with a note).
 * Report: scripts/e2e/report-cloud.json + stdout.
 */

import { execFile, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { connectPage, listTargets } from './cdp.mjs';

const execFileP = promisify(execFile);
const HERE = join(fileURLToPath(import.meta.url), '..');

// --- constants ---------------------------------------------------------------------------------

// Target worker + admin passphrase come from the env (see header) — no
// deployed URL or live passphrase is hardcoded here.
const WORKER = process.env.VSA_E2E_WORKER ?? 'http://127.0.0.1:8797';
const PASSPHRASE = process.env.VSA_E2E_PASSPHRASE ?? 'two-vault-test';
const VAULT_NAME = 'two-vault-test';

const OBSIDIAN_EXE = 'C:\\Program Files\\Obsidian\\Obsidian.exe'; // verified present (AppData/Local has only the updater)
const PLUGIN_PKG = 'Z:/Projects/syncv2/packages/plugin';
const V4_DIR = 'Z:/Projects/TestVaults/TestVault4';
const V5_DIR = 'Z:/Projects/TestVaults/TestVault5';
const PROFILE_A = 'Z:/Projects/TestVaults/e2e-2vault-profile'; // opens TestVault4
const PROFILE_B = 'Z:/Projects/TestVaults/e2e-2vault-profile-b'; // opens TestVault5
const PORT_A = 9222;
const PORT_B = 9223;
const CDP_A = `http://127.0.0.1:${PORT_A}`;
const CDP_B = `http://127.0.0.1:${PORT_B}`;

const DEVICE4 = 'e2e-vault4';
const DEVICE5 = 'e2e-vault5';
const SYNC_TIMEOUT_MS = 40_000; // widened vs 25s: every op now crosses the real internet twice
const PAIR_RACE_MS = 40_000; // in-page Promise.race budget for pairFromSettings
const PAIR_PERSIST_WAIT_MS = 60_000; // data.json token persistence fallback
const STATUSBAR_WAIT_MS = 60_000; // startup reconciliation pushes the whole vault on first pair

// Files/folders THIS scenario creates (leftovers from the earlier local-8797
// run would make app.vault.create throw "already exists").
const SCENARIO_ARTIFACTS = [
  'v4-note.md',
  'v5-note.md',
  'renamed-from-v4.md',
  'blob-smoke.bin',
  'projects',
  'archive',
  'renamed-projects',
  'to-delete',
];

const jstr = JSON.stringify;

// --- reporting -----------------------------------------------------------------------------------

const report = {
  startedAt: new Date().toISOString(),
  worker: WORKER,
  cloudMode: { realNetwork: true, devServerSpawned: false },
  cleanMode: { webSecurityDisabled: false, overridesInjected: false },
  steps: [],
};
const lines = [];
function step(id, name, phase = 'core') {
  const entry = { id, name, phase, status: 'RUNNING', t0: Date.now() };
  report.steps.push(entry);
  lines.push(`[RUN ] ${id} ${name}`);
  return {
    pass(detail) {
      entry.status = 'PASS';
      entry.ms = Date.now() - entry.t0;
      entry.detail = detail;
      lines.push(`[PASS] ${id} ${name} (${entry.ms} ms)${detail === undefined ? '' : ` — ${fmt(detail)}`}`);
    },
    gap(detail) {
      entry.status = 'KNOWN-GAP-CONFIRMED';
      entry.ms = Date.now() - entry.t0;
      entry.detail = detail;
      lines.push(`[GAP ] ${id} ${name} (${entry.ms} ms) — KNOWN-GAP-CONFIRMED (not a regression) — ${fmt(detail)}`);
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
  const s = a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ');
  lines.push(s);
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

/**
 * Run a step body once; on throw, retry once (evidence rule), then give up.
 * BOTH attempts are caught — the original scenario-2vault.mjs let the retry's
 * throw escape, which aborted the whole run at the first double-failing step.
 */
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

// --- vault helpers (via CDP) ------------------------------------------------------------------------

async function readText(cdp, path) {
  const r = await cdp.eval(
    `(async()=>{ try { return { ok:true, text: await app.vault.adapter.read(${jstr(path)}) }; } catch(e){ return { ok:false, error:String(e) }; } })()`,
  );
  if (!r.ok) throw new Error(`readText eval: ${r.error}`);
  return r.value;
}
async function exists(cdp, path) {
  const r = await cdp.eval(`app.vault.adapter.exists(${jstr(path)}).then(v => ({ok:true, v}), e => ({ok:false, error:String(e)}))`);
  if (!r.ok) throw new Error(`exists eval: ${r.error}`);
  return r.value.v === true;
}
async function readTextOrNull(cdp, path) {
  const r = await readText(cdp, path);
  return r.ok ? r.text : null;
}
async function pluginStatus(cdp) {
  const r = await cdp.eval(`(() => { const p = app.plugins?.plugins?.vaultsyncforagents; if (!p) return null;
    const st = p.client?.status?.() ?? null;
    return { statusBar: p.statusBarItem?.textContent ?? null, status: st, url: p.data?.url ?? null, deviceId: p.data?.deviceId ?? null, overridesFetch: typeof p.overrides?.fetchImpl }; })()`);
  if (!r.ok) throw new Error(`pluginStatus eval: ${r.error}`);
  return r.value;
}
async function conflictFiles(cdp) {
  const r = await cdp.eval(`app.vault.getFiles().filter(f => /conflict/i.test(f.path)).map(f => f.path)`);
  if (!r.ok) throw new Error(`conflictFiles eval: ${r.error}`);
  return r.value;
}
async function allFiles(cdp) {
  const r = await cdp.eval(`app.vault.getFiles().map(f => f.path).sort()`);
  if (!r.ok) throw new Error(`allFiles eval: ${r.error}`);
  return r.value;
}
async function syncNow(cdp) {
  const r = await cdp.eval(`(async()=>{ const p = app.plugins?.plugins?.vaultsyncforagents; if (!p?.syncNow) return 'no-plugin'; await p.syncNow(); return 'synced'; })()`);
  return r;
}

/** Poll vault `cdp` until `path` exists with exact text content `want`. Returns latency. */
async function awaitNoteArrival(cdp, path, want, timeoutMs = SYNC_TIMEOUT_MS) {
  const r = await waitFor(async () => {
    if (!(await exists(cdp, path))) return null;
    const text = await readTextOrNull(cdp, path);
    return text === want ? text : null;
  }, timeoutMs, 400, `arrival ${path}`);
  return r.elapsedMs;
}

// --- disk-level unlink + prep (mirrors plugin unlink(); CLOUD-only additions) -----------------------

/**
 * Unlink vault `dir` from any previous worker at the DISK level while
 * Obsidian is dead — exactly what plugin unlink() persists:
 *   • delete /.vaultsyncforagents/ (FR-44 device.json marker + state index)
 *   • data.json ← defaults, KEEPING deviceName + settings
 */
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
  // defaultPluginData() with deviceName + settings preserved (unlink() semantics)
  const after = {
    url: '',
    token: '',
    deviceId: '',
    deviceName: typeof before?.deviceName === 'string' ? before.deviceName : '',
    settings:
      before?.settings ??
      { rescanIntervalSec: 30, obsidianSync: false, statusBarMode: 'detailed', syncOnStartup: true, logLevel: 'info', ignorePatterns: '' },
  };
  mkdirSync(pluginDir, { recursive: true });
  writeFileSync(dataPath, JSON.stringify(after, null, 2));
  return {
    removed,
    dataBefore: before ? { url: before.url, deviceId: before.deviceId, deviceName: before.deviceName, tokenLen: (before.token || '').length } : null,
    dataAfter: { url: after.url, deviceId: after.deviceId, deviceName: after.deviceName, tokenLen: 0 },
  };
}

/** Remove files/folders this scenario itself creates (rerun hygiene). */
function removeScenarioArtifacts(dir) {
  const gone = [];
  for (const name of SCENARIO_ARTIFACTS) {
    const p = join(dir, name);
    if (existsSync(p)) {
      rmSync(p, { recursive: true, force: true });
      gone.push(name);
    }
  }
  return gone;
}

/** Refresh the CURRENT plugin build into a vault (same as scenario-hardened prep). */
function refreshPluginFiles(dir) {
  const dest = join(dir, '.obsidian/plugins/vaultsyncforagents');
  mkdirSync(dest, { recursive: true });
  for (const f of ['main.js', 'manifest.json', 'styles.css']) copyFileSync(join(PLUGIN_PKG, f), join(dest, f));
  return true;
}

// --- launch / first-run dialogs ---------------------------------------------------------------------

function launchObsidian(profileDir, port) {
  if (!existsSync(OBSIDIAN_EXE)) throw new Error(`Obsidian.exe not found at ${OBSIDIAN_EXE}`);
  const child = spawn(OBSIDIAN_EXE, [`--user-data-dir=${profileDir}`, `--remote-debugging-port=${port}`], {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
  return child.pid;
}

/** Click "Trust author and enable plugins" style first-run buttons. Returns labels clicked. */
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

async function domEvidence(cdp) {
  const r = await cdp.eval(`(() => ({
    hasApp: typeof app !== 'undefined',
    vault: (typeof app !== 'undefined' && app.vault?.adapter?.basePath) || null,
    pluginLoaded: !!app.plugins?.plugins?.vaultsyncforagents,
    modals: [...document.querySelectorAll('.modal')].map(m => (m.textContent || '').trim().slice(0, 200)),
    buttons: [...document.querySelectorAll('button')].map(b => (b.textContent || '').trim()).filter(Boolean).slice(0, 40),
  }))()`);
  return r.ok ? r.value : { evalError: r.error };
}

/**
 * Bring one Obsidian instance to "vault open, plugin loaded, console captured".
 * Returns a connected Cdp. Drives the trust-author dialog when it appears.
 */
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
  let dialogsClicked = [];
  await waitFor(async () => {
    if (cdp === null) {
      try {
        cdp = await connectPage({ match, http });
      } catch {
        // window may exist before app/vault is ready — keep polling; also poke
        // dialogs on whatever page is there via a throwaway connection.
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

// --- CORS / Illegal-invocation tripwire (headline) ---------------------------------------------------

const FATAL_PATTERNS = [
  /blocked by CORS policy/i,
  /Access-Control-Allow-Origin/i,
  /Illegal invocation/i,
  /Failed to execute 'fetch'/i,
];
function fatalConsoleHits(cdps) {
  const hits = [];
  for (const [name, cdp] of Object.entries(cdps)) {
    if (!cdp) continue; // instance may never have launched
    for (const entry of cdp.consoleLog) {
      if (FATAL_PATTERNS.some((re) => re.test(entry.text))) hits.push({ vault: name, ...entry });
    }
  }
  return hits;
}

// --- main --------------------------------------------------------------------------------------------

let cookie;
let cdp4 = null;
let cdp5 = null;
let exitCode = 0;
let fatalStop = false;
const pairCodes = {};
const deviceIds = {};

process.on('uncaughtException', (e) => {
  lines.push(`[FATAL-uncaught] ${String(e?.stack ?? e)}`);
  report.fatal = String(e?.message ?? e);
});

try {
  // ---- step 0: kill Obsidian, health-check CLOUD worker, unlink vaults, write profiles ----------
  {
    const s = step('prep', 'kill Obsidian; CLOUD /health; refresh plugin build; UNLINK both vaults from local 8797; clear scenario artifacts; write profiles');
    try {
      await execFileP('taskkill', ['/F', '/IM', 'Obsidian.exe']).catch((e) => String(e)); // authorized; fine if none running
      await sleep(1500);
      const health = await wk('/health');
      if (health.status !== 200 || health.body.ok !== true) throw new Error(`unexpected /health: ${fmt(health.body)}`);
      if (health.body.claimed === true) {
        log(`  note: worker already claimed (re-run) — step 1 will prove the room is ours`);
      }
      // Refresh the current plugin build into both vaults, then unlink them
      // from the old local worker (disk-level mirror of plugin unlink()).
      const unlinkEvidence = {};
      for (const [name, dir] of [['TestVault4', V4_DIR], ['TestVault5', V5_DIR]]) {
        refreshPluginFiles(dir);
        unlinkEvidence[name] = unlinkVaultOnDisk(dir);
        unlinkEvidence[name].artifactsRemoved = removeScenarioArtifacts(dir);
      }
      const { stdout: pa } = await execFileP(process.execPath, [join(HERE, 'write-profile.mjs'), PROFILE_A, V4_DIR, V5_DIR]);
      const { stdout: pb } = await execFileP(process.execPath, [join(HERE, 'write-profile.mjs'), PROFILE_B, V5_DIR, V4_DIR]);
      s.pass({
        health: health.body,
        pluginRefreshedFrom: PLUGIN_PKG,
        unlink: unlinkEvidence,
        profileA: pa.trim(),
        profileB: pb.trim(),
        cdpPorts: { vault4: PORT_A, vault5: PORT_B },
        launchFlags: ['--user-data-dir=…', '--remote-debugging-port=…', 'NO --disable-web-security'],
      });
    } catch (e) {
      s.fail(String(e.message ?? e));
      fatalStop = true;
    }
  }

  // ---- step 1: claim + admin login + TWO pairing codes --------------------------------------
  {
    const s = step('1', 'claim CLOUD worker (POST /claim), admin login, mint TWO pairing codes');
    try {
      if (fatalStop) throw new Error('skipped (prep failed)');
      let claimNote = 'fresh claim';
      let claimDeviceId = null;
      const claim = await wk('/claim', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ passphrase: PASSPHRASE, vaultName: VAULT_NAME, deviceName: 'e2e-admin', deviceType: 'desktop' }),
      });
      if (claim.status !== 200) {
        // re-run tolerance: worker may already be claimed by a previous run of
        // THIS scenario — proceed only if it is our own room.
        const probe = await wk('/admin/login', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ passphrase: PASSPHRASE }),
        });
        const probeCookie = (probe.headers.get('set-cookie') ?? '').split(';')[0];
        const st = probeCookie ? await wk('/api/status', { headers: { cookie: probeCookie } }) : { body: null };
        if (probe.status !== 200 || st.body?.vaultName !== VAULT_NAME) {
          throw new Error(`claim HTTP ${claim.status}: ${fmt(claim.body)} — and not our room (login=${probe.status}, vaultName=${st.body?.vaultName})`);
        }
        claimNote = `already claimed by this scenario (claim HTTP ${claim.status}) — room reused`;
      } else {
        claimDeviceId = claim.body.deviceId ?? null;
      }
      const login = await wk('/admin/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ passphrase: PASSPHRASE }),
      });
      if (login.status !== 200) throw new Error(`admin login HTTP ${login.status}: ${fmt(login.body)}`);
      cookie = (login.headers.get('set-cookie') ?? '').split(';')[0];
      if (!cookie.startsWith('vsa_admin=')) throw new Error(`unexpected cookie: ${cookie.slice(0, 30)}`);
      for (const [key, dev] of [['code4', DEVICE4], ['code5', DEVICE5]]) {
        const res = await wk('/admin/pair', {
          method: 'POST',
          headers: { 'content-type': 'application/json', cookie },
          body: JSON.stringify({ deviceName: dev, deviceType: 'desktop' }),
        });
        if (res.status !== 200 || typeof res.body.code !== 'string') throw new Error(`admin pair ${dev} HTTP ${res.status}: ${fmt(res.body)}`);
        pairCodes[key] = res.body.code;
      }
      const codeShape = /^[A-Z2-9]{4}-[A-Z2-9]{4}$/;
      if (!codeShape.test(pairCodes.code4) || !codeShape.test(pairCodes.code5)) throw new Error(`bad code shapes: ${fmt(pairCodes)}`);
      s.pass({
        claim: { note: claimNote, deviceId: claimDeviceId },
        adminCookie: 'vsa_admin=…',
        pairingCodes: { vault4: pairCodes.code4, vault5: pairCodes.code5 },
      });
    } catch (e) {
      s.fail(String(e.message ?? e));
      fatalStop = true;
    }
  }

  // ---- step 2: launch instance A (TestVault4) and pair — CLEAN, no overrides ------------------
  {
    const s = step('2', 'launch Obsidian→TestVault4 (no --disable-web-security), pair via pairFromSettings(code#1) — NO overrides');
    try {
      if (fatalStop) throw new Error('skipped (earlier fatal)');
      const pid = launchObsidian(PROFILE_A, PORT_A);
      const ready = await awaitInstanceReady({ http: CDP_A, match: 'TestVault4', label: 'vault4' });
      cdp4 = ready.cdp;
      const dom = await domEvidence(cdp4);
      // CLEAN pairing: set only the settings a user would type (url + device
      // name — the normal settings-tab flow), then the plugin's own code path.
      const pairT0 = Date.now();
      const outcome = await cdp4.eval(`(async () => {
        const p = app.plugins.plugins.vaultsyncforagents;
        p.data.url = ${jstr(WORKER)};
        p.data.deviceName = ${jstr(DEVICE4)};
        const raced = await Promise.race([
          p.pairFromSettings(${jstr(pairCodes.code4)}).then(o => ({ done: true, outcome: o })),
          new Promise(r => setTimeout(() => r({ done: false }), ${PAIR_RACE_MS})),
        ]);
        return { raced, overridesFetch: typeof p.overrides.fetchImpl, data: { url: p.data.url, deviceId: p.data.deviceId, tokenLen: (p.data.token || '').length } };
      })()`);
      if (!outcome.ok) throw new Error(`pair eval failed: ${outcome.error}`);
      let final = outcome.value;
      if (!final.raced.done) {
        // pairing still running in-page (WS startup reconciliation) — poll data.json
        const got = await waitFor(async () => {
          const r = await cdp4.eval(`(async()=>{ const d = JSON.parse(await app.vault.adapter.read('.obsidian/plugins/vaultsyncforagents/data.json')); return (d.token||'').length > 10 ? d : null; })()`);
          return r.ok ? r.value : null;
        }, PAIR_PERSIST_WAIT_MS, 1000, 'vault4 token persisted');
        final = { raced: { done: true, outcome: { status: 'paired', late: true } }, data: got, overridesFetch: final.overridesFetch };
      }
      deviceIds.vault4 = final.data?.deviceId ?? null;
      // status bar reaches a connected/ok state (first pair pushes the whole
      // vault — ~35 files + 600KB blob — through real R2, so a wide budget)
      const sb = await waitFor(async () => {
        const st = await pluginStatus(cdp4);
        return st?.statusBar?.startsWith('vsa ✓') ? st : null;
      }, STATUSBAR_WAIT_MS, 1000, 'vault4 status bar ✓');
      const cors = fatalConsoleHits({ vault4: cdp4 });
      if (final.raced.outcome.status !== 'paired') throw new Error(`pair outcome: ${fmt(final.raced.outcome)}`);
      if (final.overridesFetch !== 'undefined') throw new Error(`overrides.fetchImpl was set (${final.overridesFetch}) — not clean mode!`);
      if (cors.length > 0) {
        s.fail({ headline: 'CORS/Illegal-invocation console errors — CLOUD worker CORS broken', hits: cors.slice(0, 5) });
        fatalStop = true;
        throw new Error(`FIX-REGRESSION: ${fmt(cors.slice(0, 3))}`);
      }
      s.pass({
        headline: 'CLOUD PAIRING WORKS WITH ZERO WORKAROUNDS (real https worker, no --disable-web-security, no overrides.fetchImpl)',
        pid,
        instanceReadyMs: ready.readyMs,
        firstRunDialogsDriven: ready.dialogsClicked,
        vault: dom.vault,
        pairOutcome: final.raced.outcome,
        pairCallMs: Date.now() - pairT0,
        overridesFetchImpl: final.overridesFetch,
        persisted: { url: final.data.url, deviceId: final.data.deviceId, tokenLen: final.data.tokenLen },
        statusBar: sb.value.statusBar,
        clientState: sb.value.status?.state,
      });
    } catch (e) {
      s.fail(String(e.message ?? e));
      const hits = fatalConsoleHits({ vault4: cdp4 });
      if (hits.length) report.step2ConsoleHits = hits.slice(0, 10);
      if (/CORS|Illegal invocation|pair outcome|overrides/i.test(String(e.message ?? e))) fatalStop = true; // STOP rule
    }
  }

  // ---- step 3: launch instance B (TestVault5), pair, both devices ONLINE ----------------------
  {
    const s = step('3', 'launch Obsidian→TestVault5, pair with code#2, assert BOTH devices online in /api/status');
    try {
      if (fatalStop) throw new Error('skipped (earlier fatal)');
      const pid = launchObsidian(PROFILE_B, PORT_B);
      const ready = await awaitInstanceReady({ http: CDP_B, match: 'TestVault5', label: 'vault5' });
      cdp5 = ready.cdp;
      const outcome = await cdp5.eval(`(async () => {
        const p = app.plugins.plugins.vaultsyncforagents;
        p.data.url = ${jstr(WORKER)};
        p.data.deviceName = ${jstr(DEVICE5)};
        const raced = await Promise.race([
          p.pairFromSettings(${jstr(pairCodes.code5)}).then(o => ({ done: true, outcome: o })),
          new Promise(r => setTimeout(() => r({ done: false }), ${PAIR_RACE_MS})),
        ]);
        return { raced, overridesFetch: typeof p.overrides.fetchImpl, data: { url: p.data.url, deviceId: p.data.deviceId, tokenLen: (p.data.token || '').length } };
      })()`);
      if (!outcome.ok) throw new Error(`pair eval failed: ${outcome.error}`);
      let final = outcome.value;
      if (!final.raced.done) {
        const got = await waitFor(async () => {
          const r = await cdp5.eval(`(async()=>{ const d = JSON.parse(await app.vault.adapter.read('.obsidian/plugins/vaultsyncforagents/data.json')); return (d.token||'').length > 10 ? d : null; })()`);
          return r.ok ? r.value : null;
        }, PAIR_PERSIST_WAIT_MS, 1000, 'vault5 token persisted');
        final = { raced: { done: true, outcome: { status: 'paired', late: true } }, data: got, overridesFetch: final.overridesFetch };
      }
      deviceIds.vault5 = final.data?.deviceId ?? null;
      if (final.raced.outcome.status !== 'paired') throw new Error(`pair outcome: ${fmt(final.raced.outcome)}`);
      if (final.overridesFetch !== 'undefined') throw new Error(`overrides.fetchImpl set (${final.overridesFetch})`);
      const sb = await waitFor(async () => {
        const st = await pluginStatus(cdp5);
        return st?.statusBar?.startsWith('vsa ✓') ? st : null;
      }, STATUSBAR_WAIT_MS, 1000, 'vault5 status bar ✓');
      const cors = fatalConsoleHits({ vault4: cdp4, vault5: cdp5 });
      if (cors.length > 0) throw new Error(`FIX-REGRESSION console hits: ${fmt(cors.slice(0, 3))}`);
      // both devices online per admin API
      const st = await waitFor(async () => {
        const res = await wk('/api/status', { headers: { cookie } });
        const devices = res.body?.devices ?? [];
        const online = devices.filter((d) => d.online).map((d) => d.name);
        const have = new Set(devices.map((d) => d.name));
        return have.has(DEVICE4) && have.has(DEVICE5) && online.includes(DEVICE4) && online.includes(DEVICE5)
          ? { devices, online }
          : null;
      }, 45_000, 1000, 'both devices online');
      const devices = st.value.devices.map((d) => `${d.name}(${d.type},${d.online ? 'online' : 'offline'})`);
      s.pass({
        headline: 'BOTH VAULTS PAIRED CLEANLY TO CLOUD — two online devices + admin in one room',
        pid,
        instanceReadyMs: ready.readyMs,
        firstRunDialogsDriven: ready.dialogsClicked,
        pairOutcome: final.raced.outcome,
        persisted: { deviceId: final.data.deviceId, tokenLen: final.data.tokenLen },
        statusBar: sb.value.statusBar,
        devices,
        attachments: st.value.attachments ?? null,
      });
    } catch (e) {
      s.fail(String(e.message ?? e));
      const hits = fatalConsoleHits({ vault4: cdp4, vault5: cdp5 });
      if (hits.length) report.step3ConsoleHits = hits.slice(0, 10);
      if (/CORS|Illegal invocation|pair outcome|overrides/i.test(String(e.message ?? e))) fatalStop = true;
    }
  }

  if (fatalStop) {
    lines.push('[STOP] fatal condition hit (pairing/CORS/Illegal-invocation) — skipping sync phases per orders');
  }

  // ---- step 4: BIDIRECTIONAL SYNC -------------------------------------------------------------
  const bidir = [
    {
      id: '4a',
      name: 'vault4 create v4-note.md → vault5 receives byte-identical',
      async run() {
        const stamp = Date.now();
        const content = `from vault4 ${stamp}`;
        const created = await cdp4.eval(`app.vault.create('v4-note.md', ${jstr(content)}).then(() => 'created')`);
        if (!created.ok) throw new Error(`create: ${created.error}`);
        const ms = await awaitNoteArrival(cdp5, 'v4-note.md', content);
        return { content, latencyMs: ms };
      },
    },
    {
      id: '4b',
      name: 'vault5 modifies SAME note → vault4 sees vault5 version',
      async run() {
        const stamp = Date.now();
        const content = `edited in vault5 ${stamp}`;
        const mod = await cdp5.eval(`app.vault.modify(app.vault.getAbstractFileByPath('v4-note.md'), ${jstr(content)}).then(() => 'modified')`);
        if (!mod.ok) throw new Error(`modify: ${mod.error}`);
        const ms = await waitFor(async () => {
          const text = await readTextOrNull(cdp4, 'v4-note.md');
          return text === content ? text : null;
        }, SYNC_TIMEOUT_MS, 400, 'vault4 sees vault5 edit').then((r) => r.elapsedMs);
        return { content, latencyMs: ms, note: 'same-note round-trip: WS fan-out + pull both directions' };
      },
    },
    {
      id: '4c',
      name: 'vault5 create v5-note.md → vault4 receives byte-identical',
      async run() {
        const stamp = Date.now();
        const content = `from vault5 ${stamp}`;
        const created = await cdp5.eval(`app.vault.create('v5-note.md', ${jstr(content)}).then(() => 'created')`);
        if (!created.ok) throw new Error(`create: ${created.error}`);
        const ms = await awaitNoteArrival(cdp4, 'v5-note.md', content);
        return { content, latencyMs: ms };
      },
    },
    {
      id: '4d',
      name: 'vault4 renames v5-note.md → renamed-from-v4.md; vault5 follows',
      async run() {
        const rn = await cdp4.eval(`app.vault.rename(app.vault.getAbstractFileByPath('v5-note.md'), 'renamed-from-v4.md').then(() => 'renamed')`);
        if (!rn.ok) throw new Error(`rename: ${rn.error}`);
        const ms = await waitFor(async () => {
          const haveNew = await exists(cdp5, 'renamed-from-v4.md');
          if (!haveNew) return null;
          return (await exists(cdp5, 'v5-note.md')) ? null : 'gone-old';
        }, SYNC_TIMEOUT_MS, 400, 'vault5 rename propagation').then((r) => r.elapsedMs);
        const text = await readTextOrNull(cdp5, 'renamed-from-v4.md');
        return { latencyMs: ms, vault5Content: text };
      },
    },
    {
      id: '4e',
      name: 'vault5 deletes renamed-from-v4.md (vault.delete → tombstone) → vault4 drops it',
      async run() {
        const del = await cdp5.eval(`app.vault.delete(app.vault.getAbstractFileByPath('renamed-from-v4.md')).then(() => 'deleted')`);
        if (!del.ok) throw new Error(`delete: ${del.error}`);
        const ms = await waitFor(async () => ((await exists(cdp4, 'renamed-from-v4.md')) ? null : 'gone'), SYNC_TIMEOUT_MS, 400, 'vault4 delete propagation').then((r) => r.elapsedMs);
        return { latencyMs: ms, deleteMethod: 'app.vault.delete (permanent — tombstone assertable server-side)' };
      },
    },
    {
      id: '4f',
      name: 'status bars + client.status(): both live, 0 pending, 0 conflicts at rest',
      async run() {
        await sleep(2500); // settle
        const [s4, s5] = await Promise.all([pluginStatus(cdp4), pluginStatus(cdp5)]);
        const bad = [];
        for (const [name, st] of [['vault4', s4], ['vault5', s5]]) {
          if (!st?.statusBar?.startsWith('vsa ✓')) bad.push(`${name} statusBar=${st?.statusBar}`);
          if (st?.status?.state !== 'live') bad.push(`${name} state=${st?.status?.state}`);
          if (st?.status?.pending !== 0) bad.push(`${name} pending=${st?.status?.pending}`);
          if ((st?.status?.conflicts ?? []).length !== 0) bad.push(`${name} conflicts=${st.status.conflicts.length}`);
        }
        if (bad.length) throw new Error(bad.join('; '));
        return { vault4: { statusBar: s4.statusBar, state: s4.status.state, pending: s4.status.pending, lastSyncAt: s4.status.lastSyncAt }, vault5: { statusBar: s5.statusBar, state: s5.status.state, pending: s5.status.pending, lastSyncAt: s5.status.lastSyncAt } };
      },
    },
  ];
  for (const t of bidir) {
    const s = step(t.id, t.name);
    if (fatalStop || !cdp4 || !cdp5) { s.fail('skipped (fatal earlier)'); continue; }
    const r = await withRetry(t.run);
    if (r.ok) s.pass(r.result); else s.fail(String(r.error?.message ?? r.error));
  }

  // ---- step 5: attachment smoke — >256KB binary forces the BLOB STORE (not WS-inline) ----------
  {
    const s = step('5', 'attachment smoke: 600KB random .bin in vault4 → byte-identical in vault5 via real-R2 /blob/*');
    const runOnce = async () => {
      const made = await cdp4.eval(`(async () => {
        const n = 614400; // 600 KB — above the 256 KB INLINE_CONTENT_MAX_BYTES, so the blob store carries it
        const a = new Uint8Array(n);
        for (let off = 0; off < n; off += 0x10000) crypto.getRandomValues(a.subarray(off, Math.min(off + 0x10000, n)));
        await app.vault.createBinary('blob-smoke.bin', a);
        let s = '';
        const CH = 0x8000;
        for (let i = 0; i < a.length; i += CH) s += String.fromCharCode.apply(null, a.subarray(i, i + CH));
        return btoa(s);
      })()`);
      if (!made.ok) throw new Error(`createBinary: ${made.error}`);
      const b64 = made.value;
      const sha = createHash('sha256').update(Buffer.from(b64, 'base64')).digest('hex');
      const ms = await waitFor(async () => {
        const r = await cdp5.eval(`(async () => {
          const f = app.vault.getAbstractFileByPath('blob-smoke.bin');
          if (!f) return null;
          const a = new Uint8Array(await app.vault.readBinary(f));
          let s = ''; const CH = 0x8000;
          for (let i = 0; i < a.length; i += CH) s += String.fromCharCode.apply(null, a.subarray(i, i + CH));
          return btoa(s);
        })()`);
        return r.ok && r.value === b64 ? r.value.length : null;
      }, SYNC_TIMEOUT_MS, 500, 'blob arrival').then((r) => r.elapsedMs);
      const hist = await wk(`/api/history?path=${encodeURIComponent('/blob-smoke.bin')}`, { headers: { cookie } });
      const status = await wk('/api/status', { headers: { cookie } });
      const head = hist.body?.versions?.[0];
      if (head && head.hash !== sha) throw new Error(`server hash mismatch: server=${head.hash} local=${sha}`);
      return {
        bytes: Buffer.from(b64, 'base64').length,
        sha256: sha.slice(0, 16) + '…',
        latencyMs: ms,
        serverVersion: head ? { id: head.id, kind: head.kind, size: head.size, hash: head.hash?.slice(0, 12) + '…', deviceId: head.deviceId } : null,
        workerAttachments: status.body?.attachments ?? null,
        blobPathForced: '600KB > 256KB inline cap → PUT/GET /blob/:hash through REAL Cloudflare R2',
      };
    };
    if (fatalStop || !cdp4 || !cdp5) s.fail('skipped (fatal earlier)');
    else {
      const r = await withRetry(runOnce);
      if (r.ok) s.pass(r.result); else s.fail(String(r.error?.message ?? r.error));
    }
  }

  // ---- step 6: history chain + conflict audit ---------------------------------------------------
  {
    const s = step('6', 'history sanity for v4-note.md (create@vault4-device, edit@vault5-device) + 0 conflict files');
    try {
      if (fatalStop || !cdp4 || !cdp5) throw new Error('skipped (fatal earlier)');
      const hist = await wk(`/api/history?path=${encodeURIComponent('/v4-note.md')}`, { headers: { cookie } });
      if (hist.status !== 200) throw new Error(`history HTTP ${hist.status}`);
      const versions = hist.body.versions ?? [];
      const d4 = deviceIds.vault4;
      const d5 = deviceIds.vault5;
      const chain = versions.map((v) => ({ kind: v.kind, deviceId: v.deviceId, current: v.current })).reverse();
      const hasCreateFrom4 = versions.some((v) => v.deviceId === d4);
      const hasEditFrom5 = versions.some((v) => v.deviceId === d5 && (v.kind === 'edit' || v.kind === 'rename'));
      if (!hasCreateFrom4 || !hasEditFrom5) throw new Error(`version chain not sane: ${fmt(chain)}`);
      const [c4, c5] = await Promise.all([conflictFiles(cdp4), conflictFiles(cdp5)]);
      if (c4.length || c5.length) throw new Error(`conflict files: vault4=${fmt(c4)} vault5=${fmt(c5)}`);
      s.pass({ versionChainOldestFirst: chain, conflictFiles: { vault4: c4, vault5: c5 }, headCurrentCount: versions.filter((v) => v.current).length });
    } catch (e) {
      s.fail(String(e.message ?? e));
    }
  }

  // ---- FOLDER OPERATIONS PHASE (F1-F6) -----------------------------------------------------------
  const folderOps = [
    {
      id: 'F1',
      name: 'folder create with content (explicit createFolder first): projects/a.md + projects/b.md in vault4 → vault5 gets both',
      async run() {
        const ca = `projects/a content ${Date.now()}`;
        const cb = `projects/b content ${Date.now()}`;
        // Obsidian 43.1.1: vault.create no longer auto-creates parent dirs
        // (ENOENT) — create the folder explicitly first, as Obsidian's UI does.
        const r = await cdp4.eval(`(async()=>{
          try { await app.vault.createFolder('projects'); } catch (e) { if (!/exists/i.test(String(e))) throw e; }
          await app.vault.create('projects/a.md', ${jstr(ca)});
          await app.vault.create('projects/b.md', ${jstr(cb)});
          return 'ok';
        })()`);
        if (!r.ok) throw new Error(`create: ${r.error}`);
        const msA = await awaitNoteArrival(cdp5, 'projects/a.md', ca);
        const msB = await awaitNoteArrival(cdp5, 'projects/b.md', cb);
        const folderIn5 = await exists(cdp5, 'projects');
        return { latencyA_ms: msA, latencyB_ms: msB, folderMaterializedInVault5: folderIn5, contents: { a: ca, b: cb } };
      },
    },
    {
      id: 'F2',
      name: "file move across folders: projects/a.md → archive/a.md; check rename vs delete+add",
      async run() {
        const pre = await readTextOrNull(cdp4, 'projects/a.md');
        const r = await cdp4.eval(`(async()=>{
          try { await app.vault.createFolder('archive'); } catch (e) {}
          await app.vault.rename(app.vault.getAbstractFileByPath('projects/a.md'), 'archive/a.md');
          return 'moved';
        })()`);
        if (!r.ok) throw new Error(`move: ${r.error}`);
        const ms = await waitFor(async () => {
          const haveNew = await exists(cdp5, 'archive/a.md');
          if (!haveNew) return null;
          return (await exists(cdp5, 'projects/a.md')) ? null : 'ok';
        }, SYNC_TIMEOUT_MS, 400, 'vault5 move propagation').then((x) => x.elapsedMs);
        const content5 = await readTextOrNull(cdp5, 'archive/a.md');
        if (content5 !== pre) throw new Error(`content changed across move: ${fmt({ pre, content5 })}`);
        const hNew = await wk(`/api/history?path=${encodeURIComponent('/archive/a.md')}`, { headers: { cookie } });
        const hOld = await wk(`/api/history?path=${encodeURIComponent('/projects/a.md')}`, { headers: { cookie } });
        const newKinds = (hNew.body?.versions ?? []).map((v) => v.kind);
        const oldKinds = (hOld.body?.versions ?? []).map((v) => v.kind);
        const mechanism = newKinds.includes('rename')
          ? 'rename (server recorded kind=rename at destination)'
          : `delete+add (destination kinds=${JSON.stringify(newKinds)}, source kinds=${JSON.stringify(oldKinds)}) — acceptable v1 behavior`;
        return { latencyMs: ms, contentPreserved: content5 === pre, mechanism, destinationKinds: newKinds, sourceKinds: oldKinds };
      },
    },
    {
      id: 'F3',
      name: "folder move: vault5 renames projects → renamed-projects; vault4 children follow",
      async run() {
        const consoleMark = cdp5.consoleLog.length;
        const r = await cdp5.eval(`app.vault.rename(app.vault.getAbstractFileByPath('projects'), 'renamed-projects').then(() => 'folder-renamed')`);
        if (!r.ok) throw new Error(`folder rename: ${r.error}`);
        const ms = await waitFor(async () => {
          const haveNew = await exists(cdp4, 'renamed-projects/b.md');
          if (!haveNew) return null;
          return (await exists(cdp4, 'projects/b.md')) ? null : 'ok';
        }, SYNC_TIMEOUT_MS, 400, 'vault4 folder-rename propagation').then((x) => x.elapsedMs);
        const vsaLogs = cdp5.consoleLog.slice(consoleMark).filter((e) => /\[vsa\]/i.test(e.text)).map((e) => `${e.level}: ${e.text.slice(0, 160)}`);
        return { latencyMs: ms, vault4HasRenamedProjectsB: true, vault5VsaConsole: vsaLogs.slice(0, 8) };
      },
    },
    {
      id: 'F4',
      name: 'delete archive/a.md in vault4 → vault5 drops file; observe empty archive folder both sides ~40s',
      async run() {
        const r = await cdp4.eval(`app.vault.delete(app.vault.getAbstractFileByPath('archive/a.md')).then(() => 'deleted')`);
        if (!r.ok) throw new Error(`delete: ${r.error}`);
        const ms = await waitFor(async () => ((await exists(cdp5, 'archive/a.md')) ? null : 'gone'), SYNC_TIMEOUT_MS, 400, 'vault5 file-delete propagation').then((x) => x.elapsedMs);
        // observe the now-empty 'archive' folder on both sides across ~2 rescan cycles
        const samples = [];
        for (let i = 0; i <= 8; i++) {
          const [e4, e5] = await Promise.all([exists(cdp4, 'archive'), exists(cdp5, 'archive')]);
          samples.push({ t_s: i * 5, vault4: e4, vault5: e5 });
          if (i < 8) await sleep(5000);
        }
        const first = samples[0];
        const last = samples[samples.length - 1];
        return {
          fileDeleteLatencyMs: ms,
          emptyFolderObservation: samples,
          observedBehavior: `archive folder ${last.vault4 && last.vault5 ? 'PERSISTS as an (empty) folder on both sides' : last.vault4 || last.vault5 ? 'persisted on one side only' : 'disappeared'} after 40s (initial: v4=${first.vault4} v5=${first.vault5})`,
        };
      },
    },
    {
      id: 'F5',
      name: 'empty-folder deletion: to-delete in vault5 → sync placeholder → delete → vault4 drop? (known gap candidate)',
      async run(s) {
        const mk = await cdp5.eval(`app.vault.createFolder('to-delete').then(() => 'created')`);
        if (!mk.ok) throw new Error(`createFolder: ${mk.error}`);
        // placeholder sync → vault4 sees the folder
        let placeholderMs = null;
        try {
          placeholderMs = await waitFor(async () => ((await exists(cdp4, 'to-delete')) ? true : null), 35_000, 1000, 'vault4 sees to-delete').then((x) => x.elapsedMs);
        } catch {
          await syncNow(cdp4); // rescan poke, then one more window
          placeholderMs = await waitFor(async () => ((await exists(cdp4, 'to-delete')) ? true : null), 35_000, 1000, 'vault4 sees to-delete after poke').then((x) => x.elapsedMs);
        }
        await sleep(3000); // let vault5's placeholder push fully settle
        // Obsidian 43.1.1: vault.delete(TFolder) always fails ERR_FS_EISDIR —
        // fileManager.trashFile is the plugin's own documented workaround.
        const del = await cdp5.eval(`(async () => {
          const f = app.vault.getAbstractFileByPath('to-delete');
          if (!f) return 'missing';
          try { await app.fileManager.trashFile(f); return 'trashed'; }
          catch (e) { return String(e).slice(0, 200); } })()`);
        if (!del.ok) throw new Error(`folder trash: ${del.error}`);
        if (del.value !== 'trashed') throw new Error(`folder trash failed: ${del.value}`);
        let propagated = false;
        try {
          await waitFor(async () => ((await exists(cdp4, 'to-delete')) ? null : 'gone'), 40_000, 1000, 'vault4 drops to-delete');
          propagated = true;
        } catch { /* not propagated */ }
        if (propagated) {
          s.pass({ placeholderSyncMs: placeholderMs, deleteMethod: 'fileManager.trashFile', deletePropagation: 'propagated within 40s', result: 'empty-folder deletion DID propagate' });
        } else {
          await syncNow(cdp4);
          await sleep(5000);
          const still = await exists(cdp4, 'to-delete');
          s.gap({
            placeholderSyncMs: placeholderMs,
            deleteMethod: 'fileManager.trashFile',
            afterDeletePlusPoke: still ? 'to-delete STILL present in vault4' : 'gone after manual syncNow poke',
            evidence: 'folder-placeholder tombstoning is deferred in core (engine.ts: "Tombstoned placeholders record only") — confirmed expected gap, not a regression',
          });
        }
        return { placeholderSyncMs: placeholderMs, propagated };
      },
    },
    {
      id: 'F6',
      name: 'post-folder-ops sanity: 0 conflict files both vaults; both plugins live/pending 0',
      async run() {
        await sleep(2500);
        const [c4, c5] = await Promise.all([conflictFiles(cdp4), conflictFiles(cdp5)]);
        const [s4, s5] = await Promise.all([pluginStatus(cdp4), pluginStatus(cdp5)]);
        const bad = [];
        if (c4.length) bad.push(`vault4 conflicts: ${c4.join(', ')}`);
        if (c5.length) bad.push(`vault5 conflicts: ${c5.join(', ')}`);
        for (const [name, st] of [['vault4', s4], ['vault5', s5]]) {
          if (st?.status?.state !== 'live') bad.push(`${name} state=${st?.status?.state}`);
          if (st?.status?.pending !== 0) bad.push(`${name} pending=${st?.status?.pending}`);
          if (!st?.statusBar?.startsWith('vsa ✓')) bad.push(`${name} statusBar=${st?.statusBar}`);
        }
        if (bad.length) throw new Error(bad.join('; '));
        return { conflictFiles: { vault4: c4, vault5: c5 }, vault4: { state: s4.status.state, pending: s4.status.pending, statusBar: s4.statusBar }, vault5: { state: s5.status.state, pending: s5.status.pending, statusBar: s5.statusBar } };
      },
    },
  ];
  for (const t of folderOps) {
    const s = step(t.id, t.name, 'folder-ops');
    if (fatalStop || !cdp4 || !cdp5) { s.fail('skipped (fatal earlier)'); continue; }
    try {
      if (t.id === 'F5') {
        await t.run(s); // F5 reports PASS/GAP itself
      } else {
        const r = await withRetry(t.run);
        if (r.ok) s.pass(r.result); else s.fail(String(r.error?.message ?? r.error));
      }
    } catch (e) {
      s.fail(String(e.message ?? e));
    }
  }

  // ---- final state ------------------------------------------------------------------------------
  if (cdp4 && cdp5) {
    try {
      report.finalFiles = { vault4: await allFiles(cdp4), vault5: await allFiles(cdp5) };
      report.finalFolders = {
        vault4: await cdp4.eval(`app.vault.getAllLoadedFiles().filter(f=>f.children!==undefined).map(f=>f.path).sort()`).then((r) => r.value),
        vault5: await cdp5.eval(`app.vault.getAllLoadedFiles().filter(f=>f.children!==undefined).map(f=>f.path).sort()`).then((r) => r.value),
      };
    } catch { /* best effort */ }
  }
} catch (fatal) {
  lines.push(`[FATAL] ${String(fatal?.stack ?? fatal)}`);
  report.fatal = String(fatal?.message ?? fatal);
} finally {
  // console capture + teardown
  const consoles = {};
  if (cdp4) consoles.vault4 = cdp4.consoleLog;
  if (cdp5) consoles.vault5 = cdp5.consoleLog;
  report.consoleProblems = {};
  for (const [name, entries] of Object.entries(consoles)) {
    report.consoleProblems[name] = entries.filter((e) => ['error', 'warning', 'warn'].includes(String(e.level).toLowerCase()));
  }
  report.finishedAt = new Date().toISOString();
  let failed = 0;
  for (const st of report.steps) {
    if (st.status === 'FAIL' || st.status === 'RUNNING') failed++;
  }
  report.overall = failed === 0 ? 'PASS' : 'FAIL';
  const passed = report.steps.filter((x) => x.status === 'PASS').length;
  const gaps = report.steps.filter((x) => x.status === 'KNOWN-GAP-CONFIRMED').length;
  exitCode = failed === 0 ? 0 : 1;
  lines.push('');
  lines.push(`SUMMARY: ${passed} PASS, ${failed} FAIL, ${gaps} KNOWN-GAP — overall ${report.overall}`);
  lines.push('Workaround-free CLOUD pairing verdict: ' + (
    report.steps.find((x) => x.id === '2')?.status === 'PASS'
      ? 'CLEAN-MODE PAIRING WORKS AGAINST THE REAL CLOUDFLARE WORKER — no --disable-web-security, no overrides.fetchImpl, CORS OK on deployed worker'
      : 'SEE STEP 2/3 — clean-mode cloud pairing did not pass'));
  const totalProblems = Object.values(report.consoleProblems).reduce((a, b) => a + b.length, 0);
  lines.push(`Console errors/warnings captured: ${totalProblems}`);
  for (const [name, entries] of Object.entries(report.consoleProblems)) {
    for (const c of entries.slice(0, 10)) lines.push(`  [${name} ${c.level}] ${c.text.slice(0, 240)}`);
  }
  try {
    writeFileSync(join(HERE, 'report-cloud.json'), JSON.stringify(report, null, 2));
  } catch { /* best effort */ }
  cdp4?.close();
  cdp5?.close();
  // TEARDOWN: kill Obsidian; LEAVE the deployed CLOUD worker RUNNING (user's own
  // account) and both vaults paired to it (dogfood state).
  await execFileP('taskkill', ['/F', '/IM', 'Obsidian.exe']).catch(() => {});
  lines.push(`TEARDOWN: Obsidian killed; CLOUD worker ${WORKER} LEFT DEPLOYED; both vaults LEFT PAIRED+SYNCED to it.`);
  console.log(lines.join('\n'));
  process.exit(exitCode);
}
