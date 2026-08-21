/**
 * HARDENED-BUILD E2E on the two REAL dogfood vaults (TestVault4 + TestVault5)
 * against the user's live worker http://127.0.0.1:8797 ("two-vault-test").
 *
 *   • Both vaults are ALREADY PAIRED (data.json holds tokens). This script
 *     NEVER pairs — it refreshes the plugin files from the current build,
 *     launches real Obsidian (throwaway profiles, NO --disable-web-security,
 *     no overrides injection), and asserts the EXISTING pairing auto-
 *     reconnects to state 'live' with tokens intact (pairing persistence
 *     across a plugin upgrade).
 *   • Then exercises the new hardening features end-to-end:
 *       S2  X/Y progress  — 30-note burst; capture {phase,done,total}
 *       S3  pause/resume  — vault5 paused must NOT receive an edit; resume
 *                           catches up through reconnect
 *       S4  device rename — plugin renameDevice() → PATCH /device → admin
 *                           /api/status shows the new name only
 *       S5  ignore rules  — "private/**" on vault4: public arrives, private
 *                           stays local AND is absent from worker history
 *       S6  empty-folder tombstoning (the confirmed-gap fix):
 *            a) empty folder placeholder deleted at the source disappears
 *               remotely within ~40s
 *            b) deleting the only FILE of a synced folder must not let the
 *               empty folder resurrect remotely across two rescan cycles
 *       S7  final sanity  — both live/pending 0/conflicts 0, devices online
 *                           with correct names, zero console errors
 *
 * Evidence: scripts/e2e/report-hardened.json + stdout. Exit 0 iff every step
 * passed. TEARDOWN: kills Obsidian, LEAVES the 8797 worker RUNNING (user's
 * live dogfood room) and both vaults paired+synced.
 *
 * Usage: node scripts/e2e/scenario-hardened.mjs
 */

import { execFile, spawn } from 'node:child_process';
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { connectPage, listTargets } from './cdp.mjs';

const execFileP = promisify(execFile);
const HERE = join(fileURLToPath(import.meta.url), '..');

// --- constants ---------------------------------------------------------------------------------

const WORKER = 'http://127.0.0.1:8797'; // ALWAYS 127.0.0.1 (localhost stalls on IPv6 here)
const PASSPHRASE = 'two-vault-test';

const OBSIDIAN_EXE = 'C:\\Program Files\\Obsidian\\Obsidian.exe';
const PLUGIN_PKG = 'Z:/Projects/syncv2/packages/plugin';
const V4_DIR = 'Z:/Projects/TestVaults/TestVault4';
const V5_DIR = 'Z:/Projects/TestVaults/TestVault5';
// Throwaway profiles; EACH registers BOTH vaults (write-profile.mjs pattern),
// first entry open:true per instance.
const PROFILE_A = 'Z:/Projects/TestVaults/e2e-hardened-profile'; // opens TestVault4
const PROFILE_B = 'Z:/Projects/TestVaults/e2e-hardened-profile-b'; // opens TestVault5
const PORT_A = 9222;
const PORT_B = 9223;
const CDP_A = `http://127.0.0.1:${PORT_A}`;
const CDP_B = `http://127.0.0.1:${PORT_B}`;

const DEVICE4 = 'e2e-vault4';
const DEVICE5_OLD = 'e2e-vault5';
const DEVICE5_NEW = 'e2e-vault5-renamed';
const SYNC_TIMEOUT_MS = 25_000;
const BURST_N = 30;
const BURST_PREFIX = 'e2e-h-';
const burstName = (i) => `${BURST_PREFIX}${String(i).padStart(2, '0')}.md`;

const jstr = JSON.stringify;

// --- reporting -----------------------------------------------------------------------------------

const report = {
  startedAt: new Date().toISOString(),
  worker: WORKER,
  cleanMode: { webSecurityDisabled: false, overridesInjected: false, pairFromSettingsCalled: false },
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

/** Run a step body once; on throw, retry once (evidence rule), then give up. */
async function withRetry(fn) {
  try {
    return { ok: true, result: await fn(false) };
  } catch (first) {
    log(`  retry-after-error: ${String(first.message ?? first).slice(0, 300)}`);
    return { ok: false, error: first, result: await fn(true) };
  }
}

// --- worker HTTP -----------------------------------------------------------------------------------

async function wk(path, init = {}) {
  const res = await fetch(`${WORKER}${path}`, { signal: AbortSignal.timeout(10_000), ...init });
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
async function pluginStatus(cdp) {
  const r = await cdp.eval(`(() => { const p = app.plugins?.plugins?.vaultsyncforagents; if (!p) return null;
    return { statusBar: p.statusBarItem?.textContent ?? null, status: p.client?.status?.() ?? null,
      url: p.data?.url ?? null, deviceId: p.data?.deviceId ?? null, tokenLen: (p.data?.token || '').length,
      deviceName: p.data?.deviceName ?? null, paused: !!p.syncingPaused, hasClient: !!p.client,
      overridesFetch: typeof p.overrides?.fetchImpl }; })()`);
  if (!r.ok) throw new Error(`pluginStatus eval: ${r.error}`);
  return r.value;
}
async function conflictFiles(cdp) {
  const r = await cdp.eval(`app.vault.getFiles().filter(f => /conflict/i.test(f.path)).map(f => f.path)`);
  if (!r.ok) throw new Error(`conflictFiles eval: ${r.error}`);
  return r.value;
}
async function syncNow(cdp) {
  return cdp.eval(`(async()=>{ const p = app.plugins?.plugins?.vaultsyncforagents; if (!p?.syncNow) return 'no-plugin'; await p.syncNow(); return 'synced'; })()`);
}
/** Poll vault `cdp` until `path` exists with exact text content `want`. Returns latency. */
async function awaitNoteArrival(cdp, path, want, timeoutMs = SYNC_TIMEOUT_MS) {
  const r = await waitFor(async () => {
    if (!(await exists(cdp, path))) return null;
    return (await readTextOrNull(cdp, path)) === want ? true : null;
  }, timeoutMs, 400, `arrival ${path}`);
  return r.elapsedMs;
}

// --- in-page X/Y progress capture --------------------------------------------------------------------------------
// The brief suggests ~100 ms polling, but run-1 showed the final {done>=total}
// frame lives <50 ms before runCycle's `finally` clears `progress` — a 50 ms
// sampler missed it. So: a tight in-page poller (3 ms) started BEFORE the
// stimulus; it settles on `quietMs` of capture silence (progress back to null)
// or a no-progress give-up window, whichever comes first.

async function progressCaptureStart(cdp, { quietMs = 800, giveUpMs = 15_000, hardCapMs = 90_000 } = {}) {
  // Fire (do NOT await) — resolves once the sync window has settled.
  const r = await cdp.eval(`(async () => {
    const out = []; let lastCap = 0; const t0 = Date.now();
    for (;;) {
      const pr = app.plugins?.plugins?.vaultsyncforagents?.client?.status?.()?.progress ?? null;
      if (pr) { out.push({ t: Date.now(), ...pr }); lastCap = Date.now(); }
      if (out.length > 0 && pr === null && Date.now() - lastCap > ${quietMs}) break;
      if (out.length > 0 && Date.now() - t0 > ${hardCapMs}) break;
      if (out.length === 0 && Date.now() - t0 > ${giveUpMs}) break;
      await new Promise((r2) => setTimeout(r2, 3));
    }
    return out;
  })()`);
  if (!r.ok) throw new Error(`progress capture: ${r.error}`);
  return r.value;
}
function summarizeProgress(captures) {
  const maxTotal = captures.reduce((m, c) => Math.max(m, c.total), 0);
  const complete = captures.filter((c) => c.done >= c.total);
  const phases = [...new Set(captures.map((c) => c.phase))];
  const last = captures[captures.length - 1] ?? null;
  return { captures, count: captures.length, phases, maxTotal, completeSeen: complete.length > 0, lastComplete: complete[complete.length - 1] ?? null, last };
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
        } catch {
          /* no page yet */
        }
        return null;
      }
    }
    dialogsClicked.push(...(await driveFirstRunDialogs(cdp)));
    const probe = await cdp.eval('!!(app.plugins?.plugins?.vaultsyncforagents)');
    return probe.ok && probe.value === true;
  }, 120_000, 1500, `${label}: plugin loaded`);

  return { cdp, dialogsClicked: [...new Set(dialogsClicked)], readyMs: Date.now() - t0 };
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
function errorLevelEntries(cdps) {
  const hits = [];
  for (const [name, cdp] of Object.entries(cdps)) {
    if (!cdp) continue;
    for (const entry of cdp.consoleLog) {
      if (String(entry.level).toLowerCase() === 'error') hits.push({ vault: name, ...entry });
    }
  }
  return hits;
}

// --- main ----------------------------------------------------------------------------------------------

let cookie = null;
let cdp4 = null;
let cdp5 = null;
let exitCode = 0;
const prePairing = {}; // vault -> {deviceId, tokenLen, deviceName} read from data.json BEFORE launch

process.on('uncaughtException', (e) => {
  lines.push(`[FATAL-uncaught] ${String(e?.stack ?? e)}`);
  report.fatal = String(e?.message ?? e);
});

try {
  // ---- prep: kill Obsidian, health check, refresh plugin build into both vaults, write profiles ----
  {
    const s = step('prep', 'kill Obsidian; /health; refresh plugin main.js/manifest/styles into BOTH vaults; write throwaway dual-vault profiles');
    try {
      await execFileP('taskkill', ['/F', '/IM', 'Obsidian.exe']).catch(() => {});
      await sleep(1500);
      const health = await wk('/health');
      if (health.status !== 200 || health.body.ok !== true) throw new Error(`unexpected /health: ${fmt(health.body)}`);
      // Refresh both installs from the CURRENT build (plugin upgrade under existing pairing).
      const refreshed = {};
      for (const [v, dir] of [['TestVault4', V4_DIR], ['TestVault5', V5_DIR]]) {
        const dest = `${dir}/.obsidian/plugins/vaultsyncforagents`;
        for (const f of ['main.js', 'manifest.json', 'styles.css']) copyFileSync(join(PLUGIN_PKG, f), join(dest, f));
        const d = JSON.parse(readFileSync(`${dest}/data.json`, 'utf8'));
        prePairing[v] = { deviceId: d.deviceId, tokenLen: (d.token || '').length, deviceName: d.deviceName, url: d.url };
        refreshed[v] = { copied: ['main.js', 'manifest.json', 'styles.css'], pairing: prePairing[v] };
      }
      if (prePairing.TestVault4.url !== WORKER || prePairing.TestVault5.url !== WORKER) {
        throw new Error('vault data.json url mismatch — not pointed at the 8797 worker');
      }
      const { stdout: pa } = await execFileP(process.execPath, [join(HERE, 'write-profile.mjs'), PROFILE_A, V4_DIR, V5_DIR]);
      const { stdout: pb } = await execFileP(process.execPath, [join(HERE, 'write-profile.mjs'), PROFILE_B, V5_DIR, V4_DIR]);
      s.pass({
        health: health.body,
        pluginRefresh: refreshed,
        profileA: pa.trim(),
        profileB: pb.trim(),
        cdpPorts: { vault4: PORT_A, vault5: PORT_B },
        launchFlags: ['--user-data-dir=…', '--remote-debugging-port=…', 'NO --disable-web-security'],
      });
    } catch (e) {
      s.fail(String(e.message ?? e));
      throw e; // nothing can run without prep
    }
  }

  // ---- S1: launch both instances; EXISTING pairing auto-reconnects; tokens intact; both online ----
  {
    const s = step('S1', 'launch both instances (NO pairFromSettings) — existing pairing auto-reconnects: state live, tokens intact, vsa ✓, both devices online');
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

      const live = {};
      for (const [name, cdp, ready, pre] of [
        ['vault4', cdp4, a, prePairing.TestVault4],
        ['vault5', cdp5, b, prePairing.TestVault5],
      ]) {
        const st = await waitFor(async () => {
          const ps = await pluginStatus(cdp);
          return ps?.statusBar?.startsWith('vsa ✓') && ps?.status?.state === 'live' ? ps : null;
        }, 45_000, 1000, `${name} live+✓`);
        const bad = [];
        if (st.value.deviceId !== pre.deviceId) bad.push(`deviceId changed: ${st.value.deviceId} != ${pre.deviceId}`);
        if (st.value.tokenLen !== pre.tokenLen) bad.push(`tokenLen changed: ${st.value.tokenLen} != ${pre.tokenLen}`);
        if (st.value.overridesFetch !== 'undefined') bad.push(`overrides.fetchImpl set (${st.value.overridesFetch})`);
        if (bad.length) throw new Error(`${name}: ${bad.join('; ')}`);
        live[name] = { statusBar: st.value.statusBar, state: st.value.status.state, deviceId: st.value.deviceId, tokenLen: st.value.tokenLen, readyMs: ready.readyMs, dialogs: ready.dialogsClicked };
      }
      const cors = fatalConsoleHits({ vault4: cdp4, vault5: cdp5 });
      if (cors.length > 0) throw new Error(`CORS/Illegal-invocation console hits: ${fmt(cors.slice(0, 3))}`);
      cookie = await adminLogin();
      const st = await waitFor(async () => {
        const res = await wk('/api/status', { headers: { cookie } });
        const devs = res.body?.devices ?? [];
        const online = devs.filter((d) => d.online).map((d) => d.name);
        return online.includes(DEVICE4) && online.includes(DEVICE5_OLD) ? devs : null;
      }, 30_000, 1000, 'both devices online');
      s.pass({
        headline: 'PAIRING PERSISTED ACROSS PLUGIN UPGRADE — both clients auto-reconnected live with untouched tokens',
        pids: { vault4: pidA, vault5: pidB },
        vaults: live,
        devicesOnline: st.value.filter((d) => d.online).map((d) => d.name),
      });
    } catch (e) {
      s.fail(String(e.message ?? e));
      throw e; // everything below depends on both live clients
    }
  }

  // ---- S2: X/Y PROGRESS — 30-note burst in vault4, capture progress, assert arrival in vault5 ----
  {
    const s = step('S2', `X/Y progress: burst of ${BURST_N} notes in vault4 (loop app.vault.create); capture {phase,done,total}; all arrive byte-identical in vault5`);
    const runOnce = async () => {
      await progressRecorderStart(cdp4);
      await progressRecorderStart(cdp5); // bonus: observe vault5's pulling phase
      const contents = {};
      const made = await cdp4.eval(`(async () => {
        const made = [];
        for (let i = 1; i <= ${BURST_N}; i++) {
          const name = ${jstr(BURST_PREFIX)} + String(i).padStart(2, '0') + '.md';
          const text = 'burst note ' + i + ' @ ' + Date.now() + ' nonce=' + Math.random().toString(36).slice(2, 8);
          try { await app.vault.create(name, text); }
          catch (e) {
            const f = app.vault.getAbstractFileByPath(name);
            if (!f) throw e;
            await app.vault.modify(f, text); // retry-safety: file left over from a failed attempt
          }
          made.push([name, text]);
        }
        return made; })()`);
      if (!made.ok) throw new Error(`burst create: ${made.error}`);
      for (const [n, t] of made.value) contents[n] = t;
      const createEnd = Date.now();

      // all 30 must arrive in vault5
      const arrival = await waitFor(async () => {
        const missing = await cdp5.eval(`(async () => {
          const missing = [];
          for (let i = 1; i <= ${BURST_N}; i++) {
            const p = ${jstr(BURST_PREFIX)} + String(i).padStart(2, '0') + '.md';
            if (!(await app.vault.adapter.exists(p))) missing.push(p);
          }
          return missing; })()`);
        const v = r_ok(missing);
        return Array.isArray(v) && v.length === 0 ? true : null;
      }, 45_000, 500, '30 burst notes arrive in vault5');

      // byte-identical spot-check 3 of them
      const spot = {};
      for (const i of [1, 15, 30]) {
        const n = burstName(i);
        const [t4, t5] = await Promise.all([readTextOrNull(cdp4, n), readTextOrNull(cdp5, n)]);
        spot[n] = { identical: t4 === contents[n] && t5 === contents[n], len: (t5 ?? '').length };
        if (t5 !== contents[n]) throw new Error(`spot-check mismatch ${n}: v4=${fmt(t4?.slice(0, 60))} v5=${fmt(t5?.slice(0, 60))}`);
      }

      await sleep(1500); // let any trailing cycle frame land before stopping the recorders
      const cap4 = summarizeProgress(await progressRecorderStop(cdp4));
      const cap5 = summarizeProgress(await progressRecorderStop(cdp5));
      report.progress = { vault4: cap4, vault5: cap5 };

      const problems = [];
      if (cap4.count === 0) problems.push('vault4: NO progress object captured');
      if (cap4.maxTotal < BURST_N) problems.push(`vault4: max observed total ${cap4.maxTotal} < ${BURST_N}`);
      if (!cap4.completeSeen) problems.push('vault4: never captured done >= total');
      return {
        evidencePath: 'live watcher burst',
        latencyAllArrivedMs: Date.now() - createEnd,
        spotChecks: spot,
        vault4Progress: { count: cap4.count, phases: cap4.phases, maxTotal: cap4.maxTotal, completeSeen: cap4.completeSeen, lastComplete: cap4.lastComplete, capturesHead: cap4.captures.slice(0, 6), capturesTail: cap4.captures.slice(-6) },
        vault5Progress: { count: cap5.count, phases: cap5.phases, maxTotal: cap5.maxTotal, completeSeen: cap5.completeSeen, lastComplete: cap5.lastComplete },
        ...(problems.length ? { softProblems: problems } : {}),
        _problems: problems,
      };
    };
    const r = await withRetry(runOnce);
    if (!r.ok) {
      s.fail(String(r.error?.message ?? r.error));
    } else {
      const { _problems, ...detail } = r.result;
      if (_problems.length === 0) {
        s.pass(detail);
      } else {
        // Live burst split into multiple cycles (watcher debounce fired mid-loop)?
        // Deterministic fallback: pause vault4, modify the SAME 30 notes, resume —
        // the startup-reconciliation cycle must push all 30 in ONE cycle.
        decide(`S2 live burst did not show total>=${BURST_N} (${_problems.join('; ')}) — running deterministic fallback: pause vault4, edit the same 30 notes, resume so one catch-up cycle carries them`);
        try {
          await progressRecorderStart(cdp4);
          const pauseRes = await cdp4.eval(`(async () => {
            const p = app.plugins.plugins.vaultsyncforagents;
            p.pauseSyncing();
            for (let i = 1; i <= ${BURST_N}; i++) {
              const f = app.vault.getAbstractFileByPath(${jstr(BURST_PREFIX)} + String(i).padStart(2, '0') + '.md');
              if (f) await app.vault.modify(f, 'burst note ' + i + ' EDIT-FALLBACK @ ' + Date.now());
            }
            await p.resumeSyncing();
            return { pausedWas: p.syncingPaused, state: p.client?.status?.()?.state ?? null }; })()`);
          if (!pauseRes.ok) throw new Error(`fallback pause/edit/resume: ${pauseRes.error}`);
          const fbArrival = await waitFor(async () => {
            const probe = await cdp5.eval(`(async () => {
              let edited = 0;
              for (let i = 1; i <= ${BURST_N}; i++) {
                const t = await app.vault.adapter.read(${jstr(BURST_PREFIX)} + String(i).padStart(2, '0') + '.md').catch(() => '');
                if (t.includes('EDIT-FALLBACK')) edited++;
              }
              return edited; })()`);
            return r_ok(probe) === BURST_N ? true : null;
          }, 45_000, 500, 'fallback edits reach vault5');
          await sleep(1500);
          const cap = summarizeProgress(await progressRecorderStop(cdp4));
          report.progress.fallback = cap;
          const ok = cap.count > 0 && cap.maxTotal >= BURST_N && cap.completeSeen;
          detail.evidencePath = 'pause→edit-30→resume catch-up cycle (live burst split its cycles)';
          detail.fallbackPauseResume = pauseRes.value;
          detail.fallbackLatencyMs = fbArrival.elapsedMs;
          detail.fallbackProgress = { count: cap.count, phases: cap.phases, maxTotal: cap.maxTotal, completeSeen: cap.completeSeen, lastComplete: cap.lastComplete, capturesTail: cap.captures.slice(-8) };
          if (ok) s.pass(detail);
          else s.fail({ ...detail, verdict: `progress feature still not demonstrated: maxTotal=${cap.maxTotal} completeSeen=${cap.completeSeen}` });
        } catch (fb) {
          s.fail({ ...detail, fallbackError: String(fb.message ?? fb) });
        }
      }
    }
  }

  // ---- S3: PAUSE/RESUME — vault5 paused must not receive an edit; resume catches up ----
  {
    const s = step('S3', 'pause vault5 → vault4 edit must NOT arrive (~10s) → resume → edit arrives ≤25s (catch-up through reconnect)');
    const runOnce = async () => {
      // seed a synced probe note
      const c1 = `pause-probe v1 ${Date.now()}`;
      const created = await cdp4.eval(`app.vault.create('pause-probe.md', ${jstr(c1)}).then(() => 'created').catch(e => String(e))`);
      if (!created.ok || created.value !== 'created') {
        // retry-safe: maybe left over from a failed attempt — overwrite instead
        const mod = await cdp4.eval(`app.vault.modify(app.vault.getAbstractFileByPath('pause-probe.md'), ${jstr(c1)}).then(() => 'modified')`);
        if (!mod.ok) throw new Error(`seed create: ${created.error ?? created.value} / ${mod.error ?? ''}`);
      }
      await awaitNoteArrival(cdp5, 'pause-probe.md', c1);

      // PAUSE vault5 via the plugin's own control
      const paused = await cdp5.eval(`(() => { const p = app.plugins.plugins.vaultsyncforagents;
        p.pauseSyncing();
        return { paused: p.syncingPaused, hasClient: !!p.client, statusBar: p.statusBarItem?.textContent ?? null }; })()`);
      if (!paused.ok) throw new Error(`pauseSyncing: ${paused.error}`);
      if (paused.value.paused !== true || paused.value.hasClient !== false) {
        throw new Error(`pause state wrong: ${fmt(paused.value)}`);
      }
      log(`  vault5 paused: statusBar=${jstr(paused.value.statusBar)} hasClient=${paused.value.hasClient}`);

      // edit in vault4 while vault5 is paused
      const c2 = `pause-probe v2 EDIT-WHILE-PAUSED ${Date.now()}`;
      const mod = await cdp4.eval(`app.vault.modify(app.vault.getAbstractFileByPath('pause-probe.md'), ${jstr(c2)}).then(() => 'modified')`);
      if (!mod.ok) throw new Error(`edit while paused: ${mod.error}`);

      // ~10s: vault5 must keep the OLD content
      const samples = [];
      for (let i = 0; i < 5; i++) {
        await sleep(2000);
        const t = await readTextOrNull(cdp5, 'pause-probe.md');
        samples.push({ t_s: (i + 1) * 2, content: t === c1 ? 'v1(unchanged)' : t === c2 ? 'v2(RECEIVED!)' : 'other' });
        if (t === c2) throw new Error(`vault5 RECEIVED the edit while paused (at t≈${(i + 1) * 2}s) — pause does not hold`);
      }

      // RESUME and expect catch-up ≤25s
      const resumeT0 = Date.now();
      const resumed = await cdp5.eval(`(async () => { const p = app.plugins.plugins.vaultsyncforagents;
        await p.resumeSyncing();
        return { paused: p.syncingPaused, hasClient: !!p.client, state: p.client?.status?.()?.state ?? null,
          statusBar: p.statusBarItem?.textContent ?? null }; })()`);
      if (!resumed.ok) throw new Error(`resumeSyncing: ${resumed.error}`);
      const arrived = await waitFor(async () => ((await readTextOrNull(cdp5, 'pause-probe.md')) === c2 ? true : null), SYNC_TIMEOUT_MS, 400, 'catch-up after resume');
      const sb = await waitFor(async () => {
        const ps = await pluginStatus(cdp5);
        return ps?.statusBar?.startsWith('vsa ✓') && ps?.status?.state === 'live' ? ps.statusBar : null;
      }, 30_000, 1000, 'vault5 ✓ again');
      return {
        pausedUi: paused.value,
        whilePausedSamples: samples,
        resumeState: resumed.value,
        catchUpLatencyMs: arrived.elapsedMs,
        totalPausedMs: Date.now() - resumeT0 + 10_000 /*approx*/,
        statusBarAfter: sb.value,
      };
    };
    const r = await withRetry(runOnce);
    if (r.ok) s.pass(r.result);
    else s.fail(String(r.error?.message ?? r.error));
  }

  // ---- S4: DEVICE RENAME — vault5 renameDevice → PATCH /device → admin sees new name only ----
  {
    const s = step('S4', `rename vault5 device "${DEVICE5_OLD}" → "${DEVICE5_NEW}" via plugin renameDevice (PATCH /device); admin /api/status lists new name, old gone`);
    const runOnce = async () => {
      const ren = await cdp5.eval(`(async () => { const p = app.plugins.plugins.vaultsyncforagents;
        const ok = await p.renameDevice(${jstr(DEVICE5_NEW)});
        return { ok, deviceName: p.data.deviceName }; })()`);
      if (!ren.ok) throw new Error(`renameDevice eval: ${ren.error}`);
      if (ren.value.ok !== true || ren.value.deviceName !== DEVICE5_NEW) {
        throw new Error(`rename outcome: ${fmt(ren.value)}`);
      }
      const st = await waitFor(async () => {
        const res = await wk('/api/status', { headers: { cookie } });
        const names = (res.body?.devices ?? []).map((d) => d.name);
        return names.includes(DEVICE5_NEW) && !names.includes(DEVICE5_OLD) ? res.body.devices : null;
      }, 15_000, 1000, '/api/status reflects rename');
      const marker = await cdp5.eval(`(async () => JSON.parse(await app.vault.adapter.read('.vaultsyncforagents/device.json')).deviceName)()`);
      decide(`device stays renamed to "${DEVICE5_NEW}" after teardown (per brief; old name intentionally gone from the room)`);
      return {
        pluginResult: ren.value,
        markerDeviceName: marker.ok ? marker.value : `unreadable: ${marker.error}`,
        devicesAfter: st.value.map((d) => ({ id: d.id, name: d.name, online: d.online })),
      };
    };
    const r = await withRetry(runOnce);
    if (r.ok) s.pass(r.result);
    else s.fail(String(r.error?.message ?? r.error));
  }

  // ---- S5: IGNORE PATTERNS — "private/**" on vault4 keeps secret local AND out of worker history ----
  {
    const s = step('S5', 'ignore "private/**" on vault4 (applyIgnorePatterns): public-ok.md ARRIVES in vault5; private/secret.md absent ≥15s AND absent from worker history');
    const runOnce = async () => {
      const applied = await cdp4.eval(`(async () => { const p = app.plugins.plugins.vaultsyncforagents;
        await p.applyIgnorePatterns('private/**');
        return { ignorePatterns: p.data.settings.ignorePatterns, state: p.client?.status?.()?.state ?? null }; })()`);
      if (!applied.ok) throw new Error(`applyIgnorePatterns: ${applied.error}`);
      // applyIgnorePatterns restarts the machinery — wait until live again
      await waitFor(async () => {
        const ps = await pluginStatus(cdp4);
        return ps?.status?.state === 'live' && ps?.statusBar?.startsWith('vsa ✓') ? true : null;
      }, 45_000, 1000, 'vault4 live after ignore restart');

      const secretContent = `TOP SECRET ${Date.now()}`;
      const pubContent = `public ok ${Date.now()}`;
      const mk = await cdp4.eval(`(async () => {
        try { await app.vault.createFolder('private'); } catch (e) {}
        const text = ${jstr(secretContent)};
        try { await app.vault.create('private/secret.md', text); }
        catch (e) { const f = app.vault.getAbstractFileByPath('private/secret.md'); if (!f) throw e; await app.vault.modify(f, text); }
        const pub = ${jstr(pubContent)};
        try { await app.vault.create('public-ok.md', pub); }
        catch (e) { const f = app.vault.getAbstractFileByPath('public-ok.md'); if (!f) throw e; await app.vault.modify(f, pub); }
        return 'created'; })()`);
      if (!mk.ok) throw new Error(`create private/public: ${mk.error}`);

      const pubMs = await awaitNoteArrival(cdp5, 'public-ok.md', pubContent);

      // 15s absence window for the secret
      const samples = [];
      for (let i = 0; i < 5; i++) {
        await sleep(3000);
        const present = await exists(cdp5, 'private/secret.md');
        samples.push({ t_s: (i + 1) * 3, secretInVault5: present });
        if (present) throw new Error(`private/secret.md ARRIVED in vault5 at t≈${(i + 1) * 3}s — ignore pattern not honored`);
      }
      const hist = await wk(`/api/history?path=${encodeURIComponent('/private/secret.md')}`, { headers: { cookie } });
      if (hist.status !== 200) throw new Error(`history HTTP ${hist.status}: ${fmt(hist.body)}`);
      const versions = hist.body?.versions;
      if (Array.isArray(versions) && versions.length > 0) {
        throw new Error(`worker history HAS versions for /private/secret.md: ${fmt(versions.slice(0, 2))}`);
      }
      const folderLeak = await exists(cdp5, 'private'); // informational: placeholder may or may not sync

      // cleanup while the ignore is STILL active: remove the secret locally so
      // reverting the pattern later cannot leak it; then restore default config.
      const cleaned = await cdp4.eval(`(async () => {
        try { await app.fileManager.trashFile(app.vault.getAbstractFileByPath('private/secret.md')); } catch (e) {}
        try { await app.vault.adapter.rmdir('private', true); } catch (e) {}
        return 'cleaned'; })()`);
      await cdp4.eval(`(async () => { const p = app.plugins.plugins.vaultsyncforagents; await p.applyIgnorePatterns(''); return p.data.settings.ignorePatterns; })()`);
      await waitFor(async () => {
        const ps = await pluginStatus(cdp4);
        return ps?.status?.state === 'live' ? true : null;
      }, 45_000, 1000, 'vault4 live after ignore revert');
      decide('S5: ignore pattern reverted to "" after assertions (dogfood config restored); secret file was shredded BEFORE the revert so it can never sync');
      return {
        applied: applied.value,
        publicOkLatencyMs: pubMs,
        secretAbsenceSamples: samples,
        workerHistory: { status: hist.status, body: hist.body },
        privateFolderPlaceholderInVault5: folderLeak,
        cleanup: cleaned.value,
        ignoreRevertedTo: '',
      };
    };
    const r = await withRetry(runOnce);
    if (r.ok) s.pass(r.result);
    else s.fail(String(r.error?.message ?? r.error));
  }

  // ---- S6a: EMPTY-FOLDER TOMBSTONING — placeholder deletion propagates ----
  {
    const s = step('S6a', "empty-folder tombstone fix (a): 'tempfolder' placeholder reaches vault5 → delete EMPTY folder in vault4 → placeholder DISAPPEARS from vault5 ≤40s");
    const runOnce = async () => {
      const mk = await cdp4.eval(`app.vault.createFolder('tempfolder').then(() => 'created').catch(async (e) => (await app.vault.adapter.exists('tempfolder')) ? 'created' : String(e))`);
      if (!mk.ok || mk.value !== 'created') throw new Error(`createFolder: ${mk.error ?? mk.value}`);
      let placeholderMs;
      try {
        placeholderMs = await waitFor(async () => ((await exists(cdp5, 'tempfolder')) ? true : null), 35_000, 1000, 'placeholder reaches vault5').then((x) => x.elapsedMs);
      } catch {
        await syncNow(cdp4);
        placeholderMs = await waitFor(async () => ((await exists(cdp5, 'tempfolder')) ? true : null), 35_000, 1000, 'placeholder reaches vault5 after poke').then((x) => x.elapsedMs);
        log('  (placeholder needed a syncNow poke)');
      }
      await sleep(3000); // settle the placeholder push

      // delete the EMPTY folder — trashFile fires real delete events; rmdir fallback
      const del = await cdp4.eval(`(async () => {
        const f = app.vault.getAbstractFileByPath('tempfolder');
        if (!f) return 'missing';
        try { await app.fileManager.trashFile(f); return 'fileManager.trashFile'; }
        catch (e) { await app.vault.adapter.rmdir('tempfolder', false); return 'adapter.rmdir'; } })()`);
      if (!del.ok) throw new Error(`folder delete: ${del.error}`);

      let gone = false;
      let goneMs = null;
      try {
        const w = await waitFor(async () => ((await exists(cdp5, 'tempfolder')) ? null : 'gone'), 40_000, 1000, 'vault5 drops tempfolder');
        gone = true;
        goneMs = w.elapsedMs;
      } catch {
        /* stayed */
      }
      const v4Still = await exists(cdp4, 'tempfolder');
      if (!gone) throw new Error(`tempfolder placeholder STILL PRESENT in vault5 after 40s (deleteMethod=${del.value}, v4StillHasIt=${v4Still}) — tombstone fix NOT working`);
      return { placeholderSyncMs: placeholderMs, deleteMethodUsed: del.value, vault5DisappearanceMs: goneMs, vault4GoneToo: !v4Still };
    };
    const r = await withRetry(runOnce);
    if (r.ok) s.pass(r.result);
    else s.fail(String(r.error?.message ?? r.error));
  }

  // ---- S6b: resurrect guard — deleting the only FILE must not leave/re-create the empty folder ----
  {
    const s = step('S6b', "empty-folder tombstone fix (b): 'resurrect/keep.md' synced; delete FILE in vault4 → file gone in vault5 AND empty 'resurrect' does NOT resurrect across 40s (two rescan cycles)");
    const runOnce = async () => {
      const content = `keep me ${Date.now()}`;
      const mk = await cdp5.eval(`(async () => {
        try { await app.vault.createFolder('resurrect'); } catch (e) {}
        await app.vault.create('resurrect/keep.md', ${jstr(content)});
        return 'created'; })()`);
      if (!mk.ok) throw new Error(`create resurrect/keep.md in vault5: ${mk.error}`);
      let toV4Ms;
      try {
        toV4Ms = await awaitNoteArrival(cdp4, 'resurrect/keep.md', content, 35_000);
      } catch {
        await syncNow(cdp5);
        toV4Ms = await awaitNoteArrival(cdp4, 'resurrect/keep.md', content, 35_000);
        log('  (needed a syncNow poke)');
      }
      await sleep(3000); // settle

      const del = await cdp4.eval(`app.vault.delete(app.vault.getAbstractFileByPath('resurrect/keep.md')).then(() => 'deleted')`);
      if (!del.ok) throw new Error(`delete keep.md in vault4: ${del.error}`);
      const fileGoneMs = await waitFor(async () => ((await exists(cdp5, 'resurrect/keep.md')) ? null : 'gone'), SYNC_TIMEOUT_MS, 400, 'vault5 drops keep.md').then((x) => x.elapsedMs);

      // watch the empty folder across ≥40s (rescanIntervalSec=30 → two cycles)
      const samples = [];
      for (let i = 0; i <= 8; i++) {
        const [f5, d5, f4] = await Promise.all([exists(cdp5, 'resurrect'), exists(cdp5, 'resurrect/keep.md'), exists(cdp4, 'resurrect')]);
        samples.push({ t_s: i * 5, v5Folder: f5, v5File: d5, v4Folder: f4 });
        if (i < 8) await sleep(5000);
      }
      const last = samples[samples.length - 1];
      if (last.v5File) throw new Error('keep.md REAPPEARED in vault5');
      if (last.v5Folder) {
        throw new Error(`empty 'resurrect' folder RESURRECTED in vault5 and stayed ≥40s: ${fmt(samples)}`);
      }
      return {
        v5toV4SyncMs: toV4Ms,
        fileGoneInV5Ms: fileGoneMs,
        folderObservation: samples,
        verdict: 'file deleted remotely AND empty folder never resurrected across two rescan cycles',
      };
    };
    const r = await withRetry(runOnce);
    if (r.ok) s.pass(r.result);
    else s.fail(String(r.error?.message ?? r.error));
  }

  // ---- S7: FINAL SANITY ----
  {
    const s = step('S7', 'final sanity: both plugins live/pending 0/conflicts 0; /api/status shows e2e-vault4 + e2e-vault5-renamed online; zero console errors');
    try {
      await sleep(3000); // settle
      const [p4, p5] = await Promise.all([pluginStatus(cdp4), pluginStatus(cdp5)]);
      const [c4, c5] = await Promise.all([conflictFiles(cdp4), conflictFiles(cdp5)]);
      const bad = [];
      for (const [name, st] of [['vault4', p4], ['vault5', p5]]) {
        if (st?.status?.state !== 'live') bad.push(`${name} state=${st?.status?.state}`);
        if (st?.status?.pending !== 0) bad.push(`${name} pending=${st?.status?.pending}`);
        if ((st?.status?.conflicts ?? []).length !== 0) bad.push(`${name} conflicts=${fmt(st?.status?.conflicts)}`);
        if (!st?.statusBar?.startsWith('vsa ✓')) bad.push(`${name} statusBar=${st?.statusBar}`);
      }
      if (c4.length || c5.length) bad.push(`conflict files: v4=${fmt(c4)} v5=${fmt(c5)}`);
      const fatal = fatalConsoleHits({ vault4: cdp4, vault5: cdp5 });
      if (fatal.length) bad.push(`fatal console patterns: ${fmt(fatal.slice(0, 3))}`);
      const errs = errorLevelEntries({ vault4: cdp4, vault5: cdp5 });
      if (errs.length) bad.push(`${errs.length} console error-level entries`);
      const st = await wk('/api/status', { headers: { cookie } });
      const devs = st.body?.devices ?? [];
      const byName = Object.fromEntries(devs.map((d) => [d.name, d]));
      if (!byName[DEVICE4]?.online) bad.push(`${DEVICE4} not online`);
      if (!byName[DEVICE5_NEW]?.online) bad.push(`${DEVICE5_NEW} not online`);
      if (byName[DEVICE5_OLD]) bad.push(`old name ${DEVICE5_OLD} still listed`);
      if (bad.length) throw new Error(bad.join('; '));
      report.finalWorkerStatus = st.body;
      s.pass({
        vault4: { state: p4.status.state, pending: p4.status.pending, statusBar: p4.statusBar, lastSyncAt: p4.status.lastSyncAt },
        vault5: { state: p5.status.state, pending: p5.status.pending, statusBar: p5.statusBar, lastSyncAt: p5.status.lastSyncAt },
        conflictFiles: { vault4: c4, vault5: c5 },
        devices: devs.map((d) => ({ name: d.name, online: d.online, revoked: d.revoked })),
        consoleErrorEntries: 0,
      });
    } catch (e) {
      s.fail(String(e.message ?? e));
    }
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
  // worker PID(s) listening on 8797 (worker LEFT RUNNING)
  try {
    const { stdout } = await execFileP('netstat', ['-ano']).catch(() => ({ stdout: '' }));
    const pids = [...new Set(stdout.split('\n').filter((l) => /:8797\s/.test(l) && /LISTENING/i.test(l)).map((l) => l.trim().split(/\s+/).pop()))];
    report.workerLeftRunning = { url: WORKER, listeningPids: pids, note: 'wrangler dev --port 8797 --persist-to .wrangler/devstate-testvault (user dogfood room) — LEFT RUNNING' };
  } catch {
    report.workerLeftRunning = { url: WORKER, note: 'left running (PID capture failed)' };
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
    writeFileSync(join(HERE, 'report-hardened.json'), JSON.stringify(report, null, 2));
  } catch {
    /* best effort */
  }
  cdp4?.close();
  cdp5?.close();
  // TEARDOWN: kill Obsidian; LEAVE the 8797 worker RUNNING; vaults stay paired+synced.
  await execFileP('taskkill', ['/F', '/IM', 'Obsidian.exe']).catch(() => {});
  lines.push('TEARDOWN: Obsidian killed; worker 8797 LEFT RUNNING; both vaults LEFT PAIRED+SYNCED.');
  console.log(lines.join('\n'));
  process.exit(exitCode);
}

/** tiny helper: unwrap a cdp.eval result value or null */
function r_ok(r) {
  return r && r.ok ? r.value : null;
}
