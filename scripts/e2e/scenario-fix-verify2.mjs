/**
 * FIX-VERIFY #2 — clean acceptance re-run for F-1 + F-2 after the fix build.
 * The first re-run (scenario-fix-verify.mjs → report-fix-verify.json) failed on
 * CONTAMINATED folder names and an About-render timeout with zero console
 * errors; this run uses UNIQUE per-run folder names so it measures only the
 * fixes. Same dogfood room (worker 8797, .wrangler/devstate-testvault), same
 * throwaway profiles + CDP ports 9222/9223 as scenario-hardened-resume2.mjs.
 *
 *   A  launch both vaults via the profiles; plugins auto-reconnect live.
 *   B  F-1: EMPTY 'pingpong-check-<tag>' created in vault4 → placeholder
 *      reaches vault5 → delete the empty folder in vault4 (trashFile, fallback
 *      adapter.rmdir) → gone from vault5 ≤40s → never resurrects across two
 *      rescan cycles (~40s) → /api/history shows NO edit after the delete.
 *   C  prune: 'prune-check-<tag>' + keep.md created in vault5 → synced to
 *      vault4 → delete keep.md in vault4 → keep.md gone in vault5 AND the
 *      emptied folder pruned on BOTH sides ≤40s → still gone one cycle later.
 *   D  F-2: open vault4 settings → VaultSync tab → About "Vault storage" line
 *      renders non-empty real text ≤15s with zero console errors; network
 *      capture proves GET /api/status was made and its status.
 *   E  sanity: both live, pending 0, conflicts 0, zero console errors.
 *
 * Writes scripts/e2e/report-fix-verify2.json. Tears Obsidian down at the end;
 * LEAVES the worker RUNNING (PID recorded) and both vaults paired+synced.
 * Usage: node scripts/e2e/scenario-fix-verify2.mjs
 */

import { execFile } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
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

// UNIQUE names PER RUN: the vault indexes carry tombstones for every earlier
// test folder; re-used names would measure recreate-over-tombstone semantics
// instead of plain placeholder propagation (the first re-run's failure mode).
const RUN_TAG = `v2${Date.now().toString(36)}`;
const PINGPONG = `pingpong-check-${RUN_TAG}`;
const PRUNE = `prune-check-${RUN_TAG}`;
// Litter patterns cleaned from BOTH vaults at teardown (this run's folders +
// known leftovers from earlier runs/probes).
const LITTER_PREFIXES = ['pingpong-check-', 'prune-check-', 'tempfolder', 'resurrect', 'rmdir-probe-'];

const jstr = JSON.stringify;

// --- reporting -----------------------------------------------------------------------------------

const report = {
  startedAt: new Date().toISOString(),
  worker: WORKER,
  purpose:
    'CLEAN acceptance re-run for F-1 (empty-folder tombstone ping-pong) and F-2 (About /api/status CORS) — unique folder names, fresh index state',
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
      lines.push(`[PASS] ${id} (${entry.ms} ms)${detail === undefined ? '' : ` — ${fmt(detail)}`}`);
    },
    fail(detail) {
      entry.status = 'FAIL';
      entry.ms = Date.now() - entry.t0;
      entry.detail = detail;
      lines.push(`[FAIL] ${id} (${entry.ms} ms) — ${fmt(detail)}`);
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
/** ONE retry on failure; both failures RETURNED (never thrown). */
async function withRetry(fn) {
  try {
    return { ok: true, result: await fn(false) };
  } catch (first) {
    log(`  retry-after-error: ${String(first.message ?? first).slice(0, 300)}`);
    await sleep(3000);
    try {
      return { ok: true, result: await fn(true), retried: true };
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
  return cdp.eval(
    `(async()=>{ const p = app.plugins?.plugins?.vaultsyncforagents; if (!p?.syncNow) return 'no-plugin'; await p.syncNow(); return 'synced'; })()`,
  );
}
async function folderEntry(cdp, path) {
  const r = await cdp.eval(`(() => { const p = app.plugins?.plugins?.vaultsyncforagents; const e = p?.client?.currentIndex?.()?.[${jstr('/' + path)}];
    return e ? { isFolder: !!e.isFolder, deletedAt: e.deletedAt ?? null, versionId: e.versionId } : null; })()`);
  if (!r.ok) throw new Error(`folderEntry eval: ${r.error}`);
  return r.value;
}
/**
 * Delete an empty folder the way a user does: fileManager.trashFile on the
 * TFolder (the fix's own removeEmptyDir path). Falls back to Obsidian's
 * DataAdapter.rmdir — documented to refuse EVERY directory (EISDIR).
 * Returns which method worked.
 */
async function deleteEmptyFolder(cdp, path) {
  const trash = await cdp.eval(`(async () => {
    const af = app.vault.getAbstractFileByPath(${jstr(path)});
    if (!af) return 'missing';
    try { await app.fileManager.trashFile(af); return 'trashed'; }
    catch (e) { return 'trash-failed: ' + String(e); } })()`);
  if (!trash.ok) throw new Error(`trashFile eval: ${trash.error}`);
  if (trash.value === 'trashed') return { method: 'fileManager.trashFile(TFolder)', result: 'trashed' };
  if (trash.value === 'missing') return { method: 'none', result: 'missing' };
  const rmdir = await cdp.eval(
    `(async () => { try { await app.vault.adapter.rmdir(${jstr(path)}, false); return 'rmdir-ok'; } catch (e) { return 'rmdir-failed: ' + String(e); } })()`,
  );
  if (!rmdir.ok) throw new Error(`adapter.rmdir eval: ${rmdir.error}`);
  return { method: 'adapter.rmdir (fallback)', result: rmdir.value, trashFileFirstAttempt: trash.value };
}
/** Attach a Network-domain capture for /api/status requests to a live session. */
function attachNetCapture(cdp) {
  const captured = [];
  cdp.ws.addEventListener('message', (ev) => {
    let m;
    try {
      m = JSON.parse(ev.data);
    } catch {
      return;
    }
    if (m.method === 'Network.requestWillBeSent' && /\/api\/status/.test(m.params?.request?.url ?? '')) {
      captured.push({
        requestId: m.params.requestId,
        url: m.params.request.url,
        method: m.params.request.method,
        ts: new Date().toISOString(),
      });
    } else if (m.method === 'Network.responseReceived') {
      const hit = captured.find((x) => x.requestId === m.params.requestId && x.status === undefined);
      if (hit) hit.status = m.params.response.status;
    }
  });
  return captured;
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
  // ---- prep: worker health + live CORS proof + fixed-bundle freshness + name freshness ----
  {
    const s = step(
      'prep',
      '/health claimed; live OPTIONS /api/status preflight carries ACAO (worker-side F-2); fixed plugin bundles (removeDir wired) in BOTH vaults; run folder names unused',
    );
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
    for (const [name, dir] of [
      ['TestVault4', PLUGIN_DIR4],
      ['TestVault5', PLUGIN_DIR5],
    ]) {
      const mainJs = join(dir, 'main.js');
      bundle[name] = {
        built: statSync(mainJs).mtime.toISOString(),
        removeDirOccurrences: (readFileSync(mainJs, 'utf8').match(/removeDir/g) ?? []).length,
      };
    }
    // Name freshness: neither this run's folder may exist on disk in EITHER vault.
    const diskClash = {};
    for (const [vn, dir] of [
      ['vault4', V4_DIR],
      ['vault5', V5_DIR],
    ]) {
      for (const f of [PINGPONG, PRUNE]) {
        if (existsSync(join(dir, f))) (diskClash[vn] ??= []).push(f);
      }
    }
    // Prior-run litter currently on disk (reported here, removed at teardown).
    const litterNow = {};
    for (const [vn, dir] of [
      ['vault4', V4_DIR],
      ['vault5', V5_DIR],
    ]) {
      litterNow[vn] = readdirSync(dir).filter((d) => LITTER_PREFIXES.some((p) => d.startsWith(p)));
    }
    const detail = {
      health: health.body,
      liveApiStatusPreflight: {
        status: preflight.status,
        acao: preflight.headers.get('access-control-allow-origin'),
        ok: preflightOk,
      },
      pluginBundles: bundle,
      runFolders: { pingpong: PINGPONG, prune: PRUNE },
      diskClash,
      priorLitterOnDiskAtStart: litterNow,
    };
    if (!preflightOk) throw new Error(`live /api/status preflight lacks CORS: ${fmt(detail.liveApiStatusPreflight)}`);
    if (Object.values(bundle).some((b) => b.removeDirOccurrences === 0))
      throw new Error(`bundle missing removeDir: ${fmt(bundle)}`);
    if (Object.keys(diskClash).length > 0) throw new Error(`run folder names already on disk: ${fmt(diskClash)}`);
    s.pass(detail);
  }

  // ---- A: launch both instances; plugins auto-reconnect live ----
  {
    const s = step('A-launch', 'launch both vaults via e2e-hardened-profile{,-b} + CDP 9222/9223 (NO --disable-web-security) — plugins auto-reconnect and BOTH reach state live');
    try {
      const { spawn } = await import('node:child_process');
      await execFileP('taskkill', ['/F', '/IM', 'Obsidian.exe']).catch(() => {});
      await sleep(1500);
      const pidA = spawn(OBSIDIAN_EXE, [`--user-data-dir=${PROFILE_A}`, `--remote-debugging-port=${PORT_A}`], {
        detached: true,
        stdio: 'ignore',
      }).pid;
      const pidB = spawn(OBSIDIAN_EXE, [`--user-data-dir=${PROFILE_B}`, `--remote-debugging-port=${PORT_B}`], {
        detached: true,
        stdio: 'ignore',
      }).pid;
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
      const [a, b] = await Promise.all([ready(CDP_A, 'TestVault4', 'vault4'), ready(CDP_B, 'TestVault5', 'vault5')]);
      cdp4 = a;
      cdp5 = b;
      report.pids = { obsidianVault4: pidA, obsidianVault5: pidB };
      const live = {};
      for (const [name, cdp] of [
        ['vault4', cdp4],
        ['vault5', cdp5],
      ]) {
        const st = await waitFor(async () => {
          const ps = await pluginStatus(cdp);
          return ps?.statusBar?.startsWith('vsa ✓') && ps?.status?.state === 'live' ? ps : null;
        }, 45_000, 1000, `${name} live+✓`);
        live[name] = {
          statusBar: st.value.statusBar,
          state: st.value.status.state,
          deviceId: st.value.deviceId,
          deviceName: st.value.deviceName,
        };
      }
      await sleep(8000); // startup cycles converge
      const settle = {};
      for (const [name, cdp] of [
        ['vault4', cdp4],
        ['vault5', cdp5],
      ]) {
        const ps = await pluginStatus(cdp);
        settle[name] = { state: ps?.status?.state, pending: ps?.status?.pending };
      }
      s.pass({
        headline: 'both clients auto-reconnected live with untouched tokens',
        pids: { vault4: pidA, vault5: pidB },
        vaults: live,
        postSettle: settle,
      });
    } catch (e) {
      s.fail(String(e.message ?? e));
      throw e;
    }
  }

  // ---- B: F-1 acceptance — empty-folder tombstone must not ping-pong ----
  {
    const s = step(
      'B-f1-pingpong',
      `F-1: create EMPTY '${PINGPONG}' in vault4 → placeholder reaches vault5 ≤30s → delete the empty folder in vault4 (trashFile, fallback adapter.rmdir) → gone from vault5 ≤40s → does NOT reappear in either vault across two rescan cycles (~40s) → /api/history has NO edit version after the delete version`,
    );
    const runOnce = async () => {
      // 1. create the empty folder in vault4 (fresh name — must succeed cleanly)
      const mk = await cdp4.eval(`(async () => {
        try { await app.vault.createFolder(${jstr(PINGPONG)}); return 'created'; }
        catch (e) { return 'create-failed: ' + String(e); } })()`);
      if (!mk.ok || mk.value !== 'created') throw new Error(`createFolder '${PINGPONG}' in vault4: ${fmt(mk)}`);
      await syncNow(cdp4);

      // 2. placeholder reaches vault5 ≤30s (one syncNow poke + 15s grace allowed, recorded)
      let pokeUsed = false;
      let reached;
      try {
        reached = await waitFor(async () => ((await exists(cdp5, PINGPONG)) ? true : null), 30_000, 400, 'placeholder reaches vault5');
      } catch {
        pokeUsed = true;
        await syncNow(cdp4);
        await syncNow(cdp5);
        reached = await waitFor(async () => ((await exists(cdp5, PINGPONG)) ? true : null), 15_000, 400, 'placeholder reaches vault5 (poked)');
      }
      const v5Live = await waitFor(async () => {
        const e = await folderEntry(cdp5, PINGPONG);
        return e?.isFolder && e.deletedAt === null ? e : null;
      }, 20_000, 400, 'vault5 placeholder live in index');
      await sleep(3000); // settle both sides

      // 3. delete the EMPTY folder in vault4
      const markerTs = Date.now();
      const del = await deleteEmptyFolder(cdp4, PINGPONG);
      if (del.result !== 'trashed' && del.result !== 'rmdir-ok') throw new Error(`delete failed: ${fmt(del)}`);
      log(`  delete method: ${del.method} (${del.result})`);
      await syncNow(cdp4);

      // 4. placeholder must disappear from vault5 ≤40s (disk-level check)
      await waitFor(async () => ((await exists(cdp5, PINGPONG)) ? null : true), 40_000, 500, 'placeholder gone from vault5');
      const goneMs = Date.now() - markerTs;
      const v5EntryAfter = await folderEntry(cdp5, PINGPONG);

      // 5. NO resurrection: sample BOTH vaults across two rescan cycles (~40s)
      const samples = [];
      for (let i = 0; i <= 8; i++) {
        const [f4, f5] = await Promise.all([exists(cdp4, PINGPONG), exists(cdp5, PINGPONG)]);
        samples.push({ t_s: i * 5, v4Folder: f4, v5Folder: f5 });
        if (i < 8) await sleep(5000);
      }
      const resurrected = samples.filter((x) => x.v4Folder || x.v5Folder);
      if (resurrected.length > 0) throw new Error(`folder RESURRECTED during observation: ${fmt(samples)}`);

      // 6. worker history: NO edit version after the delete version
      cookie = cookie ?? (await adminLogin());
      const hist = await wk(`/api/history?path=${encodeURIComponent('/' + PINGPONG)}`, { headers: { cookie } });
      const versions = hist.body?.versions ?? [];
      const head = hist.body?.head;
      const newest = versions[0];
      const deleteTs = Math.max(0, ...versions.filter((v) => v.kind === 'delete').map((v) => v.ts));
      const editsAfterDelete = versions.filter((v) => v.kind === 'edit' && v.ts > deleteTs);
      const history = {
        status: hist.status,
        head: head ? { versionId: head.versionId, deleted: head.deleted } : null,
        versionsNewestFirst: versions.map((v) => ({ id: v.id, kind: v.kind, deviceId: v.deviceId, ts: v.ts })),
      };
      if (head?.deleted !== true) throw new Error(`history head not deleted: ${fmt(history)}`);
      if (newest?.kind !== 'delete')
        throw new Error(`PING-PONG: newest history version is ${fmt(newest)}, expected the delete — ${fmt(history)}`);
      if (editsAfterDelete.length > 0)
        throw new Error(`PING-PONG: ${editsAfterDelete.length} edit(s) pushed AFTER the delete — ${fmt(history)}`);

      return {
        deleteMethod: del,
        placeholderReachedV5Ms: reached.elapsedMs,
        syncNowPokeNeeded: pokeUsed,
        placeholderGoneFromV5Ms: goneMs,
        vault5IndexTombstoned: !!v5EntryAfter?.deletedAt,
        folderObservation40s: samples,
        workerHistory: history,
        verdict:
          'empty-folder delete propagated, peer local dir removed, no edit-after-delete in history, deleting side stayed deleted across two rescan cycles',
      };
    };
    const r = await withRetry(runOnce);
    if (r.ok) s.pass(r.result);
    else s.fail({ error: String(r.error?.message ?? r.error), firstError: String(r.firstError?.message ?? '') });
  }

  // ---- C: prune acceptance — emptied folder prunes on BOTH sides ----
  {
    const s = step(
      'C-prune',
      `prune: create '${PRUNE}' in vault5 WITH keep.md → synced to vault4 → delete keep.md in vault4 (app.vault.delete) → keep.md gone in vault5 AND '${PRUNE}' pruned on BOTH sides ≤40s → still gone one more rescan cycle (~35s)`,
    );
    const runOnce = async () => {
      const content = `keep me ${Date.now()}`;
      // pitfall: app.vault.create does NOT mkdir parents — createFolder FIRST
      const mk = await cdp5.eval(`(async () => {
        await app.vault.createFolder(${jstr(PRUNE)});
        await app.vault.create(${jstr(PRUNE + '/keep.md')}, ${jstr(content)});
        return 'created'; })()`);
      if (!mk.ok) throw new Error(`create ${PRUNE}/keep.md in vault5: ${mk.error}`);
      await syncNow(cdp5);
      let toV4;
      try {
        toV4 = await waitFor(async () => ((await exists(cdp4, PRUNE + '/keep.md')) ? true : null), 35_000, 400, 'keep.md arrives vault4');
      } catch {
        await syncNow(cdp5);
        toV4 = await waitFor(async () => ((await exists(cdp4, PRUNE + '/keep.md')) ? true : null), 20_000, 400, 'keep.md arrives vault4 (poked)');
        log('  (needed a syncNow poke for v5→v4)');
      }
      await sleep(3000); // settle

      const del = await cdp4.eval(
        `(async () => { const f = app.vault.getAbstractFileByPath(${jstr(PRUNE + '/keep.md')}); if (!f) return 'missing'; await app.vault.delete(f); return 'deleted'; })()`,
      );
      if (!del.ok || del.value !== 'deleted') throw new Error(`delete keep.md in vault4: ${fmt(del)}`);
      await syncNow(cdp4);

      // poll vault5 40s: keep.md gone AND folder pruned on BOTH sides
      const samples = [];
      let fileGoneMs = null;
      const t0 = Date.now();
      for (let i = 0; i <= 20; i++) {
        const [keep5, f4, f5] = await Promise.all([
          exists(cdp5, PRUNE + '/keep.md'),
          exists(cdp4, PRUNE),
          exists(cdp5, PRUNE),
        ]);
        if (keep5 === false && fileGoneMs === null) fileGoneMs = Date.now() - t0;
        samples.push({ t_s: Math.round((Date.now() - t0) / 1000), v5KeepMd: keep5, v4Folder: f4, v5Folder: f5 });
        if (!keep5 && !f4 && !f5) break;
        if (Date.now() - t0 > 40_000) break;
        await sleep(2000);
      }
      const last = samples[samples.length - 1];
      if (last.v5KeepMd) throw new Error(`keep.md still present in vault5 ≥40s: ${fmt(samples)}`);
      if (last.v4Folder) throw new Error(`emptied '${PRUNE}' NOT pruned on deleting side (vault4) ≥40s: ${fmt(samples)}`);
      if (last.v5Folder) throw new Error(`emptied '${PRUNE}' NOT pruned on receiving side (vault5) ≥40s: ${fmt(samples)}`);

      // one more rescan cycle (~35s): still gone everywhere
      const post = [];
      for (let i = 0; i <= 7; i++) {
        const [keep5, f4, f5] = await Promise.all([
          exists(cdp5, PRUNE + '/keep.md'),
          exists(cdp4, PRUNE),
          exists(cdp5, PRUNE),
        ]);
        post.push({ t_s: i * 5, v5KeepMd: keep5, v4Folder: f4, v5Folder: f5 });
        if (i < 7) await sleep(5000);
      }
      const bad = post.filter((x) => x.v5KeepMd || x.v4Folder || x.v5Folder);
      if (bad.length > 0) throw new Error(`pruned folder/file RESURRECTED next cycle: ${fmt(post)}`);

      return {
        v5toV4SyncMs: toV4.elapsedMs,
        keepMdGoneInV5Ms: fileGoneMs,
        pruneObservation: samples,
        nextCycleObservation: post,
        verdict: 'remote file delete propagated AND emptied folder pruned on BOTH sides, stable across an extra rescan cycle',
      };
    };
    const r = await withRetry(runOnce);
    if (r.ok) s.pass(r.result);
    else s.fail({ error: String(r.error?.message ?? r.error), firstError: String(r.firstError?.message ?? '') });
  }

  // ---- D: F-2 acceptance — About storage line renders via /api/status ----
  {
    const s = step(
      'D-f2-about',
      'F-2: open vault4 settings → VaultSync tab → About section → "Vault storage" line renders non-empty real text ≤15s with ZERO console errors; network capture shows GET /api/status and its status',
    );
    try {
      // Renderer-side cross-origin fetch FIRST (independent evidence the CORS
      // fix works even if the DOM capture below races).
      const direct = await cdp4.eval(`(async () => {
        const p = app.plugins.plugins.vaultsyncforagents;
        const res = await fetch(p.data.url + '/api/status', { headers: { authorization: 'Bearer ' + p.data.token } });
        const body = await res.json().catch(() => null);
        return { status: res.status, storageBytes: body?.storageBytes, devices: (body?.devices ?? []).length }; })()`);
      // Network capture + console window around the settings open
      await cdp4.send('Network.enable').catch(() => {});
      const netLog = attachNetCapture(cdp4);
      const before = cdp4.consoleLog.length;
      await cdp4.eval(`(async () => { app.setting.open(); return 'opened'; })()`);
      await waitFor(async () => {
        const r = await cdp4.eval(`document.querySelectorAll('.setting-item').length`);
        return r.ok && r.value > 0 ? true : null;
      }, 10_000, 300, 'settings modal renders');
      await cdp4.eval(`(async () => { app.setting.openTabById('vaultsyncforagents'); return 'tab'; })()`);
      let descOutcome;
      try {
        descOutcome = await waitFor(async () => {
          const r = await cdp4.eval(`(() => {
            const item = [...document.querySelectorAll('.setting-item')].find(el => el.querySelector('.setting-item-name')?.textContent === 'Vault storage');
            const t = item?.querySelector('.setting-item-description')?.textContent ?? null;
            if (t === null || t === '' ) return null;
            if (t === 'Checking the worker…') return null; // still loading
            return t; })()`);
          return r.ok && typeof r.value === 'string' ? r.value : null;
        }, 15_000, 400, 'About storage line renders');
      } catch (e) {
        descOutcome = { timeout: true, error: String(e.message ?? e) };
      }
      const consoleHits = cdp4.consoleLog.slice(before);
      const statusRequests = netLog.map(({ requestId, ...rest }) => rest);
      await cdp4.eval(`(() => { try { app.setting.close(); } catch (e) {} return 'closed'; })()`);

      const detail = {
        storageLine: descOutcome.timeout ? null : descOutcome.value,
        directRendererFetch: direct.ok ? direct.value : `eval failed: ${direct.error}`,
        apiStatusRequestsDuringAbout: statusRequests,
        consoleEntriesDuringAbout: consoleHits.map((e) => ({ level: e.level, text: String(e.text).slice(0, 220) })),
      };
      if (!descOutcome.timeout) {
        const errors = consoleHits.filter((e) => String(e.level).toLowerCase() === 'error');
        if (errors.length > 0) throw new Error(`console errors during About render: ${fmt(errors)}`);
        if (!direct.ok || direct.value?.status !== 200) throw new Error(`renderer /api/status fetch failed: ${fmt(direct)}`);
        if (!/^Storage used: /.test(descOutcome.value))
          throw new Error(`storage line rendered but not real data: ${jstr(descOutcome.value)}`);
        s.pass({ ...detail, verdict: 'About storage line rendered real data via GET /api/status with zero console errors' });
      } else {
        // Timeout classification: product-bug vs drive-bug, with evidence.
        const req = statusRequests.find((r) => r.method === 'GET');
        const corsConsole = consoleHits.filter((e) => /CORS|Access-Control-Allow-Origin|ERR_FAILED/i.test(e.text));
        let classification;
        if (req === undefined) {
          classification =
            'drive-bug-or-product-bug-ambiguous: NO GET /api/status was even issued while the tab was open (fetch never triggered — tab/section wiring or render race)';
        } else if (req.status === undefined || req.status === 0 || corsConsole.length > 0) {
          classification = 'product-bug: GET /api/status issued but failed at the network/CORS layer';
        } else if (req.status !== 200) {
          classification = `product-bug: GET /api/status returned HTTP ${req.status}`;
        } else {
          classification = 'product-bug: GET /api/status returned 200 but the storage line never rendered (response handling/render bug)';
        }
        s.fail({
          ...detail,
          storageLineTimeout: descOutcome.error,
          classification,
        });
      }
    } catch (e) {
      await cdp4
        .eval(`(() => { try { app.setting.close(); } catch (x) {} return 'closed'; })()`)
        .catch(() => {});
      s.fail(String(e.message ?? e));
    }
  }

  // ---- E: final sanity ----
  {
    const s = step('E-sanity', 'final sanity: both plugins live/pending 0/conflicts 0/statusBar ✓; ZERO console errors across BOTH sessions');
    try {
      await sleep(2000);
      const [p4, p5] = await Promise.all([pluginStatus(cdp4), pluginStatus(cdp5)]);
      const [c4, c5] = await Promise.all([conflictFiles(cdp4), conflictFiles(cdp5)]);
      const bad = [];
      for (const [name, st] of [
        ['vault4', p4],
        ['vault5', p5],
      ]) {
        if (st?.status?.state !== 'live') bad.push(`${name} state=${st?.status?.state}`);
        if (st?.status?.pending !== 0) bad.push(`${name} pending=${st?.status?.pending}`);
        if ((st?.status?.conflicts ?? []).length !== 0) bad.push(`${name} conflicts=${fmt(st?.status?.conflicts)}`);
        if (!st?.statusBar?.startsWith('vsa ✓')) bad.push(`${name} statusBar=${st?.statusBar}`);
      }
      if (c4.length || c5.length) bad.push(`conflict files: v4=${fmt(c4)} v5=${fmt(c5)}`);
      const allErrors = [...cdp4.consoleLog, ...cdp5.consoleLog].filter((e) => String(e.level).toLowerCase() === 'error');
      if (allErrors.length > 0) bad.push(`${allErrors.length} console error(s): ${fmt(allErrors.slice(0, 6))}`);
      const detail = {
        vault4: { state: p4.status.state, pending: p4.status.pending, statusBar: p4.statusBar },
        vault5: { state: p5.status.state, pending: p5.status.pending, statusBar: p5.statusBar, deviceName: p5.deviceName },
        conflictFiles: { vault4: c4, vault5: c5 },
        sessionErrorEntries: allErrors.length,
      };
      if (bad.length > 0) s.fail({ ...detail, verdict: bad.join('; ') });
      else s.pass({ ...detail, verdict: 'all green — zero console errors across both sessions' });
    } catch (e) {
      s.fail(String(e.message ?? e));
    }
  }
} catch (fatal) {
  lines.push(`[FATAL] ${String(fatal?.stack ?? fatal)}`);
  report.fatalNote = String(fatal?.message ?? fatal);
} finally {
  const consoles = {};
  if (cdp4) consoles.vault4 = cdp4.consoleLog;
  if (cdp5) consoles.vault5 = cdp5.consoleLog;
  report.consoleProblems = {};
  for (const [name, entries] of Object.entries(consoles)) {
    report.consoleProblems[name] = entries.filter((e) =>
      ['error', 'warning', 'warn'].includes(String(e.level).toLowerCase()),
    );
  }
  // worker PID(s) listening on 8797 (worker LEFT RUNNING)
  try {
    const { stdout } = await execFileP('netstat', ['-ano']).catch(() => ({ stdout: '' }));
    const pids = [
      ...new Set(
        stdout
          .split('\n')
          .filter((l) => /:8797\s/.test(l) && /LISTENING/i.test(l))
          .map((l) => l.trim().split(/\s+/).pop()),
      ),
    ];
    report.workerLeftRunning = {
      url: WORKER,
      listeningPids: pids,
      note: 'wrangler dev --port 8797 --persist-to .wrangler/devstate-testvault (user dogfood room) — LEFT RUNNING',
    };
  } catch {
    report.workerLeftRunning = { url: WORKER, note: 'left running (PID capture failed)' };
  }
  report.finishedAt = new Date().toISOString();
  const failed = report.steps.filter((x) => x.status === 'FAIL' || x.status === 'RUNNING').length;
  const passed = report.steps.filter((x) => x.status === 'PASS').length;
  report.overall = failed === 0 ? 'PASS' : 'FAIL';
  report.overallNotes = [
    'Clean acceptance re-run (unique per-run folder names) for the F-1/F-2 fix build against the live dogfood room.',
    'B = F-1: empty-folder tombstone must propagate, remove the peer local dir, and NEVER resurrect (no edit-after-delete in /api/history).',
    'C = prune: emptied folder must prune on BOTH sides and stay pruned an extra rescan cycle.',
    'D = F-2: About "Vault storage" must render real data via GET /api/status with zero console errors.',
  ];
  exitCode = failed === 0 ? 0 : 1;
  lines.push('');
  lines.push(`SUMMARY: ${passed} PASS, ${failed} FAIL — overall ${report.overall}`);
  for (const [name, entries] of Object.entries(report.consoleProblems)) {
    for (const c of entries.slice(-8)) lines.push(`  [${name} ${c.level}] ${c.text.slice(0, 200)}`);
  }
  try {
    writeFileSync(join(HERE, 'report-fix-verify2.json'), JSON.stringify(report, null, 2));
  } catch {
    /* best effort */
  }
  cdp4?.close();
  cdp5?.close();
  // TEARDOWN: kill Obsidian; remove THIS run's + prior runs' litter test
  // folders from BOTH vaults on disk (indexes hold placeholders → next launch
  // tombstones and propagates — converges clean); LEAVE the 8797 worker RUNNING.
  await execFileP('taskkill', ['/F', '/IM', 'Obsidian.exe']).catch(() => {});
  await sleep(1500);
  const removed = [];
  for (const dir of [V4_DIR, V5_DIR]) {
    try {
      for (const d of readdirSync(dir)) {
        if (LITTER_PREFIXES.some((p) => d.startsWith(p))) {
          const p = join(dir, d);
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
    } catch {
      /* best effort */
    }
  }
  decide(
    `teardown removed litter test folders on disk from both vaults: ${removed.length ? removed.join(', ') : 'none present'} (dogfood pairing/config untouched)`,
  );
  lines.push('TEARDOWN: Obsidian killed; worker 8797 LEFT RUNNING; both vaults LEFT PAIRED+SYNCED.');
  console.log(lines.join('\n'));
  process.exit(exitCode);
}
