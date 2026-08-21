/**
 * CLOUD E2E RESUME — continues scenario-cloud.mjs from step 4 after run #1.
 *
 * Run #1 (report-cloud.json) PASSED prep/claim/pairing and bidirectional
 * 4a-4e against the deployed worker, then hit a REAL finding at step 3/4f:
 * pairing the SECOND vault whose content already exists in the room (empty
 * local index after unlink) records one add-vs-add conflict per file even
 * for byte-identical content — status bar stayed "vsa ⚠ conflicts: 33".
 * A harness bug (withRetry letting the retry throw escape) then aborted the
 * run before steps 4f/5/6/F1-F6 could execute.
 *
 * This script resumes with the pairing run #1 established (NO unlink, NO
 * re-claim): it re-launches both instances, asserts the persisted pairing
 * auto-reconnects live with ZERO conflicts (also proving the run-#1 conflict
 * records were session-scoped, not persisted), then runs the remaining
 * steps verbatim: 4a-4f, blob smoke 5, history audit 6, folder ops F1-F6.
 *
 * Usage: node scripts/e2e/scenario-cloud-resume.mjs
 *   VSA_E2E_WORKER      worker base URL (default http://127.0.0.1:8797)
 *   VSA_E2E_PASSPHRASE  admin passphrase (default two-vault-test — LOCAL
 *                       wrangler-dev rooms only; set this for a deployed room)
 * Report: scripts/e2e/report-cloud-resume.json
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

const OBSIDIAN_EXE = 'C:\\Program Files\\Obsidian\\Obsidian.exe';
const PLUGIN_PKG = 'Z:/Projects/syncv2/packages/plugin';
const V4_DIR = 'Z:/Projects/TestVaults/TestVault4';
const V5_DIR = 'Z:/Projects/TestVaults/TestVault5';
const PROFILE_A = 'Z:/Projects/TestVaults/e2e-2vault-profile';
const PROFILE_B = 'Z:/Projects/TestVaults/e2e-2vault-profile-b';
const PORT_A = 9222;
const PORT_B = 9223;
const CDP_A = `http://127.0.0.1:${PORT_A}`;
const CDP_B = `http://127.0.0.1:${PORT_B}`;

const DEVICE4 = 'e2e-vault4';
const DEVICE5 = 'e2e-vault5';
const SYNC_TIMEOUT_MS = 40_000;

// Same artifact list as scenario-cloud.mjs (v4-note.md exists from run #1's 4a;
// everything else was consumed/deleted by run #1's steps).
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
  resumeOf: 'scenario-cloud.mjs run #1 (report-cloud.json)',
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

/** Both attempts caught (fixed version — see this file's header note). */
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
  let dialogsClicked = [];
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

// --- CORS / Illegal-invocation tripwire ------------------------------------------------------------

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

// --- main --------------------------------------------------------------------------------------------

let cookie;
let cdp4 = null;
let cdp5 = null;
let exitCode = 0;
let fatalStop = false;
const deviceIds = {};

process.on('uncaughtException', (e) => {
  lines.push(`[FATAL-uncaught] ${String(e?.stack ?? e)}`);
  report.fatal = String(e?.message ?? e);
});

try {
  // ---- step 0: kill Obsidian, verify CLAIMED cloud room + persisted pairing, refresh plugin, clean artifacts, profiles
  {
    const s = step('prep', 'kill Obsidian; /health claimed; data.json paired to CLOUD (tokens intact); refresh plugin build; clear scenario artifacts; write profiles');
    try {
      await execFileP('taskkill', ['/F', '/IM', 'Obsidian.exe']).catch((e) => String(e));
      await sleep(1500);
      const health = await wk('/health');
      if (health.status !== 200 || health.body.ok !== true) throw new Error(`unexpected /health: ${fmt(health.body)}`);
      if (health.body.claimed !== true) throw new Error(`worker not claimed — run scenario-cloud.mjs first: ${fmt(health.body)}`);
      cookie = await adminLogin();
      const st = await wk('/api/status', { headers: { cookie } });
      if (st.body?.vaultName !== VAULT_NAME) throw new Error(`room vaultName ${st.body?.vaultName} != ${VAULT_NAME} — not our room`);

      const pairing = {};
      for (const [name, dir] of [['TestVault4', V4_DIR], ['TestVault5', V5_DIR]]) {
        // refresh plugin build (upgrade-in-place like scenario-hardened)
        const dest = join(dir, '.obsidian/plugins/vaultsyncforagents');
        mkdirSync(dest, { recursive: true });
        for (const f of ['main.js', 'manifest.json', 'styles.css']) copyFileSync(join(PLUGIN_PKG, f), join(dest, f));
        const d = JSON.parse(readFileSync(join(dest, 'data.json'), 'utf8'));
        if (d.url !== WORKER || (d.token || '').length < 10 || !d.deviceId) {
          throw new Error(`${name} not paired to the cloud worker: url=${d.url} tokenLen=${(d.token || '').length} deviceId=${d.deviceId}`);
        }
        pairing[name] = { url: d.url, deviceId: d.deviceId, deviceName: d.deviceName, tokenLen: (d.token || '').length };
        if (name === 'TestVault4') deviceIds.vault4 = d.deviceId;
        if (name === 'TestVault5') deviceIds.vault5 = d.deviceId;
        // rerun hygiene: v4-note.md etc. exist from run #1 — remove from BOTH
        // vaults while the apps are dead (normal "deleted while closed" flow;
        // tombstones sync on reconnect, then 4a recreates fresh)
        for (const art of SCENARIO_ARTIFACTS) {
          const p = join(dir, art);
          if (existsSync(p)) rmSync(p, { recursive: true, force: true });
        }
      }
      const { stdout: pa } = await execFileP(process.execPath, [join(HERE, 'write-profile.mjs'), PROFILE_A, V4_DIR, V5_DIR]);
      const { stdout: pb } = await execFileP(process.execPath, [join(HERE, 'write-profile.mjs'), PROFILE_B, V5_DIR, V4_DIR]);
      s.pass({
        health: health.body,
        roomVaultName: st.body?.vaultName,
        persistedPairing: pairing,
        pluginRefreshedFrom: PLUGIN_PKG,
        profileA: pa.trim(),
        profileB: pb.trim(),
        cdpPorts: { vault4: PORT_A, vault5: PORT_B },
      });
    } catch (e) {
      s.fail(String(e.message ?? e));
      fatalStop = true;
    }
  }

  // ---- step R1: launch both; persisted pairing auto-reconnects; live; ZERO conflicts (run-#1 records were session-scoped)
  {
    const s = step('R1', 'launch both instances (NO re-pair) — persisted CLOUD pairing auto-reconnects: both live ✓, pending 0, conflicts 0 (proves run-#1 conflict records were session-scoped)');
    try {
      if (fatalStop) throw new Error('skipped (prep failed)');
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
      for (const [name, cdp] of [['vault4', cdp4], ['vault5', cdp5]]) {
        // settle: tombstones from prep's artifact removal + full reconciliation
        await sleep(3000);
        const st = await waitFor(async () => {
          const ps = await pluginStatus(cdp);
          return ps?.statusBar?.startsWith('vsa ✓') && ps?.status?.state === 'live' && ps?.status?.pending === 0 ? ps : null;
        }, 60_000, 1000, `${name} live+✓+pending0`);
        if ((st.value.status?.conflicts ?? []).length !== 0) {
          throw new Error(`${name} conflicts=${st.value.status.conflicts.length} after fresh session — records DID persist: ${fmt(st.value.status.conflicts.slice(0, 2))}`);
        }
        live[name] = { statusBar: st.value.statusBar, state: st.value.status.state, pending: st.value.status.pending, deviceId: st.value.deviceId };
      }
      const cors = fatalConsoleHits({ vault4: cdp4, vault5: cdp5 });
      if (cors.length > 0) throw new Error(`CORS/Illegal-invocation console hits: ${fmt(cors.slice(0, 3))}`);
      const st = await waitFor(async () => {
        const res = await wk('/api/status', { headers: { cookie } });
        const devs = res.body?.devices ?? [];
        const online = devs.filter((d) => d.online).map((d) => d.name);
        return online.includes(DEVICE4) && online.includes(DEVICE5) ? devs : null;
      }, 45_000, 1000, 'both devices online');
      s.pass({
        headline: 'CLOUD PAIRING PERSISTED — both clients auto-reconnected to the deployed worker with ZERO conflicts (run-#1 add-vs-add records were session-scoped)',
        pids: report.pids,
        vaults: live,
        devicesOnline: st.value.filter((d) => d.online).map((d) => `${d.name}(${d.online ? 'online' : 'offline'})`),
      });
    } catch (e) {
      s.fail(String(e.message ?? e));
      const hits = fatalConsoleHits({ vault4: cdp4, vault5: cdp5 });
      if (hits.length) report.r1ConsoleHits = hits.slice(0, 10);
      if (/CORS|Illegal invocation/i.test(String(e.message ?? e))) fatalStop = true;
    }
  }

  // ---- step 4: BIDIRECTIONAL SYNC (same bodies as scenario-cloud.mjs) ------------------------
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

  // ---- step 5: attachment smoke — >256KB binary through real R2 ------------------------------
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

  // ---- step 6: history chain + conflict audit --------------------------------------------------
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
        let placeholderMs = null;
        try {
          placeholderMs = await waitFor(async () => ((await exists(cdp4, 'to-delete')) ? true : null), 35_000, 1000, 'vault4 sees to-delete').then((x) => x.elapsedMs);
        } catch {
          await syncNow(cdp4);
          placeholderMs = await waitFor(async () => ((await exists(cdp4, 'to-delete')) ? true : null), 35_000, 1000, 'vault4 sees to-delete after poke').then((x) => x.elapsedMs);
        }
        await sleep(3000);
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
        await t.run(s);
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
  const consoles = {};
  if (cdp4) consoles.vault4 = cdp4.consoleLog;
  if (cdp5) consoles.vault5 = cdp5.consoleLog;
  report.consoleProblems = {};
  for (const [name, entries] of Object.entries(consoles)) {
    report.consoleProblems[name] = entries.filter((e) => ['error', 'warning', 'warn'].includes(String(e.level).toLowerCase()));
  }
  try {
    const h = await wk('/health');
    report.workerLeftRunning = { url: WORKER, health: h.body, note: 'deployed Cloudflare worker — LEFT RUNNING' };
  } catch {
    report.workerLeftRunning = { url: WORKER, note: 'left deployed (health probe failed)' };
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
  const totalProblems = Object.values(report.consoleProblems).reduce((a, b) => a + b.length, 0);
  lines.push(`Console errors/warnings captured: ${totalProblems}`);
  for (const [name, entries] of Object.entries(report.consoleProblems)) {
    for (const c of entries.slice(0, 10)) lines.push(`  [${name} ${c.level}] ${c.text.slice(0, 240)}`);
  }
  try {
    writeFileSync(join(HERE, 'report-cloud-resume.json'), JSON.stringify(report, null, 2));
  } catch { /* best effort */ }
  cdp4?.close();
  cdp5?.close();
  await execFileP('taskkill', ['/F', '/IM', 'Obsidian.exe']).catch(() => {});
  lines.push(`TEARDOWN: Obsidian killed; CLOUD worker ${WORKER} LEFT DEPLOYED; both vaults LEFT PAIRED+SYNCED to it.`);
  console.log(lines.join('\n'));
  process.exit(exitCode);
}
