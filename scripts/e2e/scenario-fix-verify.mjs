/**
 * FIX-VERIFY acceptance for the two real-Obsidian findings F-1 + F-2
 * (report-hardened.json): runs against the SAME dogfood room (worker 8797,
 * persist dir .wrangler/devstate-testvault), the SAME throwaway profiles and
 * CDP ports as scenario-hardened-resume2.mjs, with the FIXED plugin build.
 *
 *   S6a-fix   delete EMPTY folder in vault4 → placeholder gone from vault5,
 *             vault5's LOCAL DIR REMOVED, and /api/history shows NO
 *             edit-after-delete on that path across two rescan cycles
 *             (no ping-pong; the deleting side stays deleted).
 *   S6b-fix   delete FILE emptied its folder → folder pruned on BOTH sides,
 *             never resurrects across two rescan cycles.
 *   about-fix open the plugin settings About section → "Vault storage" loads
 *             ("Storage used: …") with ZERO console errors (F-2 CORS fix).
 *
 * Writes scripts/e2e/report-fix-verify.json (the original report-hardened.json
 * evidence is preserved untouched). Tears down Obsidian; LEAVES the worker
 * RUNNING (PID recorded). Usage: node scripts/e2e/scenario-fix-verify.mjs
 */

import { execFile } from 'node:child_process';
import { existsSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { connectPage, listTargets } from './cdp.mjs';

const execFileP = promisify(execFile);
const HERE = join(fileURLToPath(import.meta.url), '..');

const WORKER = 'http://127.0.0.1:8797';
const PASSPHRASE = 'two-vault-test';
const OBSIDIAN_EXE = 'C:\\Program Files\\Obsidian\\Obsidian.exe';
const V4_DIR = 'Z:/Projects/TestVaults/TestVault4';
const V5_DIR = 'Z:/Projects/TestVaults/TestVault5';
const PROFILE_A = 'Z:/Projects/TestVaults/e2e-hardened-profile';
const PROFILE_B = 'Z:/Projects/TestVaults/e2e-hardened-profile-b';
const PORT_A = 9222;
const PORT_B = 9223;
const CDP_A = `http://127.0.0.1:${PORT_A}`;
const CDP_B = `http://127.0.0.1:${PORT_B}`;
const PLUGIN_DIR4 = `${V4_DIR}/.obsidian/plugins/vaultsyncforagents`;
const PLUGIN_DIR5 = `${V5_DIR}/.obsidian/plugins/vaultsyncforagents`;
// Fresh folder names PER RUN: the vaults' indexes carry tombstones for the
// OLD test folders, and re-using those names would measure recreate-over-
// tombstone semantics instead of plain placeholder propagation.
const RUN_TAG = Date.now().toString(36);
const FOLDER = `tempfolder-fix-${RUN_TAG}`;
const RESURRECT_DIR = `resurrect-fix-${RUN_TAG}`;
const SYNC_TIMEOUT_MS = 25_000;
const jstr = JSON.stringify;

// --- reporting -----------------------------------------------------------------------------------

const report = {
  startedAt: new Date().toISOString(),
  worker: WORKER,
  purpose: 'acceptance re-run for F-1 (empty-folder tombstone ping-pong) and F-2 (About /api/status CORS) after the fix build',
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
/** Fixed withRetry: both failures RETURNED, never thrown (harness F-3). */
async function withRetry(fn) {
  try {
    return { ok: true, result: await fn(false) };
  } catch (first) {
    log(`  retry-after-error: ${String(first.message ?? first).slice(0, 300)}`);
    try {
      return { ok: true, result: await fn(true) };
    } catch (second) {
      return { ok: false, error: second, firstError: first };
    }
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
  return (login.headers.get('set-cookie') ?? '').split(';')[0];
}

// --- vault helpers ---------------------------------------------------------------------------------

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
      deviceName: p.data?.deviceName ?? null, paused: !!p.syncingPaused, hasClient: !!p.client }; })()`);
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
async function folderEntry(cdp, path) {
  const r = await cdp.eval(`(() => { const p = app.plugins?.plugins?.vaultsyncforagents; const e = p?.client?.currentIndex?.()?.[${jstr('/' + path)}];
    return e ? { isFolder: !!e.isFolder, deletedAt: e.deletedAt ?? null, versionId: e.versionId } : null; })()`);
  if (!r.ok) throw new Error(`folderEntry eval: ${r.error}`);
  return r.value;
}
/** Delete an empty folder the way a user does (system trash — the E2E-proven path). */
async function trashEmptyFolder(cdp, path) {
  const r = await cdp.eval(`(async () => {
    const af = app.vault.getAbstractFileByPath(${jstr(path)});
    if (!af) return 'missing';
    await app.fileManager.trashFile(af);
    return 'trashed'; })()`);
  if (!r.ok) throw new Error(`trashEmptyFolder eval: ${r.error}`);
  return r.value;
}

// --- main ----------------------------------------------------------------------------------------------

let cookie = null;
let cdp4 = null;
let cdp5 = null;
let exitCode = 0;

process.on('uncaughtException', (e) => {
  lines.push(`[FATAL-uncaught] ${String(e?.stack ?? e)}`);
  report.fatal = String(e?.message ?? e);
});

try {
  // ---- prep: worker health + live CORS proof + build freshness ----
  {
    const s = step('prep', '/health; live OPTIONS /api/status preflight must carry ACAO (F-2 fix, hot-reloaded worker); fixed plugin bundle freshness in BOTH vaults');
    const health = await wk('/health');
    if (!health.body?.ok) throw new Error(`worker not healthy: ${fmt(health.body)}`);
    const preflight = await fetch(`${WORKER}/api/status`, {
      method: 'OPTIONS',
      headers: {
        origin: 'app://obsidian.md',
        'access-control-request-method': 'GET',
        'access-control-request-headers': 'authorization',
      },
      signal: AbortSignal.timeout(10_000),
    });
    const preflightOk = preflight.status === 204 && preflight.headers.get('access-control-allow-origin') === '*';
    const bundle = {};
    for (const [name, dir] of [['TestVault4', PLUGIN_DIR4], ['TestVault5', PLUGIN_DIR5]]) {
      const mainJs = join(dir, 'main.js');
      bundle[name] = {
        built: statSync(mainJs).mtime.toISOString(),
        removeDirOccurrences: (readFileSync(mainJs, 'utf8').match(/removeDir/g) ?? []).length,
      };
    }
    const detail = {
      health: health.body,
      liveApiStatusPreflight: { status: preflight.status, acao: preflight.headers.get('access-control-allow-origin'), ok: preflightOk },
      pluginBundles: bundle,
    };
    if (!preflightOk) throw new Error(`live /api/status preflight still lacks CORS: ${fmt(detail.liveApiStatusPreflight)}`);
    if (Object.values(bundle).some((b) => b.removeDirOccurrences === 0)) throw new Error(`bundle missing removeDir: ${fmt(bundle)}`);
    s.pass(detail);
  }

  // ---- launch: both instances, pairing auto-reconnects ----
  {
    const s = step('launch', 'launch both instances (throwaway profiles, NO --disable-web-security) — pairing auto-reconnects live; leftover empty folders from the prior run tombstone cleanly on startup');
    try {
      const { spawn } = await import('node:child_process');
      await execFileP('taskkill', ['/F', '/IM', 'Obsidian.exe']).catch(() => {});
      await sleep(1500);
      const pidA = spawn(OBSIDIAN_EXE, [`--user-data-dir=${PROFILE_A}`, `--remote-debugging-port=${PORT_A}`], { detached: true, stdio: 'ignore' }).pid;
      const pidB = spawn(OBSIDIAN_EXE, [`--user-data-dir=${PROFILE_B}`, `--remote-debugging-port=${PORT_B}`], { detached: true, stdio: 'ignore' }).pid;
      const ready = async (http, match, label) => {
        await waitFor(async () => {
          try {
            return (await listTargets(http)).some((t) => t.type === 'page');
          } catch {
            return null;
          }
        }, 60_000, 1000, `${label} CDP up`);
        let cdp = null;
        await waitFor(async () => {
          if (cdp === null) {
            try {
              cdp = await connectPage({ match, http });
            } catch {
              return null; // app not up yet — retry
            }
          }
          const probe = await cdp.eval('!!(app.plugins?.plugins?.vaultsyncforagents)');
          return probe.ok && probe.value === true ? true : null;
        }, 120_000, 1500, `${label} plugin loaded`);
        return cdp;
      };
      const [a, b] = await Promise.all([
        ready(CDP_A, 'TestVault4', 'vault4'),
        ready(CDP_B, 'TestVault5', 'vault5'),
      ]);
      cdp4 = a;
      cdp5 = b;
      report.pids = { obsidianVault4: pidA, obsidianVault5: pidB };
      const live = {};
      for (const [name, cdp] of [['vault4', cdp4], ['vault5', cdp5]]) {
        const st = await waitFor(async () => {
          const ps = await pluginStatus(cdp);
          return ps?.statusBar?.startsWith('vsa ✓') && ps?.status?.state === 'live' ? ps : null;
        }, 45_000, 1000, `${name} live+✓`);
        live[name] = { statusBar: st.value.statusBar, state: st.value.status.state, deviceId: st.value.deviceId, deviceName: st.value.deviceName };
      }
      // Let the startup cycles converge (leftover 'tempfolder'/'resurrect'
      // placeholders from the prior run's teardown tombstone + propagate here).
      await sleep(8000);
      const settle = {};
      for (const [name, cdp] of [['vault4', cdp4], ['vault5', cdp5]]) {
        const ps = await pluginStatus(cdp);
        settle[name] = { state: ps?.status?.state, pending: ps?.status?.pending };
      }
      s.pass({ headline: 'both clients reconnected live with untouched tokens', pids: { vault4: pidA, vault5: pidB }, vaults: live, postSettle: settle });
    } catch (e) {
      s.fail(String(e.message ?? e));
      throw e;
    }
  }

  // ---- S6a-fix: the exact E2E ping-pong scenario, now with the fix ----
  {
    const s = step('S6a', `FIXED F-1: create EMPTY '${FOLDER}' in vault4 → placeholder reaches vault5 → delete the EMPTY folder in vault4 (fileManager.trashFile) → placeholder gone from vault5 AND vault5's local dir REMOVED ≤40s; NO ping-pong: /api/history has NO edit-after-delete, deleting side stays deleted across two rescan cycles`);
    const runOnce = async () => {
      // 1. create the empty folder in vault4, push the placeholder
      const mk = await cdp4.eval(`(async () => {
        try { await app.vault.createFolder(${jstr(FOLDER)}); return 'created'; }
        catch (e) { return (await app.vault.adapter.exists(${jstr(FOLDER)})) ? 'already-exists' : String(e); } })()`);
      if (!mk.ok || (mk.value !== 'created' && mk.value !== 'already-exists')) throw new Error(`createFolder in vault4: ${fmt(mk)}`);
      await syncNow(cdp4);
      await waitFor(async () => ((await exists(cdp5, FOLDER)) ? true : null), SYNC_TIMEOUT_MS, 400, 'placeholder reaches vault5');
      const v5Live = await waitFor(async () => {
        const e = await folderEntry(cdp5, FOLDER);
        return e?.isFolder && e.deletedAt === null ? e : null;
      }, SYNC_TIMEOUT_MS, 400, 'vault5 placeholder live in index');
      await sleep(3000); // settle both sides

      // 2. delete the EMPTY folder in vault4 (the user path)
      const markerTs = Date.now();
      const trashed = await trashEmptyFolder(cdp4, FOLDER);
      if (trashed !== 'trashed') throw new Error(`trashFile returned ${fmt(trashed)}`);
      await syncNow(cdp4);

      // 3. placeholder must disappear from vault5 ≤40s AND the local dir removed
      await waitFor(async () => ((await exists(cdp5, FOLDER)) ? null : true), 40_000, 500, 'placeholder gone from vault5');
      const placeholderGoneMs = Date.now() - markerTs;
      const v5Entry = await folderEntry(cdp5, FOLDER);
      const v5DirRemoved = !(await exists(cdp5, FOLDER));
      if (!v5Entry?.deletedAt) throw new Error(`vault5 index entry not tombstoned: ${fmt(v5Entry)}`);
      if (!v5DirRemoved) throw new Error("vault5's local empty dir was NOT removed (record-only fallback fired — adapter removeDir missing?)");

      // 4. NO ping-pong: sample both vaults across two rescan cycles (40s)
      const samples = [];
      for (let i = 0; i <= 8; i++) {
        const [f4, f5] = await Promise.all([exists(cdp4, FOLDER), exists(cdp5, FOLDER)]);
        samples.push({ t_s: i * 5, v4Folder: f4, v5Folder: f5 });
        if (i < 8) await sleep(5000);
      }
      const resurrected = samples.filter((x) => x.v4Folder || x.v5Folder);
      if (resurrected.length > 0) throw new Error(`folder RESURRECTED during observation: ${fmt(samples)}`);

      // 5. worker history: NO edit-after-delete on the path
      cookie = cookie ?? (await adminLogin());
      const hist = await wk(`/api/history?path=${encodeURIComponent('/' + FOLDER)}`, { headers: { cookie } });
      const versions = hist.body?.versions ?? [];
      const head = hist.body?.head;
      const newest = versions[0];
      const editsAfterMarker = versions.filter((v) => v.kind === 'edit' && v.ts > markerTs);
      const history = {
        status: hist.status,
        head: head ? { versionId: head.versionId, deleted: head.deleted } : null,
        newestVersion: newest ? { id: newest.id, kind: newest.kind, deviceId: newest.deviceId, ts: newest.ts } : null,
        versionsNewestFirst: versions.map((v) => ({ id: v.id, kind: v.kind, deviceId: v.deviceId, ts: v.ts })),
      };
      if (head?.deleted !== true) throw new Error(`history head not deleted: ${fmt(history)}`);
      if (newest?.kind !== 'delete') throw new Error(`PING-PONG: newest history version is ${fmt(newest)}, expected the delete — ${fmt(history)}`);
      if (editsAfterMarker.length > 0) throw new Error(`PING-PONG: ${editsAfterMarker.length} edit(s) pushed after the delete — ${fmt(history)}`);

      return {
        placeholderGoneMs,
        vault5DirRemoved,
        vault5IndexTombstoned: true,
        folderObservation: samples,
        workerHistory: history,
        verdict: "delete propagated, peer's local dir removed, no edit-after-delete on the path, deleting side stayed deleted across two rescan cycles",
      };
    };
    const r = await withRetry(runOnce);
    if (r.ok) s.pass(r.result);
    else s.fail({ error: String(r.error?.message ?? r.error), firstError: String(r.firstError?.message ?? '') });
  }

  // ---- S6b-fix: emptied folder prunes on BOTH sides ----
  {
    const s = step('S6b', `FIXED prune-on-delete: '${RESURRECT_DIR}/keep.md' synced; delete FILE in vault4 → file gone in vault5 AND the emptied folder prunes on BOTH sides, never resurrects across 40s (two rescan cycles)`);
    const runOnce = async () => {
      const content = `keep me ${Date.now()}`;
      const mk = await cdp5.eval(`(async () => {
        await app.vault.createFolder(${jstr(RESURRECT_DIR)});
        await app.vault.create(${jstr(RESURRECT_DIR + '/keep.md')}, ${jstr(content)});
        return 'created'; })()`);
      if (!mk.ok) throw new Error(`create ${RESURRECT_DIR}/keep.md in vault5: ${mk.error}`);
      let toV4Ms;
      try {
        const r = await waitFor(async () => ((await exists(cdp4, RESURRECT_DIR + '/keep.md')) ? true : null), 35_000, 400, 'keep.md arrives vault4');
        toV4Ms = r.elapsedMs;
      } catch {
        await syncNow(cdp5);
        const r = await waitFor(async () => ((await exists(cdp4, RESURRECT_DIR + '/keep.md')) ? true : null), 35_000, 400, 'keep.md arrives vault4 (poked)');
        toV4Ms = r.elapsedMs;
        log('  (needed a syncNow poke)');
      }
      await sleep(3000); // settle

      const del = await cdp4.eval(`app.vault.delete(app.vault.getAbstractFileByPath(${jstr(RESURRECT_DIR + '/keep.md')})).then(() => 'deleted')`);
      if (!del.ok) throw new Error(`delete keep.md in vault4: ${del.error}`);
      const fileGoneMs = (await waitFor(async () => ((await exists(cdp5, RESURRECT_DIR + '/keep.md')) ? null : true), SYNC_TIMEOUT_MS, 400, 'vault5 drops keep.md')).elapsedMs;

      // watch the empty folder across ≥40s (rescanIntervalSec=30 → two cycles)
      const samples = [];
      for (let i = 0; i <= 8; i++) {
        const [f4, f5] = await Promise.all([exists(cdp4, RESURRECT_DIR), exists(cdp5, RESURRECT_DIR)]);
        samples.push({ t_s: i * 5, v4Folder: f4, v5Folder: f5 });
        if (i < 8) await sleep(5000);
      }
      const last = samples[samples.length - 1];
      if (last.v4Folder) throw new Error(`emptied '${RESURRECT_DIR}' folder NOT pruned on the deleting side (vault4) ≥40s: ${fmt(samples)}`);
      if (last.v5Folder) throw new Error(`emptied '${RESURRECT_DIR}' folder NOT pruned on the receiving side (vault5) ≥40s: ${fmt(samples)}`);
      return {
        v5toV4SyncMs: toV4Ms,
        fileGoneInV5Ms: fileGoneMs,
        folderObservation: samples,
        verdict: 'file deleted remotely AND the emptied folder pruned on BOTH sides (deleting side too), never resurrected across two rescan cycles',
      };
    };
    const r = await withRetry(runOnce);
    if (r.ok) s.pass(r.result);
    else s.fail({ error: String(r.error?.message ?? r.error), firstError: String(r.firstError?.message ?? '') });
  }

  // ---- about-fix: About "Vault storage" loads with zero console errors (F-2) ----
  {
    const s = step('about-fix', 'open vault5 plugin settings About section → "Vault storage" line loads real data ("Storage used: …") with ZERO CORS/console errors (F-2 fix)');
    try {
      // Prove the renderer-side cross-origin fetch works FIRST (evidence even
      // if the DOM capture below races).
      const direct = await cdp5.eval(`(async () => {
        const p = app.plugins.plugins.vaultsyncforagents;
        const res = await fetch(p.data.url + '/api/status', { headers: { authorization: 'Bearer ' + p.data.token } });
        const body = await res.json();
        return { status: res.status, storageBytes: body.storageBytes, devices: (body.devices ?? []).length }; })()`);
      const before = cdp5.consoleLog.length;
      // Open settings and WAIT for the modal's items to actually render —
      // open() is async; a blind immediate openTabById can race it.
      await cdp5.eval(`(async () => { app.setting.open(); return 'opened'; })()`);
      await waitFor(async () => {
        const r = await cdp5.eval(`document.querySelectorAll('.setting-item').length`);
        return r.ok && r.value > 0 ? true : null;
      }, 10_000, 300, 'settings modal renders');
      await cdp5.eval(`(async () => { app.setting.openTabById('vaultsyncforagents'); return 'tab'; })()`);
      const desc = await waitFor(async () => {
        const r = await cdp5.eval(`(() => {
          const item = [...document.querySelectorAll('.setting-item')].find(el => el.querySelector('.setting-item-name')?.textContent === 'Vault storage');
          return item?.querySelector('.setting-item-description')?.textContent ?? null; })()`);
        return r.ok && typeof r.value === 'string' && r.value.startsWith('Storage used:') ? r.value : null;
      }, 15_000, 400, 'About storage line renders');
      const hits = cdp5.consoleLog.slice(before).filter((e) => /api\/status/i.test(e.text) || /CORS/i.test(e.text) || String(e.level).toLowerCase() === 'error');
      await cdp5.eval(`(() => { try { app.setting.close(); } catch (e) {} return 'closed'; })()`);
      const detail = {
        storageLine: desc.value,
        directRendererFetch: direct.ok ? direct.value : `eval failed: ${direct.error}`,
        consoleHitsDuringAbout: hits,
      };
      if (hits.length > 0) throw new Error(`console errors during About render: ${fmt(hits)}`);
      if (!direct.ok || direct.value?.status !== 200) throw new Error(`renderer /api/status fetch failed: ${fmt(direct)}`);
      s.pass(detail);
    } catch (e) {
      await cdp5.eval(`(() => { try { app.setting.close(); } catch (x) {} return 'closed'; })()`).catch(() => {});
      s.fail(String(e.message ?? e));
    }
  }

  // ---- final sanity ----
  {
    const s = step('sanity', 'final sanity: both plugins live/pending 0/conflicts 0; zero console errors on BOTH sessions (the old build dropped CORS errors on every settings open)');
    try {
      await sleep(2000);
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
      const FATAL_PATTERNS = [/blocked by CORS policy/i, /Access-Control-Allow-Origin/i, /Illegal invocation/i, /Failed to execute 'fetch'/i];
      const sessionFatal = [...cdp4.consoleLog, ...cdp5.consoleLog].filter(
        (e) => String(e.level).toLowerCase() === 'error' && FATAL_PATTERNS.some((re) => re.test(e.text)),
      );
      if (sessionFatal.length > 0) bad.push(`console tripwire: ${fmt(sessionFatal)}`);
      const detail = {
        vault4: { state: p4.status.state, pending: p4.status.pending, statusBar: p4.statusBar },
        vault5: { state: p5.status.state, pending: p5.status.pending, statusBar: p5.statusBar, deviceName: p5.deviceName },
        conflictFiles: { vault4: c4, vault5: c5 },
        sessionErrorEntries: [...cdp4.consoleLog, ...cdp5.consoleLog].filter((e) => String(e.level).toLowerCase() === 'error').length,
      };
      if (bad.length > 0) {
        s.fail({ ...detail, verdict: bad.join('; ') });
      } else {
        s.pass({ ...detail, verdict: 'all green — zero console errors across both sessions' });
      }
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
  // worker PID(s) listening on 8797 (worker LEFT RUNNING)
  try {
    const { stdout } = await execFileP('netstat', ['-ano']).catch(() => ({ stdout: '' }));
    const pids = [...new Set(stdout.split('\n').filter((l) => /:8797\s/.test(l) && /LISTENING/i.test(l)).map((l) => l.trim().split(/\s+/).pop()))];
    report.workerLeftRunning = { url: WORKER, listeningPids: pids, note: 'wrangler dev --port 8797 --persist-to .wrangler/devstate-testvault (user dogfood room) — LEFT RUNNING' };
  } catch {
    report.workerLeftRunning = { url: WORKER, note: 'left running (PID capture failed)' };
  }
  report.finishedAt = new Date().toISOString();
  delete report.fatal;
  const failed = report.steps.filter((x) => x.status === 'FAIL' || x.status === 'RUNNING').length;
  const passed = report.steps.filter((x) => x.status === 'PASS').length;
  report.overall = failed === 0 ? 'PASS' : 'FAIL';
  report.overallNotes = [
    'Acceptance for the F-1/F-2 fix build against the live dogfood room.',
    'S6a = the exact E2E ping-pong scenario from report-hardened.json (now must show: peer dir removed, no edit-after-delete in /api/history, deleting side stays deleted).',
    'S6b = emptied folder must prune on BOTH sides (the deleting side previously kept it).',
    'about-fix = About "Vault storage" must render real data with zero console errors (previously CORS-blocked deterministically).',
  ];
  exitCode = failed === 0 ? 0 : 1;
  lines.push('');
  lines.push(`SUMMARY: ${passed} PASS, ${failed} FAIL — overall ${report.overall}`);
  for (const [name, entries] of Object.entries(report.consoleProblems)) {
    for (const c of entries.slice(-8)) lines.push(`  [${name} ${c.level}] ${c.text.slice(0, 200)}`);
  }
  try {
    writeFileSync(join(HERE, 'report-fix-verify.json'), JSON.stringify(report, null, 2));
  } catch {
    /* best effort */
  }
  cdp4?.close();
  cdp5?.close();
  // TEARDOWN: kill Obsidian; remove THIS run's leftover empty test folders from
  // both vaults on disk (indexes hold live placeholders → next launch tombstones
  // and propagates — converges clean); LEAVE the 8797 worker RUNNING.
  await execFileP('taskkill', ['/F', '/IM', 'Obsidian.exe']).catch(() => {});
  await sleep(1000);
  const removed = [];
  for (const dir of [V4_DIR, V5_DIR]) {
    for (const folder of ['tempfolder', 'resurrect', FOLDER, RESURRECT_DIR]) {
      const p = join(dir, folder);
      try {
        if (existsSync(p)) {
          rmSync(p, { recursive: true, force: true });
          removed.push(p);
        }
      } catch {
        /* best effort */
      }
    }
  }
  decide(`teardown removed leftover empty test folders on disk: ${removed.length ? removed.join(', ') : 'none present'} (dogfood config untouched; device keeps its renamed name)`);
  lines.push('TEARDOWN: Obsidian killed; worker 8797 LEFT RUNNING; both vaults LEFT PAIRED+SYNCED.');
  console.log(lines.join('\n'));
  process.exit(exitCode);
}
