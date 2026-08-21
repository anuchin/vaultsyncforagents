/**
 * Focused B5 RETRY — rename of a folder that CONTAINS A SUBFOLDER (the exact
 * B5 shape from scenario-bulkops-cloud.mjs run 1, fresh names). Run 1 evidence
 * (report-bulkops-cloud.json + worker history):
 *
 *   • vault4's rename reached the server in ~2s (rename version at the new
 *     path, contents intact) — but the PEER (vault5) pushed an `edit` version
 *     for the OLD folder placeholder (/bulk-parent) ~1s later, resurrecting
 *     the old EMPTY folder on both sides; old-path absence then failed to
 *     converge for >120s, and vault4's renameFile retry hit "Destination file
 *     already exists".
 *   • the same peer re-push happened to /bulk-parent-renamed right after the
 *     first trash (B7 attempt 1); a second trash finally tombstoned it and it
 *     stayed dead across two rescan cycles.
 *
 * This probe answers ONE question deterministically: does the peer
 * placeholder-resurrection race reproduce on a clean, fresh nested structure?
 * Assertions are the SAME as B5's (no weakening): new subtree present with
 * intact content in the peer; old folder AND old file paths absent — with a
 * 120s convergence budget, then a 60s stability window, then server-side
 * placeholder history captured for the old/new folder paths.
 *
 * Usage: node scripts/e2e/probe-folder-rename-cloud.mjs  (VSA_E2E_WORKER / VSA_E2E_PASSPHRASE)
 * Writes scripts/e2e/report-folder-rename-probe.json.
 */

import { execFile, spawn } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { connectPage, listTargets } from './cdp.mjs';

const execFileP = promisify(execFile);
const HERE = join(fileURLToPath(import.meta.url), '..');
const WORKER = process.env.VSA_E2E_WORKER ?? 'http://127.0.0.1:8797';
const PASSPHRASE = process.env.VSA_E2E_PASSPHRASE ?? 'two-vault-test';
const OBSIDIAN_EXE = 'C:\\Program Files\\Obsidian\\Obsidian.exe';
const V4_DIR = 'Z:/Projects/TestVaults/TestVault4';
const V5_DIR = 'Z:/Projects/TestVaults/TestVault5';
const PROFILE_A = 'Z:/Projects/TestVaults/e2e-hardened-profile';
const PROFILE_B = 'Z:/Projects/TestVaults/e2e-hardened-profile-b';
const CDP_A = 'http://127.0.0.1:9222';
const CDP_B = 'http://127.0.0.1:9223';

// Fresh unique names (never used in any prior run) so server state is clean.
const TAG = `b5r${Date.now().toString(36)}`;
const SRC = `folder-rename-src-${TAG}`; // renamed folder (contains a SUBFOLDER)
const DST = `folder-rename-dst-${TAG}`;
const INNER = 'inner';
const FILES = ['a.md', 'b.md', 'c.md'];

const jstr = JSON.stringify;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = { startedAt: new Date().toISOString(), worker: WORKER, tag: TAG, ok: false, steps: [] };

async function waitFor(fn, timeoutMs, everyMs = 400, label = '') {
  const t0 = Date.now();
  let last;
  for (;;) {
    try {
      const v = await fn();
      if (v !== undefined && v !== null && v !== false) return { value: v, elapsedMs: Date.now() - t0 };
    } catch (e) {
      last = e;
    }
    if (Date.now() - t0 > timeoutMs) throw new Error(`waitFor(${label}) timed out after ${timeoutMs} ms${last ? ` (last: ${last})` : ''}`);
    await sleep(everyMs);
  }
}
function st(id, name) {
  const e = { id, name, status: 'RUNNING', t0: Date.now() };
  out.steps.push(e);
  console.log(`[RUN ] ${id} ${name}`);
  return {
    pass(d) { e.status = 'PASS'; e.ms = Date.now() - e.t0; e.detail = d; console.log(`[PASS] ${id} (${e.ms} ms) ${typeof d === 'string' ? d : JSON.stringify(d).slice(0, 400)}`); },
    fail(d) { e.status = 'FAIL'; e.ms = Date.now() - e.t0; e.detail = d; console.log(`[FAIL] ${id} (${e.ms} ms) ${typeof d === 'string' ? d : JSON.stringify(d).slice(0, 600)}`); },
  };
}

async function existsAny(cdp, paths) {
  const r = await cdp.eval(`(async () => { const out = {}; for (const p of ${jstr(paths)}) out[p] = await app.vault.adapter.exists(p); return out; })()`);
  if (!r.ok) throw new Error(`existsAny: ${r.error}`);
  return r.value;
}
async function readAll(cdp, map) {
  const r = await cdp.eval(`(async () => { const out = {}; for (const p of ${jstr(Object.keys(map))}) { try { out[p] = await app.vault.adapter.read(p); } catch (e) { out[p] = null; } } return out; })()`);
  if (!r.ok) throw new Error(`readAll: ${r.error}`);
  return r.value;
}

async function wk(path, init = {}, cookie = null) {
  const res = await fetch(`${WORKER}${path}`, { signal: AbortSignal.timeout(15_000), ...(cookie ? { headers: { cookie } } : {}), ...init });
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, body, headers: res.headers };
}

async function main() {
  let cookie = null;
  let cdp4 = null;
  let cdp5 = null;
  try {
    // prep
    const s0 = st('prep', 'kill Obsidian; admin login; profiles');
    await execFileP('taskkill', ['/F', '/IM', 'Obsidian.exe']).catch(() => {});
    await sleep(1500);
    const login = await wk('/admin/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ passphrase: PASSPHRASE }),
    });
    if (login.status !== 200) throw new Error(`admin login HTTP ${login.status}`);
    cookie = (login.headers.get('set-cookie') ?? '').split(';')[0];
    await execFileP(process.execPath, [join(HERE, 'write-profile.mjs'), PROFILE_A, V4_DIR, V5_DIR]);
    await execFileP(process.execPath, [join(HERE, 'write-profile.mjs'), PROFILE_B, V5_DIR, V4_DIR]);
    s0.pass('ok');

    // launch
    const s1 = st('launch', 'launch both; live+✓+pending0');
    const pids = [spawn(OBSIDIAN_EXE, [`--user-data-dir=${PROFILE_A}`, '--remote-debugging-port=9222'], { detached: true, stdio: 'ignore' }),
      spawn(OBSIDIAN_EXE, [`--user-data-dir=${PROFILE_B}`, '--remote-debugging-port=9223'], { detached: true, stdio: 'ignore' })];
    pids.forEach((p) => p.unref());
    async function ready(http, match) {
      await waitFor(async () => {
        try { return (await listTargets(http)).some((t) => t.type === 'page'); } catch { return false; }
      }, 60_000, 1000, 'cdp up');
      let cdp = null;
      await waitFor(async () => {
        if (!cdp) { try { cdp = await connectPage({ match, http }); } catch { return false; } }
        const r = await cdp.eval('!!(app.plugins?.plugins?.vaultsyncforagents)');
        return r.ok && r.value === true;
      }, 120_000, 1500, 'plugin loaded');
      await waitFor(async () => {
        const r = await cdp.eval(`(() => { const p = app.plugins.plugins.vaultsyncforagents; const s = p.client?.status?.(); return s?.state === 'live' && s?.pending === 0 && (p.statusBarItem?.textContent ?? '').startsWith('vsa ✓'); })()`);
        return r.ok && r.value === true;
      }, 90_000, 1000, 'live');
      return cdp;
    }
    cdp4 = await ready(CDP_A, 'TestVault4');
    cdp5 = await ready(CDP_B, 'TestVault5');
    s1.pass('both live');

    // build the nested structure in vault4: SRC/inner/{a,b,c}.md
    const s2 = st('build', `create ${SRC}/${INNER}/{a,b,c}.md in vault4; converge to vault5`);
    const contents = {};
    for (const f of FILES) contents[`${SRC}/${INNER}/${f}`] = `folder-rename probe ${f} ${TAG} nonce=${Math.random().toString(36).slice(2, 8)}`;
    const built = await cdp4.eval(`(async () => {
      await app.vault.createFolder('${SRC}/${INNER}');
      for (const [p, t] of Object.entries(${jstr(contents)})) await app.vault.create(p, t);
      return 'built';
    })()`);
    if (!built.ok || built.value !== 'built') throw new Error(`build: ${built.error ?? built.value}`);
    await waitFor(async () => {
      const have = await existsAny(cdp5, Object.keys(contents));
      return Object.values(have).every(Boolean) ? true : null;
    }, 60_000, 500, 'structure reaches vault5');
    const got = await readAll(cdp5, contents);
    for (const [p, t] of Object.entries(contents)) {
      if (got[p] !== t) throw new Error(`content mismatch pre-rename ${p}`);
    }
    await sleep(3000); // settle the placeholder push
    s2.pass({ paths: Object.keys(contents) });

    // THE OPERATION: rename the folder that contains a subfolder
    const s3 = st('rename', `fileManager.renameFile(TFolder ${SRC} → ${DST}); assert in vault5: new subtree present w/ content; ${SRC} AND old file paths ABSENT (120s budget)`);
    const histBefore = await wk(`/api/history?path=${encodeURIComponent('/' + SRC)}`, {}, cookie);
    const ren = await cdp4.eval(`(async () => {
      const f = app.vault.getAbstractFileByPath('${SRC}');
      if (!f) return 'missing';
      try { await app.fileManager.renameFile(f, '${DST}'); return 'renamed'; } catch (e) { return 'threw: ' + String(e).slice(0, 200); }
    })()`);
    if (!ren.ok || ren.value !== 'renamed') throw new Error(`rename: ${ren.error ?? ren.value}`);
    const expected = {};
    for (const f of FILES) expected[`${DST}/${INNER}/${f}`] = contents[`${SRC}/${INNER}/${f}`];
    const oldPaths = [SRC, `${SRC}/${INNER}`, ...FILES.map((f) => `${SRC}/${INNER}/${f}`)];
    const newPaths = [DST, `${DST}/${INNER}`, ...FILES.map((f) => `${DST}/${INNER}/${f}`)];
    let converged = null;
    try {
      const w = await waitFor(async () => {
        const have = await existsAny(cdp5, [...newPaths, ...oldPaths]);
        const okNew = newPaths.every((p) => have[p] === true);
        const okOld = oldPaths.every((p) => have[p] === false);
        if (!okNew || !okOld) return null;
        const texts = await readAll(cdp5, expected);
        return Object.entries(expected).every(([p, t]) => texts[p] === t) ? true : null;
      }, 120_000, 500, 'rename convergence in vault5');
      converged = { ok: true, ms: w.elapsedMs };
    } catch (e) {
      const have = await existsAny(cdp5, [...newPaths, ...oldPaths]);
      converged = { ok: false, error: String(e.message ?? e), finalExistence: have };
    }
    // stability window regardless (60s)
    const stability = [];
    for (let i = 0; i < 6; i++) {
      const have = await existsAny(cdp5, oldPaths);
      stability.push({ t_s: i * 10, oldPathsPresent: Object.entries(have).filter(([, v]) => v).map(([p]) => p) });
      await sleep(10_000);
    }
    const stillOld = stability[stability.length - 1].oldPathsPresent;
    // server-side placeholder history for old and new folder paths
    const histOld = await wk(`/api/history?path=${encodeURIComponent('/' + SRC)}`, {}, cookie);
    const histOldInner = await wk(`/api/history?path=${encodeURIComponent('/' + SRC + '/' + INNER)}`, {}, cookie);
    const histNew = await wk(`/api/history?path=${encodeURIComponent('/' + DST)}`, {}, cookie);
    const brief = (h) => (h.body?.versions ?? []).slice(0, 6).map((v) => ({ id: v.id, kind: v.kind, dev: v.deviceId, ts: new Date(v.ts).toISOString().slice(11, 19) }));
    out.serverHistory = {
      oldFolder: { before: brief(histBefore), after: brief(histOld) },
      oldInner: brief(histOldInner),
      newFolder: brief(histNew),
    };
    out.convergence = converged;
    out.stability = stability;
    if (converged.ok && stillOld.length === 0) {
      s3.pass({ convergenceMs: converged.ms, stability: 'old paths stayed absent for 60s', serverHistory: out.serverHistory });
    } else {
      s3.fail({ convergence: converged, stability, serverHistory: out.serverHistory });
    }

    // cleanup (trash DST through vault4; wait gone in vault5)
    const s4 = st('cleanup', `trashFile ${DST}; converge gone both sides`);
    await cdp4.eval(`(async () => { const f = app.vault.getAbstractFileByPath('${DST}'); if (f) { try { await app.fileManager.trashFile(f); } catch (e) {} } return 'done'; })()`);
    let clean = false;
    try {
      await waitFor(async () => {
        const a = await existsAny(cdp4, newPaths);
        const b = await existsAny(cdp5, newPaths);
        return [...Object.values(a), ...Object.values(b)].every((v) => !v) ? true : null;
      }, 90_000, 800, 'cleanup convergence');
      clean = true;
    } catch { clean = false; }
    if (clean) s4.pass('gone both sides');
    else {
      // second trash if resurrected (same race), then one more window
      await cdp4.eval(`(async () => { const f = app.vault.getAbstractFileByPath('${DST}'); if (f) { try { await app.fileManager.trashFile(f); } catch (e) {} } return 'done2'; })()`);
      try {
        await waitFor(async () => {
          const a = await existsAny(cdp4, newPaths);
          const b = await existsAny(cdp5, newPaths);
          return [...Object.values(a), ...Object.values(b)].every((v) => !v) ? true : null;
        }, 60_000, 800, 'cleanup convergence (2nd trash)');
        clean = true;
        s4.pass('gone after a second trash (placeholder resurrection needed a re-kill — matches the B5/B7 race)');
      } catch (e2) {
        s4.fail(String(e2.message ?? e2));
      }
    }
    out.ok = out.steps.every((x) => x.status === 'PASS');
  } catch (e) {
    out.fatal = String(e?.stack ?? e);
  } finally {
    try { cdp4?.close(); cdp5?.close(); } catch { /* ignore */ }
    await execFileP('taskkill', ['/F', '/IM', 'Obsidian.exe']).catch(() => {});
    out.finishedAt = new Date().toISOString();
    try { writeFileSync(join(HERE, 'report-folder-rename-probe.json'), JSON.stringify(out, null, 2)); } catch { /* best effort */ }
    console.log(JSON.stringify({ ok: out.ok, steps: out.steps.map((s) => ({ id: s.id, status: s.status, ms: s.ms })), convergence: out.convergence, serverHistory: out.serverHistory }, null, 2));
    process.exit(out.ok ? 0 : 1);
  }
}

main();
