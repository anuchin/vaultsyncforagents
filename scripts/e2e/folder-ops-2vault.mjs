/**
 * Folder-operations continuation of scenario-2vault.mjs (F1-F6, fixed).
 *
 * The main run proved clean-mode pairing + bidirectional sync. Its folder-ops
 * phase hit three SCRIPT bugs (Obsidian API usage), not product bugs:
 *   • vault.create() does NOT auto-create parent folders → createFolder first
 *   • vault.delete() cannot delete a FOLDER (EISDIR) → fileManager.trashFile
 *   • F2/F3 cascaded from F1's missing folder
 * Both vaults are ALREADY PAIRED (tokens persisted) — plugins auto-start on
 * launch, so this script never pairs; it launches both instances, sanity-checks
 * both devices online, re-runs F1-F6 properly, and MERGES results into
 * scripts/e2e/report-2vault.json (replacing the F* entries).
 *
 * Usage: node scripts/e2e/folder-ops-2vault.mjs
 */

import { execFile, spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { connectPage, listTargets } from './cdp.mjs';

const execFileP = promisify(execFile);
const HERE = join(fileURLToPath(import.meta.url), '..');

const WORKER = 'http://127.0.0.1:8797';
const PASSPHRASE = 'two-vault-test';
const OBSIDIAN_EXE = 'C:\\Program Files\\Obsidian\\Obsidian.exe';
const PROFILE_A = 'Z:/Projects/TestVaults/e2e-2vault-profile';
const PROFILE_B = 'Z:/Projects/TestVaults/e2e-2vault-profile-b';
const CDP_A = 'http://127.0.0.1:9222';
const CDP_B = 'http://127.0.0.1:9223';
const SYNC_TIMEOUT_MS = 25_000;
const jstr = JSON.stringify;

const REPORT_FILE = join(HERE, 'report-2vault.json');

// --- report merge ---------------------------------------------------------------------------------

const report = JSON.parse(readFileSync(REPORT_FILE, 'utf8'));
const lines = [];
const newSteps = [];
function step(id, name) {
  const entry = { id, name, phase: 'folder-ops', status: 'RUNNING', t0: Date.now() };
  newSteps.push(entry);
  lines.push(`[RUN ] ${id} ${name}`);
  return {
    pass(detail) {
      entry.status = 'PASS'; entry.ms = Date.now() - entry.t0; entry.detail = detail;
      lines.push(`[PASS] ${id} ${name} (${entry.ms} ms) — ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`);
    },
    gap(detail) {
      entry.status = 'KNOWN-GAP-CONFIRMED'; entry.ms = Date.now() - entry.t0; entry.detail = detail;
      lines.push(`[GAP ] ${id} ${name} (${entry.ms} ms) — KNOWN-GAP-CONFIRMED (not a regression) — ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`);
    },
    fail(detail) {
      entry.status = 'FAIL'; entry.ms = Date.now() - entry.t0; entry.detail = detail;
      lines.push(`[FAIL] ${id} ${name} (${entry.ms} ms) — ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`);
    },
  };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, timeoutMs, everyMs = 500, label = '') {
  const t0 = Date.now();
  let lastErr;
  for (;;) {
    try {
      const v = await fn();
      if (v !== undefined && v !== null && v !== false) return { value: v, elapsedMs: Date.now() - t0 };
    } catch (e) { lastErr = e; }
    if (Date.now() - t0 > timeoutMs) throw new Error(`waitFor${label ? `(${label})` : ''} timed out after ${timeoutMs} ms${lastErr ? ` (last: ${lastErr})` : ''}`);
    await sleep(everyMs);
  }
}
/** Run a step body once; on throw, retry once — BOTH failures returned, never thrown. */
async function withRetry(fn) {
  try {
    return { ok: true, result: await fn(false) };
  } catch (first) {
    lines.push(`  retry-after-error: ${String(first.message ?? first).slice(0, 300)}`);
    try {
      return { ok: true, result: await fn(true) };
    } catch (second) {
      lines.push(`  retry-also-failed: ${String(second.message ?? second).slice(0, 300)}`);
      return { ok: false, error: second, firstError: first };
    }
  }
}

async function wk(path, init = {}) {
  const res = await fetch(`${WORKER}${path}`, { signal: AbortSignal.timeout(10_000), ...init });
  const text = await res.text();
  let body; try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, body, headers: res.headers };
}

// --- vault helpers ----------------------------------------------------------------------------------

const readTextOrNull = async (cdp, p) => {
  const r = await cdp.eval(`(async()=>{ try { return { ok:true, text: await app.vault.adapter.read(${jstr(p)}) }; } catch(e){ return { ok:false }; } })()`);
  if (!r.ok) throw new Error(r.error);
  return r.value.ok ? r.value.text : null;
};
const exists = async (cdp, p) => {
  const r = await cdp.eval(`app.vault.adapter.exists(${jstr(p)}).then(v => ({ok:true, v}), e => ({ok:false, error:String(e)}))`);
  if (!r.ok) throw new Error(r.error);
  return r.value.v === true;
};
const pluginStatus = async (cdp) => {
  const r = await cdp.eval(`(() => { const p = app.plugins?.plugins?.vaultsyncforagents; if (!p) return null;
    return { statusBar: p.statusBarItem?.textContent ?? null, status: p.client?.status?.() ?? null, deviceId: p.data?.deviceId ?? null }; })()`);
  if (!r.ok) throw new Error(r.error);
  return r.value;
};
const conflictFiles = async (cdp) => {
  const r = await cdp.eval(`app.vault.getFiles().filter(f => /conflict/i.test(f.path)).map(f => f.path)`);
  if (!r.ok) throw new Error(r.error);
  return r.value;
};
const allFiles = async (cdp) => {
  const r = await cdp.eval(`app.vault.getFiles().map(f => f.path).sort()`);
  if (!r.ok) throw new Error(r.error);
  return r.value;
};
const syncNow = async (cdp) => cdp.eval(`(async()=>{ const p = app.plugins?.plugins?.vaultsyncforagents; if (!p?.syncNow) return 'no-plugin'; await p.syncNow(); return 'synced'; })()`);
const awaitNoteArrival = async (cdp, path, want, timeoutMs = SYNC_TIMEOUT_MS) =>
  waitFor(async () => {
    if (!(await exists(cdp, path))) return null;
    return (await readTextOrNull(cdp, path)) === want ? true : null;
  }, timeoutMs, 400, `arrival ${path}`).then((r) => r.elapsedMs);

// --- launch ------------------------------------------------------------------------------------------

function launchObsidian(profileDir, port) {
  if (!existsSync(OBSIDIAN_EXE)) throw new Error(`Obsidian.exe not found at ${OBSIDIAN_EXE}`);
  const child = spawn(OBSIDIAN_EXE, [`--user-data-dir=${profileDir}`, `--remote-debugging-port=${port}`], { detached: true, stdio: 'ignore' });
  child.unref();
  return child.pid;
}
async function driveFirstRunDialogs(cdp) {
  const r = await cdp.eval(`(() => { const clicked = [];
    for (const b of document.querySelectorAll('.modal button')) { const t = (b.textContent||'').trim();
      if (/trust author/i.test(t) || /turn on community plugins/i.test(t)) { b.click(); clicked.push(t); } }
    return clicked; })()`);
  return r.ok ? r.value : [];
}
async function awaitInstanceReady({ http, match, label }) {
  const t0 = Date.now();
  await waitFor(async () => {
    try { return (await listTargets(http)).some((t) => t.type === 'page'); } catch { return null; }
  }, 60_000, 1000, `${label}: CDP up`);
  let cdp = null; const dialogs = [];
  await waitFor(async () => {
    if (cdp === null) {
      try { cdp = await connectPage({ match, http }); } catch { return null; }
    }
    dialogs.push(...(await driveFirstRunDialogs(cdp)));
    const probe = await cdp.eval('!!(app.plugins?.plugins?.vaultsyncforagents)');
    return probe.ok && probe.value === true;
  }, 120_000, 1500, `${label}: plugin loaded`);
  await waitFor(async () => {
    const st = await pluginStatus(cdp);
    return st?.statusBar?.startsWith('vsa ✓') ? st : null;
  }, 30_000, 1000, `${label}: status bar ✓`);
  return { cdp, dialogsClicked: [...new Set(dialogs)], readyMs: Date.now() - t0 };
}

// --- main ---------------------------------------------------------------------------------------------

let cdp4 = null, cdp5 = null, cookie = null, exitCode = 0;

try {
  // sanity: admin login + launch both (vaults already paired → plugins auto-start)
  {
    const s = step('S', 'relaunch both paired instances; both plugins live; admin session OK');
    try {
      await execFileP('taskkill', ['/F', '/IM', 'Obsidian.exe']).catch(() => {});
      await sleep(1500);
      const login = await wk('/admin/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ passphrase: PASSPHRASE }) });
      if (login.status !== 200) throw new Error(`admin login HTTP ${login.status}`);
      cookie = (login.headers.get('set-cookie') ?? '').split(';')[0];
      const pidA = launchObsidian(PROFILE_A, 9222);
      const pidB = launchObsidian(PROFILE_B, 9223);
      const a = await awaitInstanceReady({ http: CDP_A, match: 'TestVault4', label: 'vault4' });
      const b = await awaitInstanceReady({ http: CDP_B, match: 'TestVault5', label: 'vault5' });
      cdp4 = a.cdp; cdp5 = b.cdp;
      const st = await wk('/api/status', { headers: { cookie } });
      const online = (st.body?.devices ?? []).filter((d) => d.online).map((d) => d.name);
      if (!online.includes('e2e-vault4') || !online.includes('e2e-vault5')) throw new Error(`devices not both online: ${JSON.stringify(st.body?.devices)}`);
      s.pass({ pids: [pidA, pidB], readyMs: { vault4: a.readyMs, vault5: b.readyMs }, dialogs: [...a.dialogsClicked, ...b.dialogsClicked], onlineDevices: online });
    } catch (e) {
      s.fail(String(e.message ?? e));
    }
  }

  const deviceIds = { vault4: (await pluginStatus(cdp4))?.deviceId, vault5: (await pluginStatus(cdp5))?.deviceId };

  const folderOps = [
    {
      id: 'F1',
      name: 'folder create with content: projects/a.md + projects/b.md in vault4 → vault5 gets both (createFolder first — vault.create does not auto-mkdir)',
      async run() {
        const ca = `projects/a content ${Date.now()}`;
        const cb = `projects/b content ${Date.now()}`;
        const r = await cdp4.eval(`(async()=>{
          try { await app.vault.createFolder('projects'); } catch (e) {}
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
      name: 'file move across folders: vault4 projects/a.md → archive/a.md; rename vs delete+add via /api/history',
      async run() {
        const pre = await readTextOrNull(cdp4, 'projects/a.md');
        if (pre === null) throw new Error('projects/a.md missing in vault4 (F1 state)');
        const r = await cdp4.eval(`(async()=>{
          try { await app.vault.createFolder('archive'); } catch (e) {}
          await app.vault.rename(app.vault.getAbstractFileByPath('projects/a.md'), 'archive/a.md');
          return 'moved';
        })()`);
        if (!r.ok) throw new Error(`move: ${r.error}`);
        const ms = await waitFor(async () => {
          if (!(await exists(cdp5, 'archive/a.md'))) return null;
          return (await exists(cdp5, 'projects/a.md')) ? null : 'ok';
        }, SYNC_TIMEOUT_MS, 400, 'vault5 move propagation').then((x) => x.elapsedMs);
        const content5 = await readTextOrNull(cdp5, 'archive/a.md');
        if (content5 !== pre) throw new Error(`content changed across move: ${JSON.stringify({ pre, content5 })}`);
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
      name: 'folder move: vault5 renames projects → renamed-projects; vault4 children follow',
      async run() {
        const mark = cdp5.consoleLog.length;
        const r = await cdp5.eval(`app.vault.rename(app.vault.getAbstractFileByPath('projects'), 'renamed-projects').then(() => 'folder-renamed')`);
        if (!r.ok) throw new Error(`folder rename: ${r.error}`);
        const ms = await waitFor(async () => {
          if (!(await exists(cdp4, 'renamed-projects/b.md'))) return null;
          return (await exists(cdp4, 'projects/b.md')) ? null : 'ok';
        }, SYNC_TIMEOUT_MS, 400, 'vault4 folder-rename propagation').then((x) => x.elapsedMs);
        const vsaLogs = cdp5.consoleLog.slice(mark).filter((e) => /\[vsa\]/i.test(e.text)).map((e) => `${e.level}: ${e.text.slice(0, 160)}`);
        return { latencyMs: ms, vault4HasRenamedProjectsB: true, vault5VsaConsoleDuringFolderRename: vsaLogs.slice(0, 8) };
      },
    },
    {
      id: 'F4',
      name: 'vault4 deletes archive/a.md → vault5 drops it; empty archive folder observed both sides 40s',
      async run() {
        if (!(await exists(cdp4, 'archive/a.md'))) throw new Error('archive/a.md missing in vault4 (F2 state)');
        const r = await cdp4.eval(`app.vault.delete(app.vault.getAbstractFileByPath('archive/a.md')).then(() => 'deleted')`);
        if (!r.ok) throw new Error(`delete: ${r.error}`);
        const ms = await waitFor(async () => ((await exists(cdp5, 'archive/a.md')) ? null : 'gone'), SYNC_TIMEOUT_MS, 400, 'vault5 file-delete propagation').then((x) => x.elapsedMs);
        const samples = [];
        for (let i = 0; i <= 8; i++) {
          const [e4, e5] = await Promise.all([exists(cdp4, 'archive'), exists(cdp5, 'archive')]);
          samples.push({ t_s: i * 5, vault4: e4, vault5: e5 });
          if (i < 8) await sleep(5000);
        }
        const first = samples[0], last = samples[samples.length - 1];
        return {
          fileDeleteLatencyMs: ms,
          emptyFolderObservation: samples,
          observedBehavior: `empty 'archive' folder ${last.vault4 && last.vault5 ? 'PERSISTS on both sides' : last.vault4 || last.vault5 ? 'persists on ONE side only' : 'disappeared'} over 40s (initial: v4=${first.vault4} v5=${first.vault5})`,
        };
      },
    },
    {
      id: 'F5',
      name: 'empty-folder lifecycle: create to-delete in vault5 → placeholder syncs to vault4 → delete (trashFile) → propagate?',
      async run(s) {
        const mk = await cdp5.eval(`(async()=>{ try { await app.vault.createFolder('to-delete'); } catch (e) {} return (await app.vault.adapter.exists('to-delete')) ? 'created' : 'failed'; })()`);
        if (!mk.ok || mk.value !== 'created') throw new Error(`createFolder: ${mk.error ?? mk.value}`);
        let placeholderMs = null;
        try {
          placeholderMs = await waitFor(async () => ((await exists(cdp4, 'to-delete')) ? true : null), 35_000, 1000, 'vault4 sees to-delete').then((x) => x.elapsedMs);
        } catch {
          await syncNow(cdp4);
          placeholderMs = await waitFor(async () => ((await exists(cdp4, 'to-delete')) ? true : null), 35_000, 1000, 'vault4 sees to-delete after poke').then((x) => x.elapsedMs);
        }
        await sleep(3000); // settle vault5's placeholder push
        // vault.delete on a FOLDER throws EISDIR in Obsidian 1.13.7 — use
        // fileManager.trashFile (fires real 'delete' events), fallback rmdir.
        const del = await cdp5.eval(`(async()=>{
          const f = app.vault.getAbstractFileByPath('to-delete');
          if (!f) return 'missing';
          try { await app.fileManager.trashFile(f); return 'trashed'; }
          catch (e) { await app.vault.adapter.rmdir('to-delete', false); return 'rmdir'; }
        })()`);
        if (!del.ok) throw new Error(`folder delete: ${del.error}`);
        const goneHere = await waitFor(async () => ((await exists(cdp5, 'to-delete')) ? null : 'gone'), 10_000, 500, 'vault5 own folder gone').then((x) => x.elapsedMs).catch(() => null);
        let propagated = false;
        try {
          await waitFor(async () => ((await exists(cdp4, 'to-delete')) ? null : 'gone'), 40_000, 1000, 'vault4 drops to-delete');
          propagated = true;
        } catch { /* not propagated within 40s */ }
        if (!propagated) {
          await syncNow(cdp4);
          await sleep(5000);
          propagated = !(await exists(cdp4, 'to-delete'));
        }
        if (propagated) {
          s.pass({ placeholderSyncMs: placeholderMs, deleteMethod: del.value, vault5GoneMs: goneHere, result: 'empty-folder deletion DID propagate to vault4' });
        } else {
          s.gap({
            placeholderSyncMs: placeholderMs,
            deleteMethod: del.value,
            vault5GoneMs: goneHere,
            afterDeletePlusSyncNowPoke: (await exists(cdp4, 'to-delete')) ? 'to-delete STILL present in vault4' : 'gone after manual poke',
            evidence: 'core defers folder-placeholder tombstoning (engine.ts: "Tombstoned placeholders record only") — expected gap, not a regression',
          });
        }
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
    const s = step(t.id, t.name);
    if (!cdp4 || !cdp5) { s.fail('skipped (launch failed)'); continue; }
    try {
      if (t.id === 'F5') await t.run(s);
      else {
        const r = await withRetry(t.run);
        if (r.ok) s.pass(r.result); else s.fail(String(r.error?.message ?? r.error));
      }
    } catch (e) {
      s.fail(String(e.message ?? e));
    }
  }

  try {
    report.finalFiles = { vault4: await allFiles(cdp4), vault5: await allFiles(cdp5) };
    report.finalFolders = {
      vault4: (await cdp4.eval(`app.vault.getAllLoadedFiles().filter(f=>f.children!==undefined).map(f=>f.path).sort()`)).value,
      vault5: (await cdp5.eval(`app.vault.getAllLoadedFiles().filter(f=>f.children!==undefined).map(f=>f.path).sort()`)).value,
    };
  } catch { /* best effort */ }
  report.deviceIds = deviceIds;
} catch (fatal) {
  lines.push(`[FATAL] ${String(fatal?.stack ?? fatal)}`);
} finally {
  // merge console capture from this continuation session
  for (const [name, cdp] of [['vault4', cdp4], ['vault5', cdp5]]) {
    if (!cdp) continue;
    report.consoleProblems[name] = [
      ...((report.consoleProblems[name] ?? []).filter((e) => !e.continuation)),
      ...cdp.consoleLog.filter((e) => ['error', 'warning', 'warn'].includes(String(e.level).toLowerCase())).map((e) => ({ continuation: true, ...e })),
    ];
  }
  // replace F* + S step entries in the merged report
  report.steps = report.steps.filter((st) => !/^[FS]/.test(String(st.id)));
  report.steps.push(...newSteps);
  const failed = report.steps.filter((x) => x.status === 'FAIL' || x.status === 'RUNNING').length;
  const passed = report.steps.filter((x) => x.status === 'PASS').length;
  const gaps = report.steps.filter((x) => x.status === 'KNOWN-GAP-CONFIRMED').length;
  report.overall = failed === 0 ? 'PASS' : 'FAIL';
  report.finishedAt = new Date().toISOString();
  exitCode = failed === 0 ? 0 : 1;
  lines.push('');
  lines.push(`MERGED SUMMARY: ${passed} PASS, ${failed} FAIL, ${gaps} KNOWN-GAP — overall ${report.overall}`);
  try { writeFileSync(REPORT_FILE, JSON.stringify(report, null, 2)); } catch { /* best effort */ }
  cdp4?.close();
  cdp5?.close();
  await execFileP('taskkill', ['/F', '/IM', 'Obsidian.exe']).catch(() => {});
  lines.push('TEARDOWN: Obsidian killed; worker 8797 LEFT RUNNING; vaults LEFT PAIRED+SYNCED.');
  console.log(lines.join('\n'));
  process.exit(exitCode);
}
