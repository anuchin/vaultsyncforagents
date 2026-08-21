/**
 * CLOUD E2E FOLDER-OPS RERUN — F1-F3 + F5 adapted to the current Obsidian build.
 *
 * The resume run (report-cloud-resume.json) showed the worker-side folder sync
 * healthy (F4/F6 PASS) but F1-F3/F5 failed INSIDE Obsidian before any sync op:
 *   • app.vault.create('projects/a.md') → ENOENT: this Obsidian build no longer
 *     auto-creates missing parent directories (verified in isolation by
 *     probe-folder-ops-cloud.mjs; createFolder-then-create works).
 *   • app.vault.delete(TFolder) → ERR_FS_EISDIR on any directory (the exact
 *     adapter limitation plugin.ts documents; its workaround is
 *     fileManager.trashFile).
 *
 * This rerun keeps the SAME propagation assertions, only creating parent
 * folders explicitly (as Obsidian's own UI does) and deleting the empty folder
 * via fileManager.trashFile:
 *   F1' createFolder + projects/{a,b}.md in vault4 → both arrive in vault5
 *   F2' projects/a.md → archive/a.md move; content preserved; rename vs delete+add
 *   F3' folder rename projects → renamed-projects; children follow to vault4
 *   F5' to-delete placeholder → trashFile delete → propagation (KNOWN-GAP tolerant)
 *   F6' final sanity: 0 conflicts, both live/pending 0
 *
 * Usage: node scripts/e2e/scenario-cloud-folderops.mjs
 *   VSA_E2E_WORKER      worker base URL (default http://127.0.0.1:8797)
 *   VSA_E2E_PASSPHRASE  admin passphrase (default two-vault-test — LOCAL
 *                       wrangler-dev rooms only; set this for a deployed room)
 * Report: scripts/e2e/report-cloud-folderops.json
 */

import { execFile, spawn } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { connectPage, listTargets } from './cdp.mjs';

const execFileP = promisify(execFile);
const HERE = join(fileURLToPath(import.meta.url), '..');

// Target worker + admin passphrase come from the env (see header) — no
// deployed URL or live passphrase is hardcoded here.
const WORKER = process.env.VSA_E2E_WORKER ?? 'http://127.0.0.1:8797';
const PASSPHRASE = process.env.VSA_E2E_PASSPHRASE ?? 'two-vault-test';

const OBSIDIAN_EXE = 'C:\\Program Files\\Obsidian\\Obsidian.exe';
const V4_DIR = 'Z:/Projects/TestVaults/TestVault4';
const V5_DIR = 'Z:/Projects/TestVaults/TestVault5';
const PROFILE_A = 'Z:/Projects/TestVaults/e2e-2vault-profile';
const PROFILE_B = 'Z:/Projects/TestVaults/e2e-2vault-profile-b';
const CDP_A = 'http://127.0.0.1:9222';
const CDP_B = 'http://127.0.0.1:9223';
const SYNC_TIMEOUT_MS = 40_000;

const jstr = JSON.stringify;

const report = {
  startedAt: new Date().toISOString(),
  worker: WORKER,
  adaptation: {
    why: 'current Obsidian build: app.vault.create no longer auto-creates parent dirs (ENOENT); app.vault.delete(TFolder) always ERR_FS_EISDIR (plugin.ts documents this; workaround fileManager.trashFile)',
    changed: ['F1: explicit app.vault.createFolder before file creates', 'F5: fileManager.trashFile instead of app.vault.delete for the folder'],
    assertions: 'unchanged propagation/content assertions',
  },
  steps: [],
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
    gap(detail) {
      entry.status = 'KNOWN-GAP-CONFIRMED';
      entry.ms = Date.now() - entry.t0;
      entry.detail = detail;
      lines.push(`[GAP ] ${id} ${name} (${entry.ms} ms) — KNOWN-GAP-CONFIRMED — ${fmt(detail)}`);
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
    return { statusBar: p.statusBarItem?.textContent ?? null, status: st }; })()`);
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
async function awaitNoteArrival(cdp, path, want, timeoutMs = SYNC_TIMEOUT_MS) {
  const r = await waitFor(async () => {
    if (!(await exists(cdp, path))) return null;
    const text = await readTextOrNull(cdp, path);
    return text === want ? text : null;
  }, timeoutMs, 400, `arrival ${path}`);
  return r.elapsedMs;
}

function launchObsidian(profileDir, port) {
  const child = spawn(OBSIDIAN_EXE, [`--user-data-dir=${profileDir}`, `--remote-debugging-port=${port}`], { detached: true, stdio: 'ignore' });
  child.unref();
  return child.pid;
}
async function awaitInstanceReady({ http, match, label }) {
  const t0 = Date.now();
  await waitFor(async () => {
    try {
      return (await listTargets(http)).some((t) => t.type === 'page') ? true : null;
    } catch {
      return null;
    }
  }, 60_000, 1000, `${label}: CDP up`);
  let cdp = null;
  await waitFor(async () => {
    if (cdp === null) {
      try {
        cdp = await connectPage({ match, http });
      } catch {
        return null;
      }
    }
    const probe = await cdp.eval('!!(app.plugins?.plugins?.vaultsyncforagents)');
    return probe.ok && probe.value === true;
  }, 120_000, 1500, `${label}: plugin loaded`);
  return { cdp, readyMs: Date.now() - t0 };
}

const FATAL_PATTERNS = [/blocked by CORS policy/i, /Access-Control-Allow-Origin/i, /Illegal invocation/i, /Failed to execute 'fetch'/i];
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

let cookie;
let cdp4 = null;
let cdp5 = null;
let exitCode = 0;
let fatalStop = false;

process.on('uncaughtException', (e) => {
  lines.push(`[FATAL-uncaught] ${String(e?.stack ?? e)}`);
  report.fatal = String(e?.message ?? e);
});

try {
  // ---- prep ----
  {
    const s = step('prep', 'kill Obsidian; verify claimed CLOUD room + paired data.json; clean F-phase artifacts; write profiles');
    try {
      await execFileP('taskkill', ['/F', '/IM', 'Obsidian.exe']).catch(() => {});
      await sleep(1500);
      const health = await wk('/health');
      if (health.body?.ok !== true || health.body?.claimed !== true) throw new Error(`/health: ${fmt(health.body)}`);
      const login = await wk('/admin/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ passphrase: PASSPHRASE }),
      });
      if (login.status !== 200) throw new Error(`admin login HTTP ${login.status}`);
      cookie = (login.headers.get('set-cookie') ?? '').split(';')[0];
      for (const dir of [V4_DIR, V5_DIR]) {
        const d = JSON.parse(readFileSync(join(dir, '.obsidian/plugins/vaultsyncforagents/data.json'), 'utf8'));
        if (d.url !== WORKER) throw new Error(`${dir} not paired to cloud (${d.url})`);
        for (const art of ['projects', 'archive', 'renamed-projects', 'to-delete']) {
          const p = join(dir, art);
          if (existsSync(p)) rmSync(p, { recursive: true, force: true });
        }
      }
      const { stdout: pa } = await execFileP(process.execPath, [join(HERE, 'write-profile.mjs'), PROFILE_A, V4_DIR, V5_DIR]);
      const { stdout: pb } = await execFileP(process.execPath, [join(HERE, 'write-profile.mjs'), PROFILE_B, V5_DIR, V4_DIR]);
      s.pass({ health: health.body, profileA: pa.trim(), profileB: pb.trim() });
    } catch (e) {
      s.fail(String(e.message ?? e));
      fatalStop = true;
    }
  }

  // ---- launch + settle ----
  {
    const s = step('R0', 'launch both; persisted pairing reconnects live (✓, pending 0); capture Obsidian build');
    try {
      if (fatalStop) throw new Error('skipped (prep failed)');
      launchObsidian(PROFILE_A, 9222);
      launchObsidian(PROFILE_B, 9223);
      const [a, b] = await Promise.all([
        awaitInstanceReady({ http: CDP_A, match: 'TestVault4', label: 'vault4' }),
        awaitInstanceReady({ http: CDP_B, match: 'TestVault5', label: 'vault5' }),
      ]);
      cdp4 = a.cdp;
      cdp5 = b.cdp;
      await sleep(4000);
      const builds = {};
      for (const [name, cdp] of [['vault4', cdp4], ['vault5', cdp5]]) {
        const v = await cdp.eval('(process && process.versions && process.versions.electron) || navigator.userAgent');
        builds[name] = v.ok ? v.value : 'unknown';
        const st = await waitFor(async () => {
          const ps = await pluginStatus(cdp);
          return ps?.statusBar?.startsWith('vsa ✓') && ps?.status?.state === 'live' && ps?.status?.pending === 0 ? ps : null;
        }, 60_000, 1000, `${name} live+✓`);
        builds[`${name}StatusBar`] = st.value.statusBar;
      }
      const cors = fatalConsoleHits({ vault4: cdp4, vault5: cdp5 });
      if (cors.length) throw new Error(`CORS hits: ${fmt(cors.slice(0, 2))}`);
      s.pass({ builds });
    } catch (e) {
      s.fail(String(e.message ?? e));
      fatalStop = true;
    }
  }

  const ops = [
    {
      id: "F1'",
      name: 'folder create with content (explicit createFolder first): projects/{a,b}.md in vault4 → vault5 gets both',
      async run() {
        const ca = `projects/a content ${Date.now()}`;
        const cb = `projects/b content ${Date.now()}`;
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
      id: "F2'",
      name: "file move across folders: projects/a.md → archive/a.md; content preserved; rename vs delete+add",
      async run() {
        const pre = await readTextOrNull(cdp4, 'projects/a.md');
        const r = await cdp4.eval(`(async()=>{
          try { await app.vault.createFolder('archive'); } catch (e) { if (!/exists/i.test(String(e))) throw e; }
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
      id: "F3'",
      name: 'folder move: vault5 renames projects → renamed-projects; vault4 children follow',
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
      id: "F5'",
      name: 'empty-folder deletion via fileManager.trashFile (adapter-rmdir workaround): to-delete placeholder → trash → propagation? (KNOWN-GAP tolerant)',
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
        // fileManager.trashFile — the path plugin.ts itself uses (adapter rmdir is EISDIR-broken)
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
      id: "F6'",
      name: 'final sanity: 0 conflict files both vaults; both live/pending 0; conflict-free statuses',
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

  for (const t of ops) {
    const s = step(t.id, t.name);
    if (fatalStop || !cdp4 || !cdp5) { s.fail('skipped (fatal earlier)'); continue; }
    try {
      if (t.id === "F5'") {
        await t.run(s);
      } else {
        const r = await withRetry(t.run);
        if (r.ok) s.pass(r.result); else s.fail(String(r.error?.message ?? r.error));
      }
    } catch (e) {
      s.fail(String(e.message ?? e));
    }
  }

  if (cdp4 && cdp5) {
    try {
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
  report.finishedAt = new Date().toISOString();
  const failed = report.steps.filter((x) => x.status === 'FAIL' || x.status === 'RUNNING').length;
  const passed = report.steps.filter((x) => x.status === 'PASS').length;
  const gaps = report.steps.filter((x) => x.status === 'KNOWN-GAP-CONFIRMED').length;
  report.overall = failed === 0 ? 'PASS' : 'FAIL';
  exitCode = failed === 0 ? 0 : 1;
  lines.push('');
  lines.push(`SUMMARY: ${passed} PASS, ${failed} FAIL, ${gaps} KNOWN-GAP — overall ${report.overall}`);
  const totalProblems = Object.values(report.consoleProblems).reduce((a, b) => a + b.length, 0);
  lines.push(`Console errors/warnings captured: ${totalProblems}`);
  for (const [name, entries] of Object.entries(report.consoleProblems)) {
    for (const c of entries.slice(0, 10)) lines.push(`  [${name} ${c.level}] ${c.text.slice(0, 240)}`);
  }
  try {
    writeFileSync(join(HERE, 'report-cloud-folderops.json'), JSON.stringify(report, null, 2));
  } catch { /* best effort */ }
  cdp4?.close();
  cdp5?.close();
  await execFileP('taskkill', ['/F', '/IM', 'Obsidian.exe']).catch(() => {});
  lines.push(`TEARDOWN: Obsidian killed; CLOUD worker ${WORKER} LEFT DEPLOYED; both vaults LEFT PAIRED+SYNCED.`);
  console.log(lines.join('\n'));
  process.exit(exitCode);
}
