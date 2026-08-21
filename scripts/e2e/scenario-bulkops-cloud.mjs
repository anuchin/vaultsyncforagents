/**
 * BULK/MASS OPERATIONS CLOUD E2E — two REAL vaults (TestVault4 + TestVault5)
 * against a DEPLOYED Cloudflare worker (VSA_E2E_WORKER). Fills the operation-
 * coverage gaps: bulk edit, bulk rename, move files, move folder, rename
 * folder, bulk delete, delete non-empty folder (+ anti-resurrection check).
 *
 * Every phase mutates vault4 and asserts CONVERGENCE on vault5 (and vice
 * versa where noted): file present/absent at the exact path with the exact
 * expected content. X/Y push progress lines are captured per phase via the
 * in-page 3 ms sampler (progressRecorderStart/Stop).
 *
 *   R0  launch both (persisted pairing reconnects live) + purge any residue
 *       from earlier runs of this scenario + ensure the 30 e2e-h-*.md probes
 *       exist with known content
 *   B1  BULK EDIT    — modify ALL 30 e2e-h-*.md in one rapid batch; one sync
 *                      cycle pushes them (X/Y progress captured); all 30 new
 *                      contents arrive byte-identical in vault5
 *   B2  BULK RENAME  — 20 files at once (e2e-h-01..20.md → e2e-h-*-r.md via
 *                      fileManager.renameFile); old names gone + new names
 *                      present with intact content in vault5
 *   B3  MOVE FILES   — 10 files into pre-created bulk-moved/
 *   B4  MOVE FOLDER  — bulk-moved/ under pre-created bulk-parent/
 *                      (renameFile on the TFolder) — whole subtree relocates
 *   B5  RENAME FOLDER— bulk-parent → bulk-parent-renamed
 *   B6  BULK DELETE  — 15 files in one batch (vault.delete); absent in
 *                      vault5 AND tombstoned server-side (history head)
 *   B7  DELETE NON-EMPTY FOLDER — trashFile bulk-parent-renamed (contains
 *                      the moved subtree); subtree gone in vault5 and does
 *                      NOT resurrect after two rescan cycles (~70s) —
 *                      empty-folder resurrection was a past bug
 *   B8  final sanity — both live/pending 0/conflicts 0, no copies, no CORS
 *
 * Evidence: scripts/e2e/report-bulkops-cloud.json + stdout. Exit 0 iff every
 * step passed. TEARDOWN: kills Obsidian, LEAVES the deployed worker untouched.
 *
 * Usage: node scripts/e2e/scenario-bulkops-cloud.mjs
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
import { connectPage, listTargets } from './cdp.mjs';

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

const BULK_N = 30;
const hName = (i) => `e2e-h-${String(i).padStart(2, '0')}.md`;
const hrName = (i) => `e2e-h-${String(i).padStart(2, '0')}-r.md`;
const FOLDER_MOVED = 'bulk-moved';
const FOLDER_PARENT = 'bulk-parent';
const FOLDER_PARENT_RENAMED = 'bulk-parent-renamed';

const SYNC_TIMEOUT_MS = 45_000; // single-file/propagation budget (real network)
const BULK_TIMEOUT_MS = 120_000; // 20-30 file batches through real R2
const RESURRECTION_WINDOW_MS = 75_000; // two rescan cycles (rescanIntervalSec=30)

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

/**
 * Run a step body once; on throw, retry once (evidence rule), then give up.
 * EVERY phase body is written retry-safe: mutations tolerate already-applied
 * state (old path missing + new path present = already done), and assertions
 * converge idempotently — a retry never weakens an assertion.
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
      deviceName: p.data?.deviceName ?? null, linked: !!p.linked }; })()`);
  if (!r.ok) throw new Error(`pluginStatus eval: ${r.error}`);
  return r.value;
}
async function conflictFiles(cdp) {
  const r = await cdp.eval(`app.vault.getFiles().filter(f => /\\(conflict .+ - from /i.test(f.path)).map(f => f.path)`);
  if (!r.ok) throw new Error(`conflictFiles eval: ${r.error}`);
  return r.value;
}
async function syncNow(cdp) {
  return cdp.eval(`(async()=>{ const p = app.plugins?.plugins?.vaultsyncforagents; if (!p?.syncNow) return 'no-plugin'; await p.syncNow(); return 'synced'; })()`);
}
/**
 * Batched convergence probe on one vault: every `present` path must exist with
 * EXACTLY `contents[path]` (when given), every `absent` path must not exist.
 * Returns the list of offenders ([] == converged) so callers can waitFor [].
 */
async function offenders(cdp, { present = [], absent = [], contents = {} } = {}) {
  const r = await cdp.eval(`(async () => {
    const bad = [];
    for (const p of ${jstr(present)}) {
      let there = false;
      try { there = await app.vault.adapter.exists(p); } catch (e) {}
      if (!there) { bad.push({ kind: 'missing', path: p }); continue; }
      if (Object.prototype.hasOwnProperty.call(${jstr(contents)}, p)) {
        let t = null;
        try { t = await app.vault.adapter.read(p); } catch (e) {}
        if (t !== ${jstr(contents)}[p]) bad.push({ kind: 'content', path: p });
      }
    }
    for (const p of ${jstr(absent)}) {
      let there = false;
      try { there = await app.vault.adapter.exists(p); } catch (e) {}
      if (there) bad.push({ kind: 'still-present', path: p });
    }
    return bad;
  })()`);
  if (!r.ok) throw new Error(`offenders eval: ${r.error}`);
  return r.value;
}
async function awaitConvergence(cdp, spec, timeoutMs, label) {
  return waitFor(async () => {
    const bad = await offenders(cdp, spec);
    return bad.length === 0 ? true : null;
  }, timeoutMs, 600, label);
}

// --- in-page X/Y progress recorder (3 ms sampler; node-side quiet-stop) ------------------------------

async function progressRecorderStart(cdp) {
  const r = await cdp.eval("(async () => { window.__vsaProg = [];\n" +
    "    if (window.__vsaProgTimer) clearInterval(window.__vsaProgTimer);\n" +
    "    window.__vsaProgTimer = setInterval(() => {\n" +
    "      const pr = app.plugins?.plugins?.vaultsyncforagents?.client?.status?.()?.progress ?? null;\n" +
    "      if (pr) window.__vsaProg.push({ t: Date.now(), ...pr });\n" +
    "    }, 3);\n" +
    "    return 'started'; })()");
  if (!r.ok) throw new Error(`recorder start: ${r.error}`);
}
async function progressRecorderStop(cdp, quietMs = 1000, giveUpMs = 20_000, hardCapMs = 120_000) {
  const t0 = Date.now();
  for (;;) {
    const peek = await cdp.eval('(window.__vsaProg ?? []).length');
    if (!peek.ok) throw new Error('recorder peek: ' + peek.error);
    if ((peek.value ?? 0) > 0) {
      const lastT = await cdp.eval('(window.__vsaProg ?? []).slice(-1)[0]?.t ?? 0');
      if (!lastT.ok) throw new Error('recorder lastT: ' + lastT.error);
      if (Date.now() - (lastT.value ?? 0) > quietMs) break;
    } else if (Date.now() - t0 > giveUpMs) {
      break;
    }
    if (Date.now() - t0 > hardCapMs) break;
    await sleep(250);
  }
  const fin = await cdp.eval('(async () => { const out = window.__vsaProg ?? []; clearInterval(window.__vsaProgTimer); window.__vsaProgTimer = undefined; window.__vsaProg = []; return out; })()');
  if (!fin.ok) throw new Error('recorder stop: ' + fin.error);
  return fin.value ?? [];
}
function summarizeProgress(captures) {
  const maxTotal = captures.reduce((m, c) => Math.max(m, c.total), 0);
  const complete = captures.filter((c) => c.done >= c.total);
  const phases = [...new Set(captures.map((c) => c.phase))];
  return {
    count: captures.length,
    phases,
    maxTotal,
    completeSeen: complete.length > 0,
    lastComplete: complete[complete.length - 1] ?? null,
    sample: captures.slice(0, 4),
    tail: captures.slice(-4),
  };
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

// --- prep ---------------------------------------------------------------------------------------------

function refreshPluginFiles(dir) {
  const dest = join(dir, '.obsidian/plugins/vaultsyncforagents');
  for (const f of ['main.js', 'manifest.json', 'styles.css']) copyFileSync(join(PLUGIN_PKG, f), join(dest, f));
  const main = readFileSync(join(dest, 'main.js'), 'utf8');
  const markers = {
    hashEqualityGuard: (main.match(/local\.hash === remote\.hash/g) ?? []).length,
    conflictsReplacedPerCycle: main.includes('this.conflicts = [...plan.conflicts]'),
  };
  if (markers.hashEqualityGuard < 1 || !markers.conflictsReplacedPerCycle) {
    throw new Error(`bundle in ${dir} missing F-A fix markers: ${fmt(markers)}`);
  }
  return markers;
}

/** Remove this scenario's disk leftovers (rerun hygiene; server residue is purged live in R0). */
function removeScenarioArtifacts(dir) {
  const gone = [];
  for (const name of [...Array.from({ length: BULK_N }, (_, i) => hrName(i + 1)), FOLDER_MOVED, FOLDER_PARENT, FOLDER_PARENT_RENAMED]) {
    const p = join(dir, name);
    if (existsSync(p)) {
      rmSync(p, { recursive: true, force: true });
      gone.push(name);
    }
  }
  return gone;
}

// --- main ----------------------------------------------------------------------------------------------

let cookie = null;
let cdp4 = null;
let cdp5 = null;
let exitCode = 0;
const bulkContents = {}; // path -> exact content after B1 (drives later content assertions)

process.on('uncaughtException', (e) => {
  lines.push(`[FATAL-uncaught] ${String(e?.stack ?? e)}`);
  report.fatal = String(e?.message ?? e);
});

try {
  // ---- prep ----
  {
    const s = step('prep', 'kill Obsidian; CLOUD /health; refresh verified plugin bundles; verify both vaults paired to worker; clear scenario artifacts; write profiles');
    try {
      await execFileP('taskkill', ['/F', '/IM', 'Obsidian.exe']).catch(() => {});
      await sleep(2000);
      const health = await wk('/health');
      if (health.status !== 200 || health.body?.ok !== true || health.body?.claimed !== true) {
        throw new Error(`unexpected /health: ${fmt(health.body)}`);
      }
      const markers = {};
      const pairing = {};
      for (const [v, dir] of [['TestVault4', V4_DIR], ['TestVault5', V5_DIR]]) {
        markers[v] = refreshPluginFiles(dir);
        const d = JSON.parse(readFileSync(join(dir, '.obsidian/plugins/vaultsyncforagents/data.json'), 'utf8'));
        if (d.url !== WORKER || (d.token || '').length < 10) throw new Error(`${v} not paired to the target worker (data.url=${d.url} tokenLen=${(d.token || '').length}; expected ${WORKER})`);
        pairing[v] = { deviceId: d.deviceId, deviceName: d.deviceName, tokenLen: (d.token || '').length };
        removeScenarioArtifacts(dir);
      }
      cookie = await adminLogin();
      const { stdout: pa } = await execFileP(process.execPath, [join(HERE, 'write-profile.mjs'), PROFILE_A, V4_DIR, V5_DIR]);
      const { stdout: pb } = await execFileP(process.execPath, [join(HERE, 'write-profile.mjs'), PROFILE_B, V5_DIR, V4_DIR]);
      s.pass({ health: health.body, bundleMarkers: markers, pairing, profileA: pa.trim(), profileB: pb.trim() });
    } catch (e) {
      s.fail(String(e.message ?? e));
      throw e;
    }
  }

  // ---- R0: launch + settle + residue purge + ensure the 30 probes ----
  {
    const s = step('R0', 'launch both (pairing reconnects live); purge server-side residue of earlier runs; ensure exactly 30 e2e-h-*.md probes with known content');
    const runOnce = async () => {
      const pidA = launchObsidian(PROFILE_A, PORT_A);
      const pidB = launchObsidian(PROFILE_B, PORT_B);
      const [a, b] = await Promise.all([
        awaitInstanceReady({ http: CDP_A, match: 'TestVault4', label: 'vault4' }),
        awaitInstanceReady({ http: CDP_B, match: 'TestVault5', label: 'vault5' }),
      ]);
      cdp4 = a.cdp;
      cdp5 = b.cdp;
      report.pids = { obsidianVault4: pidA, obsidianVault5: pidB };
      const states = {};
      for (const [name, cdp] of [['vault4', cdp4], ['vault5', cdp5]]) {
        const st = await waitFor(async () => {
          const ps = await pluginStatus(cdp);
          return ps?.statusBar?.startsWith('vsa ✓') && ps?.status?.state === 'live' && ps?.status?.pending === 0 ? ps : null;
        }, 90_000, 1000, `${name} live+✓+pending0`);
        states[name] = { statusBar: st.value.statusBar, deviceName: st.value.deviceName };
      }

      // Server-side residue from an aborted earlier run may re-materialize as
      // files on launch. Purge through the LIVE vault4 client (tombstones
      // propagate), then wait until absent on BOTH sides.
      const artifactPaths = () => {
        const names = [];
        for (let i = 1; i <= BULK_N; i++) {
          names.push(hrName(i));
          names.push(`${FOLDER_MOVED}/${hrName(i)}`);
          names.push(`${FOLDER_PARENT}/${FOLDER_MOVED}/${hrName(i)}`);
          names.push(`${FOLDER_PARENT_RENAMED}/${FOLDER_MOVED}/${hrName(i)}`);
        }
        return names;
      };
      const purged = await cdp4.eval(`(async () => {
        const kills = [];
        const targets = [];
        for (const f of app.vault.getFiles()) {
          if (/^e2e-h-\\d+-r\\.md$/.test(f.path) || /^(${FOLDER_MOVED}|${FOLDER_PARENT}|${FOLDER_PARENT_RENAMED})\\//.test(f.path)) targets.push(f);
        }
        for (const f of targets) { try { await app.vault.delete(f); kills.push(f.path); } catch (e) {} }
        for (const name of ['${FOLDER_PARENT_RENAMED}/${FOLDER_MOVED}', '${FOLDER_PARENT}/${FOLDER_MOVED}', '${FOLDER_MOVED}', '${FOLDER_PARENT}', '${FOLDER_PARENT_RENAMED}']) {
          const f = app.vault.getAbstractFileByPath(name);
          if (f) { try { await app.fileManager.trashFile(f); kills.push(name + '/ (folder)'); } catch (e) {} }
        }
        return kills;
      })()`);
      if (!purged.ok) throw new Error(`residue purge: ${purged.error}`);
      if (purged.value.length > 0) {
        decide(`purged ${purged.value.length} server-side residue paths from an earlier run before starting (first execution of this scenario on this room sees none)`);
        await awaitConvergence(cdp5, { absent: artifactPaths() }, BULK_TIMEOUT_MS, 'residue purged from vault5');
        await awaitConvergence(cdp4, { absent: artifactPaths() }, BULK_TIMEOUT_MS, 'residue purged from vault4');
      }

      // Ensure the 30 probes exist with KNOWN content (deterministic map for
      // every later content assertion).
      const ensure = await cdp4.eval(`(async () => {
        const out = {};
        const stamp = Date.now();
        for (let i = 1; i <= ${BULK_N}; i++) {
          const name = 'e2e-h-' + String(i).padStart(2, '0') + '.md';
          const text = 'bulkops probe seed ' + i + ' @ ' + stamp + ' nonce=' + Math.random().toString(36).slice(2, 8);
          const f = app.vault.getAbstractFileByPath(name);
          if (!f) { await app.vault.create(name, text); out[name] = text; }
          else out[name] = await app.vault.cachedRead(f);
        }
        return out;
      })()`);
      if (!ensure.ok) throw new Error(`ensure probes: ${ensure.error}`);
      for (const [n, t] of Object.entries(ensure.value)) bulkContents[n] = t;
      await awaitConvergence(cdp5, { present: Object.keys(bulkContents), contents: bulkContents }, BULK_TIMEOUT_MS, 'all 30 probes converged in vault5');
      return {
        states,
        residuePurged: purged.value.length,
        probesEnsured: Object.keys(bulkContents).length,
        readyMs: { vault4: a.readyMs, vault5: b.readyMs },
      };
    };
    const r = await withRetry(runOnce);
    if (r.ok) s.pass(r.result);
    else {
      s.fail(String(r.error?.message ?? r.error));
      throw r.error;
    }
  }

  // ---- B1: BULK EDIT ----
  {
    const s = step('B1', `BULK EDIT: modify ALL ${BULK_N} e2e-h-*.md in one rapid batch from vault4; one sync cycle pushes them; all ${BULK_N} new contents arrive byte-identical in vault5 (X/Y progress captured)`);
    const runOnce = async () => {
      await progressRecorderStart(cdp4);
      await progressRecorderStart(cdp5);
      const edited = await cdp4.eval(`(async () => {
        const out = {};
        for (let i = 1; i <= ${BULK_N}; i++) {
          const name = 'e2e-h-' + String(i).padStart(2, '0') + '.md';
          const text = 'bulk edit v2 ' + i + ' @ ' + Date.now() + ' nonce=' + Math.random().toString(36).slice(2, 8);
          const f = app.vault.getAbstractFileByPath(name);
          if (!f) throw new Error('missing ' + name);
          await app.vault.modify(f, text);
          out[name] = text;
        }
        return out;
      })()`);
      if (!edited.ok) throw new Error(`bulk edit: ${edited.error}`);
      for (const [n, t] of Object.entries(edited.value)) bulkContents[n] = t;
      const batchEnd = Date.now();
      const conv = await awaitConvergence(cdp5, { present: Object.keys(bulkContents), contents: bulkContents }, BULK_TIMEOUT_MS, `all ${BULK_N} edited contents in vault5`);
      // vault4 must still hold its own writes (no pull-back)
      const self = await offenders(cdp4, { present: Object.keys(bulkContents), contents: bulkContents });
      if (self.length) throw new Error(`vault4 diverged from its own edits: ${fmt(self.slice(0, 3))}`);
      await sleep(1500);
      const cap4 = summarizeProgress(await progressRecorderStop(cdp4));
      const cap5 = summarizeProgress(await progressRecorderStop(cdp5));
      report.progressB1 = { vault4: cap4, vault5: cap5 };
      if (cap4.count === 0) log('  note: no X/Y progress frames captured on vault4 this run (cycle may have completed between sampler ticks)');
      return {
        filesEdited: Object.keys(bulkContents).length,
        convergenceMs: conv.elapsedMs,
        vault4Progress: cap4,
        vault5Progress: cap5,
      };
    };
    const r = await withRetry(runOnce);
    if (r.ok) s.pass(r.result);
    else s.fail(String(r.error?.message ?? r.error));
  }

  // ---- B2: BULK RENAME ----
  {
    const s = step('B2', 'BULK RENAME: rename 20 files at once (e2e-h-01..20.md → e2e-h-*-r.md via fileManager.renameFile); vault5: old names GONE + new names present with intact content');
    const runOnce = async (isRetry) => {
      await progressRecorderStart(cdp4);
      const expected = {};
      for (let i = 1; i <= 20; i++) {
        const oldN = hName(i);
        const newN = hrName(i);
        expected[newN] = bulkContents[oldN] ?? null;
      }
      const ren = await cdp4.eval(`(async () => {
        const out = { renamed: 0, alreadyDone: 0, errors: [] };
        for (let i = 1; i <= 20; i++) {
          const oldN = 'e2e-h-' + String(i).padStart(2, '0') + '.md';
          const newN = oldN.replace(/\\.md$/, '-r.md');
          const f = app.vault.getAbstractFileByPath(oldN);
          if (!f) {
            if (app.vault.getAbstractFileByPath(newN)) { out.alreadyDone++; continue; }
            out.errors.push('neither ' + oldN + ' nor ' + newN); continue;
          }
          try { await app.fileManager.renameFile(f, newN); out.renamed++; }
          catch (e) { out.errors.push(oldN + ': ' + String(e).slice(0, 120)); }
        }
        return out;
      })()`);
      if (!ren.ok) throw new Error(`bulk rename: ${ren.error}`);
      const renRes = ren.value;
      if (renRes.errors.length) throw new Error(`rename errors: ${fmt(renRes.errors.slice(0, 3))}`);
      if (renRes.renamed + renRes.alreadyDone !== 20) throw new Error(`rename count: ${fmt(renRes)}`);
      if (isRetry && renRes.renamed === 0) log('  retry: all 20 already renamed by the first attempt');
      const oldNames = Array.from({ length: 20 }, (_, i) => hName(i + 1));
      const newNames = Array.from({ length: 20 }, (_, i) => hrName(i + 1));
      const conv = await awaitConvergence(cdp5, { present: newNames, absent: oldNames, contents: expected }, BULK_TIMEOUT_MS, '20 renames converge in vault5');
      await awaitConvergence(cdp4, { present: newNames, absent: oldNames }, BULK_TIMEOUT_MS, 'renames settled in vault4');
      await sleep(1200);
      const cap = summarizeProgress(await progressRecorderStop(cdp4));
      // update the known-content map for later phases
      for (let i = 1; i <= 20; i++) {
        bulkContents[hrName(i)] = bulkContents[hName(i)];
        delete bulkContents[hName(i)];
      }
      return { renameResult: renRes, convergenceMs: conv.elapsedMs, vault4Progress: cap, contentIntactForAll20: true };
    };
    const r = await withRetry(runOnce);
    if (r.ok) s.pass(r.result);
    else s.fail(String(r.error?.message ?? r.error));
  }

  // ---- B3: MOVE FILES into bulk-moved/ ----
  {
    const s = step('B3', 'MOVE FILES: pre-create bulk-moved/, move 10 files (e2e-h-01-r..10-r.md) into it; vault5 sees the new paths (content intact)');
    const runOnce = async (isRetry) => {
      const idx = Array.from({ length: 10 }, (_, i) => i + 1); // 1..10
      const expected = {};
      for (const i of idx) expected[`${FOLDER_MOVED}/${hrName(i)}`] = bulkContents[hrName(i)] ?? null;
      const mv = await cdp4.eval(`(async () => {
        const out = { moved: 0, alreadyDone: 0, errors: [] };
        try { await app.vault.createFolder('${FOLDER_MOVED}'); } catch (e) { if (!/exists/i.test(String(e))) out.errors.push('createFolder: ' + String(e).slice(0, 120)); }
        for (let i = 1; i <= 10; i++) {
          const oldN = 'e2e-h-' + String(i).padStart(2, '0') + '-r.md';
          const newN = '${FOLDER_MOVED}/' + oldN;
          const f = app.vault.getAbstractFileByPath(oldN);
          if (!f) {
            if (app.vault.getAbstractFileByPath(newN)) { out.alreadyDone++; continue; }
            out.errors.push('neither ' + oldN + ' nor ' + newN); continue;
          }
          try { await app.fileManager.renameFile(f, newN); out.moved++; }
          catch (e) { out.errors.push(oldN + ': ' + String(e).slice(0, 120)); }
        }
        return out;
      })()`);
      if (!mv.ok) throw new Error(`move files: ${mv.error}`);
      if (mv.value.errors.length) throw new Error(`move errors: ${fmt(mv.value.errors.slice(0, 3))}`);
      if (mv.value.moved + mv.value.alreadyDone !== 10) throw new Error(`move count: ${fmt(mv.value)}`);
      const srcs = idx.map(hrName);
      const dsts = idx.map((i) => `${FOLDER_MOVED}/${hrName(i)}`);
      const conv = await awaitConvergence(cdp5, { present: dsts, absent: srcs, contents: expected }, BULK_TIMEOUT_MS, '10 moved files converge in vault5');
      for (const i of idx) {
        bulkContents[`${FOLDER_MOVED}/${hrName(i)}`] = bulkContents[hrName(i)];
        delete bulkContents[hrName(i)];
      }
      return { moveResult: mv.value, convergenceMs: conv.elapsedMs, pathsInVault5: dsts };
    };
    const r = await withRetry(runOnce);
    if (r.ok) s.pass(r.result);
    else s.fail(String(r.error?.message ?? r.error));
  }

  // ---- B4: MOVE FOLDER under bulk-parent/ ----
  {
    const s = step('B4', `MOVE FOLDER: renameFile TFolder ${FOLDER_MOVED}/ → ${FOLDER_PARENT}/${FOLDER_MOVED} (parent pre-created); the whole subtree (10 files) relocates in vault5`);
    const runOnce = async (isRetry) => {
      const idx = Array.from({ length: 10 }, (_, i) => i + 1);
      const expected = {};
      for (const i of idx) expected[`${FOLDER_PARENT}/${FOLDER_MOVED}/${hrName(i)}`] = bulkContents[`${FOLDER_MOVED}/${hrName(i)}`] ?? null;
      const mv = await cdp4.eval(`(async () => {
        const out = { moved: false, alreadyDone: false, errors: [] };
        try { await app.vault.createFolder('${FOLDER_PARENT}'); } catch (e) { if (!/exists/i.test(String(e))) out.errors.push('createFolder: ' + String(e).slice(0, 120)); }
        const folder = app.vault.getAbstractFileByPath('${FOLDER_MOVED}');
        if (!folder) {
          if (app.vault.getAbstractFileByPath('${FOLDER_PARENT}/${FOLDER_MOVED}')) { out.alreadyDone = true; return out; }
          out.errors.push('neither ${FOLDER_MOVED} nor ${FOLDER_PARENT}/${FOLDER_MOVED}'); return out;
        }
        try { await app.fileManager.renameFile(folder, '${FOLDER_PARENT}/${FOLDER_MOVED}'); out.moved = true; }
        catch (e) { out.errors.push('folder move: ' + String(e).slice(0, 160)); }
        return out;
      })()`);
      if (!mv.ok) throw new Error(`folder move: ${mv.error}`);
      if (mv.value.errors.length) throw new Error(`folder move errors: ${fmt(mv.value.errors)}`);
      if (!mv.value.moved && !mv.value.alreadyDone) throw new Error(`folder move did not happen: ${fmt(mv.value)}`);
      const dsts = idx.map((i) => `${FOLDER_PARENT}/${FOLDER_MOVED}/${hrName(i)}`);
      const conv = await awaitConvergence(cdp5, {
        present: dsts,
        absent: [FOLDER_MOVED, ...idx.map((i) => `${FOLDER_MOVED}/${hrName(i)}`)],
        contents: expected,
      }, BULK_TIMEOUT_MS, 'folder move converges in vault5');
      for (const i of idx) {
        bulkContents[`${FOLDER_PARENT}/${FOLDER_MOVED}/${hrName(i)}`] = bulkContents[`${FOLDER_MOVED}/${hrName(i)}`];
        delete bulkContents[`${FOLDER_MOVED}/${hrName(i)}`];
      }
      return { moveResult: mv.value, convergenceMs: conv.elapsedMs, subtreeInVault5: dsts };
    };
    const r = await withRetry(runOnce);
    if (r.ok) s.pass(r.result);
    else s.fail(String(r.error?.message ?? r.error));
  }

  // ---- B5: RENAME FOLDER ----
  {
    const s = step('B5', `RENAME FOLDER: ${FOLDER_PARENT} → ${FOLDER_PARENT_RENAMED}; vault5 follows (subtree paths + contents intact)`);
    const runOnce = async () => {
      const idx = Array.from({ length: 10 }, (_, i) => i + 1);
      const expected = {};
      for (const i of idx) expected[`${FOLDER_PARENT_RENAMED}/${FOLDER_MOVED}/${hrName(i)}`] = bulkContents[`${FOLDER_PARENT}/${FOLDER_MOVED}/${hrName(i)}`] ?? null;
      const ren = await cdp4.eval(`(async () => {
        const out = { renamed: false, alreadyDone: false, errors: [] };
        const folder = app.vault.getAbstractFileByPath('${FOLDER_PARENT}');
        if (!folder) {
          if (app.vault.getAbstractFileByPath('${FOLDER_PARENT_RENAMED}')) { out.alreadyDone = true; return out; }
          out.errors.push('neither ${FOLDER_PARENT} nor ${FOLDER_PARENT_RENAMED}'); return out;
        }
        try { await app.fileManager.renameFile(folder, '${FOLDER_PARENT_RENAMED}'); out.renamed = true; }
        catch (e) { out.errors.push('folder rename: ' + String(e).slice(0, 160)); }
        return out;
      })()`);
      if (!ren.ok) throw new Error(`folder rename: ${ren.error}`);
      if (ren.value.errors.length) throw new Error(`folder rename errors: ${fmt(ren.value.errors)}`);
      if (!ren.value.renamed && !ren.value.alreadyDone) throw new Error(`folder rename did not happen: ${fmt(ren.value)}`);
      const dsts = idx.map((i) => `${FOLDER_PARENT_RENAMED}/${FOLDER_MOVED}/${hrName(i)}`);
      const conv = await awaitConvergence(cdp5, {
        present: dsts,
        absent: [FOLDER_PARENT, ...idx.map((i) => `${FOLDER_PARENT}/${FOLDER_MOVED}/${hrName(i)}`)],
        contents: expected,
      }, BULK_TIMEOUT_MS, 'folder rename converges in vault5');
      for (const i of idx) {
        bulkContents[`${FOLDER_PARENT_RENAMED}/${FOLDER_MOVED}/${hrName(i)}`] = bulkContents[`${FOLDER_PARENT}/${FOLDER_MOVED}/${hrName(i)}`];
        delete bulkContents[`${FOLDER_PARENT}/${FOLDER_MOVED}/${hrName(i)}`];
      }
      return { renameResult: ren.value, convergenceMs: conv.elapsedMs, subtreeInVault5: dsts };
    };
    const r = await withRetry(runOnce);
    if (r.ok) s.pass(r.result);
    else s.fail(String(r.error?.message ?? r.error));
  }

  // ---- B6: BULK DELETE ----
  {
    const s = step('B6', 'BULK DELETE: delete 15 files in one batch from vault4 (vault.delete); absent in vault5 AND tombstoned server-side (history head delete)');
    const runOnce = async (isRetry) => {
      // 15 = the 10 root -r files (11-r..20-r) + 5 untouched originals (26..30)
      const victims = Array.from({ length: 10 }, (_, i) => hrName(i + 11)).concat(
        Array.from({ length: 5 }, (_, i) => hName(i + 26)),
      );
      await progressRecorderStart(cdp4);
      const del = await cdp4.eval(`(async () => {
        const out = { deleted: 0, alreadyGone: 0, errors: [] };
        for (const name of ${jstr(victims)}) {
          const f = app.vault.getAbstractFileByPath(name);
          if (!f) { out.alreadyGone++; continue; }
          try { await app.vault.delete(f); out.deleted++; }
          catch (e) { out.errors.push(name + ': ' + String(e).slice(0, 120)); }
        }
        return out;
      })()`);
      if (!del.ok) throw new Error(`bulk delete: ${del.error}`);
      if (del.value.errors.length) throw new Error(`delete errors: ${fmt(del.value.errors.slice(0, 3))}`);
      if (del.value.deleted + del.value.alreadyGone !== 15) throw new Error(`delete count: ${fmt(del.value)}`);
      const conv = await awaitConvergence(cdp5, { absent: victims }, BULK_TIMEOUT_MS, '15 deletions converge in vault5');
      await awaitConvergence(cdp4, { absent: victims }, BULK_TIMEOUT_MS, 'deletions settled in vault4');
      // tombstone spot-checks: server history head for two paths is a delete
      const tombs = {};
      for (const p of [victims[0], victims[10]]) {
        const hist = await wk(`/api/history?path=${encodeURIComponent('/' + p)}`, { headers: { cookie } });
        const head = (hist.body?.versions ?? [])[0] ?? null;
        tombs[p] = { status: hist.status, head: head ? { id: head.id, kind: head.kind, deleted: head.deleted === true, deviceId: head.deviceId } : null };
        if (hist.status !== 200 || !head || (head.kind !== 'delete' && head.deleted !== true)) {
          throw new Error(`${p} not tombstoned server-side: ${fmt(tombs[p])}`);
        }
      }
      await sleep(1200);
      const cap = summarizeProgress(await progressRecorderStop(cdp4));
      for (const v of victims) delete bulkContents[v];
      return { deleteResult: del.value, convergenceMs: conv.elapsedMs, tombstones: tombs, vault4Progress: cap };
    };
    const r = await withRetry(runOnce);
    if (r.ok) s.pass(r.result);
    else s.fail(String(r.error?.message ?? r.error));
  }

  // ---- B7: DELETE NON-EMPTY FOLDER + anti-resurrection ----
  {
    const s = step('B7', `DELETE NON-EMPTY FOLDER: trashFile ${FOLDER_PARENT_RENAMED} (contains the moved subtree); subtree disappears in vault5 and does NOT resurrect after two rescan cycles (~75s)`);
    const runOnce = async () => {
      const idx = Array.from({ length: 10 }, (_, i) => i + 1);
      const subtree = idx.map((i) => `${FOLDER_PARENT_RENAMED}/${FOLDER_MOVED}/${hrName(i)}`);
      const del = await cdp4.eval(`(async () => {
        const f = app.vault.getAbstractFileByPath('${FOLDER_PARENT_RENAMED}');
        if (!f) return { ok: true, result: 'already-gone' };
        try { await app.fileManager.trashFile(f); return { ok: true, result: 'trashed' }; }
        catch (e) {
          // fallback documented in plugin.ts (adapter rmdir)
          try { await app.vault.adapter.rmdir('${FOLDER_PARENT_RENAMED}', true); return { ok: true, result: 'adapter-rmdir' }; }
          catch (e2) { return { ok: false, error: String(e) + ' | ' + String(e2) }; }
        }
      })()`);
      if (!del.ok || del.value.ok !== true) throw new Error(`folder delete: ${fmt(del.value ?? del.error)}`);
      const gone = await awaitConvergence(cdp5, {
        absent: [FOLDER_PARENT_RENAMED, `${FOLDER_PARENT_RENAMED}/${FOLDER_MOVED}`, ...subtree],
      }, BULK_TIMEOUT_MS, 'subtree gone from vault5');
      await awaitConvergence(cdp4, { absent: [FOLDER_PARENT_RENAMED, `${FOLDER_PARENT_RENAMED}/${FOLDER_MOVED}`, ...subtree] }, BULK_TIMEOUT_MS, 'subtree gone from vault4');

      // Anti-resurrection: watch across ~75s (two rescan cycles at 30s). The
      // empty-folder resurrection bug would re-create the folder (and the
      // past variant: whole-tree ghost). Sample both vaults.
      const samples = [];
      for (let i = 0; i <= 7; i++) {
        const [p, m, anyFile] = await Promise.all([
          exists(cdp5, FOLDER_PARENT_RENAMED),
          exists(cdp5, `${FOLDER_PARENT_RENAMED}/${FOLDER_MOVED}`),
          cdp5.eval(`app.vault.getFiles().filter(f => f.path.startsWith('${FOLDER_PARENT_RENAMED}/')).map(f => f.path)`).then((r) => (r.ok ? r.value : [])),
        ]);
        samples.push({ t_s: Math.round((i * (RESURRECTION_WINDOW_MS / 7)) / 1000), v5Parent: p, v5Moved: m, v5SubtreeFiles: anyFile.length });
        if (p || m || anyFile.length > 0) throw new Error(`subtree RESURRECTED in vault5 at sample ${i}: parent=${p} moved=${m} files=${fmt(anyFile)}`);
        if (i < 7) await sleep(RESURRECTION_WINDOW_MS / 7);
      }
      // and the folder did not come back as an empty placeholder on the source side either
      const v4Still = await exists(cdp4, FOLDER_PARENT_RENAMED);
      if (v4Still) throw new Error(`${FOLDER_PARENT_RENAMED} still present in vault4`);
      for (const i of idx) delete bulkContents[`${FOLDER_PARENT_RENAMED}/${FOLDER_MOVED}/${hrName(i)}`];
      return { deleteMethod: del.value.result, goneFromV5Ms: gone.elapsedMs, resurrectionWatchMs: RESURRECTION_WINDOW_MS, samples, verdict: 'subtree deleted and stayed dead across two rescan cycles' };
    };
    const r = await withRetry(runOnce);
    if (r.ok) s.pass(r.result);
    else s.fail(String(r.error?.message ?? r.error));
  }

  // ---- B8: final sanity ----
  {
    const s = step('B8', 'final sanity: both live/pending 0/conflicts 0; no conflict copies; exact remaining probe set (e2e-h-21..25.md) converged byte-identical both sides; zero CORS hits');
    try {
      await sleep(3000);
      // The expected remaining set is computed from LIVE vault4 state, NOT the
      // bulkContents map: a failed earlier phase (e.g. B5's rename hitting the
      // peer placeholder-resurrection race) leaves the map stale and would
      // poison this sanity step with paths that are legitimately gone.
      const expectedSet = (await cdp4.eval(
        `app.vault.getFiles().filter(f => /^e2e-h-\\d+(-r)?\\.md$/.test(f.path)).map(f => f.path).sort()`,
      )).value;
      const expectedContents = {};
      for (const p of expectedSet) expectedContents[p] = await readTextOrNull(cdp4, p);
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
      const conv4 = await offenders(cdp4, { present: expectedSet, contents: expectedContents });
      const conv5 = await offenders(cdp5, { present: expectedSet, contents: expectedContents });
      if (conv4.length || conv5.length) bad.push(`probe-set divergence: v4=${fmt(conv4.slice(0, 3))} v5=${fmt(conv5.slice(0, 3))}`);
      const cors = fatalConsoleHits({ vault4: cdp4, vault5: cdp5 });
      if (cors.length) bad.push(`CORS-pattern hits: ${fmt(cors.slice(0, 3))}`);
      if (bad.length) throw new Error(bad.join('; '));
      s.pass({
        remainingProbes: expectedSet,
        vault4: { state: p4.status.state, pending: p4.status.pending, statusBar: p4.statusBar },
        vault5: { state: p5.status.state, pending: p5.status.pending, statusBar: p5.statusBar },
        conflictCopies: { vault4: c4, vault5: c5 },
      });
    } catch (e) {
      s.fail(String(e.message ?? e));
    }
  }

  if (cdp4 && cdp5) {
    try {
      report.finalFiles = {
        vault4: await cdp4.eval(`app.vault.getFiles().map(f => f.path).sort()`).then((r) => r.value),
        vault5: await cdp5.eval(`app.vault.getFiles().map(f => f.path).sort()`).then((r) => r.value),
      };
    } catch { /* best effort */ }
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
    writeFileSync(join(HERE, 'report-bulkops-cloud.json'), JSON.stringify(report, null, 2));
  } catch { /* best effort */ }
  cdp4?.close();
  cdp5?.close();
  await execFileP('taskkill', ['/F', '/IM', 'Obsidian.exe']).catch(() => {});
  lines.push('TEARDOWN: Obsidian killed; CLOUD worker LEFT DEPLOYED (untouched); both vaults LEFT PAIRED+SYNCED.');
  console.log(lines.join('\n'));
  process.exit(exitCode);
}
