/**
 * FIX-VERIFY #2b — HARDENED clean re-run of steps B/C/D (+ sanity) for F-1/F-2,
 * after run #1 (scenario-fix-verify2.mjs) left open questions. Hardening per
 * post-mortem of run #1:
 *   - CDP liveness guard (raw Runtime.evaluate '1+1' === 2 AND typeof app)
 *     before every eval batch; on failure the step STOPS with the raw dump.
 *   - Every cdp.eval result must be {ok:true} with the expected shape — a bad
 *     eval aborts the step immediately instead of polling on.
 *   - SINGLE execution per setup mutation: NO internal retry re-runs
 *     createFolder/create/delete (run #1's "Folder already exists" was exactly
 *     that harness artifact).
 *   - Fresh unique folder names (new RUN_TAG, never used in any prior run).
 *   - Step D captures evidence in ALL paths: Network-domain capture of
 *     GET /api/status, progressive DOM state if the modal is slow, console
 *     window, and a screenshot whether it renders or times out.
 *
 * Writes scripts/e2e/report-fix-verify2-run2.json (merged into
 * report-fix-verify2.json afterwards). Kills Obsidian at the end; LEAVES the
 * worker RUNNING; vaults stay paired+synced.
 * Usage: node scripts/e2e/scenario-fix-verify3.mjs
 */

import { execFile } from 'node:child_process';
import { existsSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
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

// Fresh names — RUN_TAG differs from run #1's v2mt2vfq2x by construction
// (later timestamp) and is asserted unused in prep.
const RUN_TAG = `r2${Date.now().toString(36)}`;
const PINGPONG = `pingpong-check-${RUN_TAG}`;
const PRUNE = `prune-check-${RUN_TAG}`;
const LITTER_PREFIXES = ['pingpong-check-', 'prune-check-', 'tempfolder', 'resurrect', 'rmdir-probe-'];

const jstr = JSON.stringify;

// --- reporting -----------------------------------------------------------------------------------

const report = {
  startedAt: new Date().toISOString(),
  worker: WORKER,
  purpose:
    'HARDENED re-run of B/C/D for F-1/F-2 (run #2): CDP liveness guards, single-execution setup, fresh names, full evidence capture',
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

// --- hardened CDP driving --------------------------------------------------------------------------

/**
 * Liveness guard: raw Runtime.evaluate over the socket (NOT the wrapped eval)
 * must return 2, and `app` must exist. Throws with a raw dump otherwise.
 * NOTE: cdp.send already resolves with the CDP `result` object, so the value
 * sits at raw.result.value (verified against the live endpoint).
 */
async function assertAlive(cdp, label) {
  let raw;
  try {
    raw = await cdp.send('Runtime.evaluate', { expression: '1+1', returnByValue: true });
  } catch (e) {
    throw new Error(`CDP DEAD (${label}): evaluate threw ${String(e)} — connection unusable`);
  }
  const val = raw?.result?.value;
  if (val !== 2) {
    throw new Error(`CDP SUSPECT (${label}): raw 1+1 → ${jstr(raw).slice(0, 400)}`);
  }
  const appProbe = await cdp.eval('typeof app');
  if (!appProbe.ok || appProbe.value !== 'object') {
    throw new Error(`CDP SUSPECT (${label}): typeof app → ${jstr(appProbe).slice(0, 300)}`);
  }
}

/** Eval that REQUIRES ok:true and returns value; throws with raw response otherwise. */
async function evalHard(cdp, expression, label) {
  const r = await cdp.eval(expression);
  if (!r.ok) {
    throw new Error(`eval FAILED (${label}): ${jstr(r).slice(0, 600)}`);
  }
  return r.value;
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

// --- vault helpers (all hardened) --------------------------------------------------------------------

async function exists(cdp, path, label) {
  const v = await evalHard(
    cdp,
    `(async () => { const r = await app.vault.adapter.exists(${jstr(path)}); if (typeof r !== 'boolean') throw new Error('exists returned ' + typeof r); return r; })()`,
    label ?? `exists ${path}`,
  );
  return v === true;
}
async function pluginStatus(cdp) {
  const v = await evalHard(cdp, `(() => { const p = app.plugins?.plugins?.vaultsyncforagents; if (!p) throw new Error('plugin missing');
    return { statusBar: p.statusBarItem?.textContent ?? null, status: p.client?.status?.() ?? null,
      deviceId: p.data?.deviceId ?? null, deviceName: p.data?.deviceName ?? null }; })()`, 'pluginStatus');
  return v;
}
async function conflictFiles(cdp) {
  return evalHard(cdp, `app.vault.getFiles().filter(f => /conflict/i.test(f.path)).map(f => f.path)`, 'conflictFiles');
}
async function syncNow(cdp) {
  return evalHard(cdp, `(async()=>{ const p = app.plugins?.plugins?.vaultsyncforagents;
    if (!p?.syncNow) throw new Error('no syncNow'); await p.syncNow(); return 'synced'; })()`, 'syncNow');
}
async function folderEntry(cdp, path) {
  return evalHard(cdp, `(() => { const p = app.plugins?.plugins?.vaultsyncforagents;
    const e = p?.client?.currentIndex?.()?.[${jstr('/' + path)}];
    return e ? { isFolder: !!e.isFolder, deletedAt: e.deletedAt ?? null, versionId: e.versionId, clock: e.clock } : null; })()`,
    `folderEntry ${path}`);
}
/** Attach Network-domain capture for /api/status requests. Returns the log array. */
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
      captured.push({ url: m.params.request.url, method: m.params.request.method, ts: new Date().toISOString() });
    } else if (m.method === 'Network.responseReceived') {
      const hit = [...captured].reverse().find((x) => x.status === undefined);
      if (hit) hit.status = m.params.response.status;
    }
  });
  return captured;
}
async function screenshot(cdp, file) {
  const shot = await cdp.send('Page.captureScreenshot', { format: 'png' }).catch(() => null);
  if (shot?.data) {
    writeFileSync(join(HERE, file), Buffer.from(shot.data, 'base64'));
    return file;
  }
  return null;
}

// --- main ----------------------------------------------------------------------------------------------

let cookie = null;
let cdp4 = null;
let cdp5 = null;
let exitCode = 0;

process.on('uncaughtException', (e) => {
  lines.push(`[FATAL-uncaught] ${String(e?.stack ?? e)}`);
  report.fatalNote = String(e?.message ?? e);
});

try {
  // ---- prep ----
  {
    const s = step('prep', '/health claimed; /api/status preflight ACAO; fixed bundles; fresh run-folder names; ports 9222/9223 free before launch');
    const health = await wk('/health');
    if (!health.body?.ok) throw new Error(`worker not healthy: ${fmt(health.body)}`);
    const preflight = await fetch(`${WORKER}/api/status`, {
      method: 'OPTIONS',
      headers: { origin: 'app://obsidian.md', 'access-control-request-method': 'GET', 'access-control-request-headers': 'authorization' },
      signal: AbortSignal.timeout(10_000),
    });
    const preflightOk = preflight.status === 204 && preflight.headers.get('access-control-allow-origin') === '*';
    const diskClash = {};
    for (const [vn, dir] of [
      ['vault4', V4_DIR],
      ['vault5', V5_DIR],
    ]) {
      for (const f of [PINGPONG, PRUNE]) {
        if (existsSync(join(dir, f))) (diskClash[vn] ??= []).push(f);
      }
    }
    let portFree = {};
    for (const [name, port] of [
      ['9222', PORT_A],
      ['9223', PORT_B],
    ]) {
      try {
        await fetch(`http://127.0.0.1:${port}/json`, { signal: AbortSignal.timeout(2000) });
        (portFree[name] = portFree[name] ?? []).push('RESPONDED pre-launch (unexpected)');
      } catch {
        portFree[name] = 'free';
      }
    }
    const detail = {
      health: health.body,
      liveApiStatusPreflight: { status: preflight.status, acao: preflight.headers.get('access-control-allow-origin'), ok: preflightOk },
      runFolders: { pingpong: PINGPONG, prune: PRUNE },
      diskClash,
      cdpPortsBeforeLaunch: portFree,
    };
    if (!preflightOk) throw new Error(`preflight lacks CORS: ${fmt(detail.liveApiStatusPreflight)}`);
    if (Object.keys(diskClash).length > 0) throw new Error(`names already on disk: ${fmt(diskClash)}`);
    s.pass(detail);
  }

  // ---- A: launch both; assert live ----
  {
    const s = step('A-launch', 'launch both vaults via profiles + CDP 9222/9223 — plugins auto-reconnect live (asserted via hardened pluginStatus)');
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
          // Reconnect whenever the session is missing OR dead (Obsidian can
          // reload its renderer during boot, killing the WebSocket silently).
          if (cdp !== null) {
            let alive = false;
            try {
              const r = await cdp.send('Runtime.evaluate', { expression: '1+1', returnByValue: true });
              alive = r?.result?.value === 2;
            } catch {
              alive = false;
            }
            if (!alive) {
              log(`  (${label}: CDP session died — reconnecting)`);
              try {
                cdp.close();
              } catch {
                /* already closed */
              }
              cdp = null;
            }
          }
          if (cdp === null) {
            try {
              cdp = await connectPage({ match, http });
            } catch {
              return null;
            }
          }
          try {
            await assertAlive(cdp, `${label} boot`);
          } catch (e) {
            log(`  (${label}: assertAlive failed — ${String(e.message ?? e).slice(0, 160)})`);
            try {
              cdp.close();
            } catch {
              /* already closed */
            }
            cdp = null;
            return null;
          }
          const probe = await cdp.eval('!!(app.plugins?.plugins?.vaultsyncforagents)');
          return probe.ok && probe.value === true ? true : null;
        }, 180_000, 1500, `${label} plugin loaded`);
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
        await assertAlive(cdp, `${name} post-load`);
        const st = await waitFor(async () => {
          const ps = await pluginStatus(cdp);
          return ps?.statusBar?.startsWith('vsa ✓') && ps?.status?.state === 'live' ? ps : null;
        }, 45_000, 1000, `${name} live+✓`);
        live[name] = { statusBar: st.value.statusBar, state: st.value.status.state, deviceId: st.value.deviceId, deviceName: st.value.deviceName };
      }
      await sleep(8000);
      const settle = {};
      for (const [name, cdp] of [
        ['vault4', cdp4],
        ['vault5', cdp5],
      ]) {
        const ps = await pluginStatus(cdp);
        settle[name] = { state: ps?.status?.state, pending: ps?.status?.pending };
      }
      s.pass({ headline: 'both clients auto-reconnected live', pids: { vault4: pidA, vault5: pidB }, vaults: live, postSettle: settle });
    } catch (e) {
      s.fail(String(e.message ?? e));
      throw e;
    }
  }

  // ---- B: F-1 (single execution setup; no re-create retry) ----
  {
    const s = step(
      'B-f1-pingpong',
      `F-1 (hardened): create EMPTY '${PINGPONG}' in vault4 ONCE → placeholder reaches vault5 ≤30s → delete empty folder in vault4 ONCE (trashFile, fallback adapter.rmdir) → gone from vault5 ≤40s → no resurrection across two rescan cycles (~40s) → history has NO edit after the delete`,
    );
    try {
      await assertAlive(cdp4, 'B start');
      await assertAlive(cdp5, 'B start');

      // SETUP (once): create + wait propagation
      const created = await evalHard(cdp4, `(async () => {
        try { await app.vault.createFolder(${jstr(PINGPONG)}); return 'created'; }
        catch (e) { return 'create-failed: ' + String(e); } })()`, 'B createFolder');
      if (created !== 'created') throw new Error(`setup createFolder returned ${jstr(created)} — ABORT (no retry by design)`);
      await syncNow(cdp4);

      let pokeUsed = false;
      let reachedMs;
      try {
        reachedMs = (await waitFor(async () => ((await exists(cdp5, PINGPONG, 'B reach')) ? true : null), 30_000, 400, 'placeholder reaches vault5')).elapsedMs;
      } catch (e) {
        pokeUsed = true;
        log(`  first 30s window elapsed (${String(e.message).slice(0, 120)}) — one syncNow poke, +15s grace`);
        await syncNow(cdp4);
        await syncNow(cdp5);
        reachedMs = (await waitFor(async () => ((await exists(cdp5, PINGPONG, 'B reach poked')) ? true : null), 15_000, 400, 'placeholder reaches vault5 (poked)')).elapsedMs;
      }
      const v5EntryLive = await waitFor(async () => {
        const e = await folderEntry(cdp5, PINGPONG);
        return e?.isFolder && e.deletedAt === null ? e : null;
      }, 20_000, 400, 'vault5 placeholder live in index');
      await sleep(3000);

      // DELETE (once)
      const markerTs = Date.now();
      const delDetail = await evalHard(cdp4, `(async () => {
        const af = app.vault.getAbstractFileByPath(${jstr(PINGPONG)});
        if (!af) return { method: 'none', result: 'missing' };
        try { await app.fileManager.trashFile(af); return { method: 'fileManager.trashFile(TFolder)', result: 'trashed' }; }
        catch (te) {
          try { await app.vault.adapter.rmdir(${jstr(PINGPONG)}, false); return { method: 'adapter.rmdir (fallback)', result: 'rmdir-ok', trashError: String(te) }; }
          catch (re) { return { method: 'both', result: 'failed', trashError: String(te), rmdirError: String(re) }; } } })()`, 'B delete');
      if (delDetail.result !== 'trashed' && delDetail.result !== 'rmdir-ok') throw new Error(`delete failed: ${jstr(delDetail)}`);
      log(`  delete method: ${delDetail.method} (${delDetail.result})`);
      await syncNow(cdp4);

      // ASSERT: gone from vault5 ≤40s
      let goneFromV5 = true;
      let goneMs = null;
      const g0 = Date.now();
      try {
        await waitFor(async () => ((await exists(cdp5, PINGPONG, 'B gone-poll')) ? null : true), 40_000, 500, 'placeholder gone from vault5');
        goneMs = Date.now() - g0;
      } catch {
        goneFromV5 = false;
      }
      const v5EntryAfter = await folderEntry(cdp5, PINGPONG);

      // ASSERT: no resurrection across two rescan cycles (~40s)
      const samples = [];
      for (let i = 0; i <= 8; i++) {
        const [f4, f5] = await Promise.all([
          exists(cdp4, PINGPONG, 'B obs v4'),
          exists(cdp5, PINGPONG, 'B obs v5'),
        ]);
        samples.push({ t_s: i * 5, v4Folder: f4, v5Folder: f5 });
        if (i < 8) await sleep(5000);
      }
      const resurrected = samples.filter((x) => x.v4Folder || x.v5Folder);

      // worker history
      cookie = cookie ?? (await adminLogin());
      const hist = await wk(`/api/history?path=${encodeURIComponent('/' + PINGPONG)}`, { headers: { cookie } });
      const versions = hist.body?.versions ?? [];
      const head = hist.body?.head;
      const newest = versions[0];
      const deleteTs = Math.max(0, ...versions.filter((v) => v.kind === 'delete').map((v) => v.ts));
      const editsAfterDelete = versions.filter((v) => v.kind === 'edit' && v.ts > deleteTs);

      const detail = {
        deleteMethod: delDetail,
        placeholderReachedV5Ms: reachedMs,
        syncNowPokeNeeded: pokeUsed,
        v5IndexEntryWhileLive: { isFolder: v5EntryLive.value.isFolder, deletedAt: v5EntryLive.value.deletedAt },
        goneFromV5Within40s: goneFromV5,
        goneMs,
        v5IndexEntryAfterWindow: v5EntryAfter,
        folderObservation40s: samples,
        resurrectedSamples: resurrected.length,
        workerHistory: {
          status: hist.status,
          head: head ? { versionId: head.versionId, deleted: head.deleted } : null,
          versionsNewestFirst: versions.map((v) => ({ id: v.id, kind: v.kind, deviceId: v.deviceId, ts: v.ts })),
        },
      };
      if (!goneFromV5) {
        decide(
          `B: vault5 kept the dir ≥40s after the delete while its index entry is ${jstr(v5EntryAfter)} — record-only tombstone application on the receiving side (worker DID record the delete: ${jstr(detail.workerHistory.head)})`,
        );
        throw new Error(`F-1 receiving side: dir NOT removed from vault5 within 40s — ${jstr({ v5EntryAfter, head })}`);
      }
      if (resurrected.length > 0) throw new Error(`folder RESURRECTED during observation: ${fmt(samples)}`);
      if (head?.deleted !== true) throw new Error(`history head not deleted: ${jstr(detail.workerHistory)}`);
      if (newest?.kind !== 'delete') throw new Error(`PING-PONG: newest version ${jstr(newest)} — ${jstr(detail.workerHistory)}`);
      if (editsAfterDelete.length > 0) throw new Error(`PING-PONG: edits after delete — ${jstr(detail.workerHistory)}`);
      s.pass({ ...detail, verdict: 'delete propagated to worker (head deleted, no edit-after-delete); peer local dir removed; no resurrection across two rescan cycles' });
    } catch (e) {
      s.fail(String(e.message ?? e));
      // continue to remaining steps deliberately (report honestly)
    }
  }

  // ---- C: prune (single execution setup) ----
  {
    const s = step(
      'C-prune',
      `prune (hardened): create '${PRUNE}' + keep.md in vault5 ONCE → synced to vault4 → delete keep.md in vault4 ONCE → keep.md gone in vault5 AND folder pruned BOTH sides ≤40s → still gone next cycle (~35s)`,
    );
    try {
      await assertAlive(cdp4, 'C start');
      await assertAlive(cdp5, 'C start');

      // SETUP (once) — pitfall honored: createFolder BEFORE create (no parents made by create)
      const created = await evalHard(cdp5, `(async () => {
        try { await app.vault.createFolder(${jstr(PRUNE)}); } catch (e) { return 'createFolder-failed: ' + String(e); }
        try { await app.vault.create(${jstr(PRUNE + '/keep.md')}, ${jstr(`keep me ${Date.now()}`)}); return 'created'; }
        catch (e) { return 'create-failed: ' + String(e); } })()`, 'C create');
      if (created !== 'created') throw new Error(`setup returned ${jstr(created)} — ABORT (no retry by design)`);
      await syncNow(cdp5);

      let pokeUsed = false;
      let toV4Ms;
      try {
        toV4Ms = (await waitFor(async () => ((await exists(cdp4, PRUNE + '/keep.md', 'C reach')) ? true : null), 35_000, 400, 'keep.md arrives vault4')).elapsedMs;
      } catch {
        pokeUsed = true;
        log('  35s elapsed — one syncNow poke, +20s grace');
        await syncNow(cdp5);
        toV4Ms = (await waitFor(async () => ((await exists(cdp4, PRUNE + '/keep.md', 'C reach poked')) ? true : null), 20_000, 400, 'keep.md arrives vault4 (poked)')).elapsedMs;
      }
      await sleep(3000);

      // DELETE FILE (once)
      const del = await evalHard(cdp4, `(async () => {
        const f = app.vault.getAbstractFileByPath(${jstr(PRUNE + '/keep.md')});
        if (!f) return 'missing';
        await app.vault.delete(f); return 'deleted'; })()`, 'C delete keep.md');
      if (del !== 'deleted') throw new Error(`delete returned ${jstr(del)}`);
      await syncNow(cdp4);

      // POLL 40s: keep.md gone in v5 AND folder pruned BOTH sides
      const samples = [];
      let fileGoneMs = null;
      const t0 = Date.now();
      for (;;) {
        const [keep5, f4, f5] = await Promise.all([
          exists(cdp5, PRUNE + '/keep.md', 'C poll keep'),
          exists(cdp4, PRUNE, 'C poll v4'),
          exists(cdp5, PRUNE, 'C poll v5'),
        ]);
        if (keep5 === false && fileGoneMs === null) fileGoneMs = Math.round((Date.now() - t0) / 100) / 10;
        samples.push({ t_s: Math.round((Date.now() - t0) / 1000), v5KeepMd: keep5, v4Folder: f4, v5Folder: f5 });
        if (!keep5 && !f4 && !f5) break;
        if (Date.now() - t0 > 40_000) break;
        await sleep(2000);
      }
      const last = samples[samples.length - 1];

      // ONE more rescan cycle (~35s)
      const post = [];
      for (let i = 0; i <= 7; i++) {
        const [keep5, f4, f5] = await Promise.all([
          exists(cdp5, PRUNE + '/keep.md', 'C post keep'),
          exists(cdp4, PRUNE, 'C post v4'),
          exists(cdp5, PRUNE, 'C post v5'),
        ]);
        post.push({ t_s: i * 5, v5KeepMd: keep5, v4Folder: f4, v5Folder: f5 });
        if (i < 7) await sleep(5000);
      }
      const badPost = post.filter((x) => x.v5KeepMd || x.v4Folder || x.v5Folder);

      const detail = {
        v5toV4SyncMs: toV4Ms,
        syncNowPokeNeeded: pokeUsed,
        keepMdGoneInV5Sec: fileGoneMs,
        pruneObservation: samples,
        nextCycleObservation: post,
      };
      if (last.v5KeepMd || last.v4Folder || last.v5Folder) {
        decide(
          `C: emptied folder not pruned within 40s — final sample ${jstr(last)}; keep.md itself ${last.v5KeepMd ? 'STILL PRESENT' : 'was removed'} on vault5`,
        );
        throw new Error(`prune incomplete ≥40s: last=${jstr(last)} samples=${jstr(samples.slice(-4))}`);
      }
      if (badPost.length > 0) throw new Error(`resurrected next cycle: ${jstr(post)}`);
      s.pass({ ...detail, verdict: 'file delete propagated AND emptied folder pruned on BOTH sides, stable across an extra rescan cycle' });
    } catch (e) {
      s.fail(String(e.message ?? e));
    }
  }

  // ---- D: F-2 About render (full evidence capture in ALL paths) ----
  {
    const s = step(
      'D-f2-about',
      'F-2 (hardened): vault4 settings → VaultSync tab → About "Vault storage" renders real text ≤15s; network capture proves GET /api/status + status; zero console errors; screenshot either way',
    );
    try {
      await assertAlive(cdp4, 'D start');
      // independent renderer-side cross-origin fetch evidence FIRST
      const direct = await evalHard(cdp4, `(async () => {
        const p = app.plugins.plugins.vaultsyncforagents;
        try {
          const res = await fetch(p.data.url + '/api/status', { headers: { authorization: 'Bearer ' + p.data.token } });
          const body = await res.json().catch(() => null);
          return { status: res.status, storageBytes: body?.storageBytes, devices: (body?.devices ?? []).length };
        } catch (e) { return { threw: String(e) }; } })()`, 'D direct fetch');

      await cdp4.send('Network.enable').catch(() => {});
      const netLog = attachNetCapture(cdp4);
      const beforeOpen = cdp4.consoleLog.length;
      const openResult = await evalHard(cdp4, `(async () => {
        try { await app.setting.open(); return 'opened'; } catch (e) { return 'open-threw: ' + String(e); } })()`, 'D setting.open');
      if (openResult !== 'opened') throw new Error(`app.setting.open() → ${jstr(openResult)}`);

      let modalState = null;
      let modalTimeout = null;
      try {
        modalState = await waitFor(async () => {
          const r = await evalHard(cdp4, `(() => ({
            items: document.querySelectorAll('.setting-item').length,
            modalContainer: !!document.querySelector('.modal-container'),
            settingsEl: !!document.querySelector('.settings'), }))()`, 'D modal poll');
          return r.items > 0 ? r : null;
        }, 25_000, 500, 'settings modal renders');
      } catch (e) {
        modalTimeout = String(e.message ?? e);
        modalState = await evalHard(cdp4, `(() => ({
          items: document.querySelectorAll('.setting-item').length,
          modalContainer: !!document.querySelector('.modal-container'),
          settingsEl: !!document.querySelector('.settings'),
          activeModals: document.querySelectorAll('.modal-container').length, }))()`, 'D dom at timeout').catch((x) => ({ evalError: String(x) }));
      }

      let storageLine = null;
      let storageTimeout = null;
      let aboutSection = null;
      let tabResult = null;
      const beforeStorage = cdp4.consoleLog.length;
      if (!modalTimeout) {
        tabResult = await evalHard(cdp4, `(async () => {
          try { await app.setting.openTabById('vaultsyncforagents'); return 'tab-opened'; } catch (e) { return 'tab-threw: ' + String(e); } })()`, 'D openTab');
        if (tabResult !== 'tab-opened') throw new Error(`openTabById → ${jstr(tabResult)}`);
        try {
          storageLine = (
            await waitFor(async () => {
              const t = await evalHard(cdp4, `(() => {
                const item = [...document.querySelectorAll('.setting-item')].find(el => el.querySelector('.setting-item-name')?.textContent === 'Vault storage');
                const txt = item?.querySelector('.setting-item-description')?.textContent ?? null;
                if (txt === null || txt === '' || txt === 'Checking the worker…') return null;
                return txt; })()`, 'D storage poll');
              return t;
            }, 15_000, 400, 'About storage line renders')
          ).value;
        } catch (e) {
          storageTimeout = String(e.message ?? e);
        }
        aboutSection = await evalHard(cdp4, `(() => {
          const names = [...document.querySelectorAll('.setting-item-name')].map(el => el.textContent);
          return { hasAboutHeading: names.includes('About'), hasStorageItem: names.includes('Vault storage'), itemCount: names.length }; })()`, 'D about section');
      }
      const consoleDuring = cdp4.consoleLog.slice(beforeOpen).map((e) => ({ level: e.level, text: String(e.text).slice(0, 300) }));
      const shotFile = await screenshot(cdp4, modalTimeout ? 'about-modal-timeout-vault4-r2.png' : 'about-rendered-vault4-r2.png');
      await evalHard(cdp4, `(() => { try { app.setting.close(); } catch (e) {} return 'closed'; })()`, 'D close').catch(() => {});

      const statusRequests = netLog.map(({ ...rest }) => rest);
      const detail = {
        directRendererFetch: direct,
        openResult,
        modalState,
        modalTimeout,
        tabResult,
        storageLine,
        storageTimeout,
        aboutSection,
        apiStatusRequestsDuringAbout: statusRequests,
        consoleEntriesDuringAbout: consoleDuring,
        screenshot: shotFile,
      };
      if (modalTimeout) {
        const req = statusRequests.find((r) => r.method === 'GET');
        decide(
          `D: settings modal never rendered .setting-item in 25s (dom=${jstr(modalState)}); GET /api/status issued: ${req ? `yes, status ${req.status}` : 'NO'}; direct renderer fetch=${jstr(direct)}`,
        );
        throw new Error(`settings modal did not render within 25s — dom=${jstr(modalState)}; apiStatusRequests=${jstr(statusRequests)}; directFetch=${jstr(direct)}`);
      }
      const errors = consoleDuring.filter((e) => String(e.level).toLowerCase() === 'error');
      if (errors.length > 0) throw new Error(`console errors during About render: ${jstr(errors)}`);
      if (storageTimeout) {
        const req = statusRequests.find((r) => r.method === 'GET');
        const classification =
          req === undefined
            ? 'product/drive-ambiguous: no GET /api/status observed while tab open'
            : req.status !== 200
              ? `product-bug: GET /api/status → HTTP ${req.status}`
              : 'product-bug: GET /api/status → 200 but storage line never rendered';
        throw new Error(`storage line timeout — ${classification}; requests=${jstr(statusRequests)}`);
      }
      if (!/^Storage used: /.test(storageLine)) throw new Error(`storage line not real data: ${jstr(storageLine)}`);
      if (!direct || direct.status !== 200) throw new Error(`renderer /api/status fetch failed: ${jstr(direct)}`);
      s.pass({
        ...detail,
        verdict: `About storage line rendered "${storageLine}" via GET /api/status (HTTP ${statusRequests.find((r) => r.method === 'GET')?.status ?? '?'}) with zero console errors`,
      });
    } catch (e) {
      await evalHard(cdp4, `(() => { try { app.setting.close(); } catch (x) {} return 'closed'; })()`, 'D close on error').catch(() => {});
      s.fail(String(e.message ?? e));
    }
  }

  // ---- E: sanity ----
  {
    const s = step('E-sanity', 'final sanity: both live/pending 0/conflicts 0/statusBar ✓; ZERO console errors across both sessions');
    try {
      await assertAlive(cdp4, 'E start');
      await assertAlive(cdp5, 'E start');
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
  report.consoleProblems = {};
  for (const [name, entries] of Object.entries({ vault4: cdp4?.consoleLog ?? [], vault5: cdp5?.consoleLog ?? [] })) {
    report.consoleProblems[name] = entries.filter((e) => ['error', 'warning', 'warn'].includes(String(e.level).toLowerCase()));
  }
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
  exitCode = failed === 0 ? 0 : 1;
  lines.push('');
  lines.push(`SUMMARY: ${passed} PASS, ${failed} FAIL — overall ${report.overall}`);
  for (const [name, entries] of Object.entries(report.consoleProblems)) {
    for (const c of entries.slice(-8)) lines.push(`  [${name} ${c.level}] ${c.text.slice(0, 200)}`);
  }
  try {
    writeFileSync(join(HERE, 'report-fix-verify2-run2.json'), JSON.stringify(report, null, 2));
  } catch {
    /* best effort */
  }
  cdp4?.close();
  cdp5?.close();
  // TEARDOWN: kill Obsidian; remove litter folders from BOTH vaults on disk;
  // LEAVE the 8797 worker RUNNING; vaults stay paired+synced.
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
    `teardown removed litter test folders from both vaults: ${removed.length ? removed.join(', ') : 'none present'} (pairing/config untouched)`,
  );
  lines.push('TEARDOWN: Obsidian killed; worker 8797 LEFT RUNNING; both vaults LEFT PAIRED+SYNCED.');
  console.log(lines.join('\n'));
  process.exit(exitCode);
}
