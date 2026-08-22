/**
 * RE-PROVISION run after the 8797 worker's DO state was wiped (wrangler crash)
 * and the v0.1.3 plugin (settings pass) was installed into both real vaults.
 *
 * Flow: health → claim (record v0.1.3 richer response) → admin login → 2 pair
 * codes → launch BOTH throwaway-profile instances → per vault: probe stale
 * link (unlink if present), CLEAN pair via pairFromSettings (no
 * --disable-web-security, no overrides) → ONE bidirectional check (v4 create →
 * v5 arrival; v5 edit → v4) → /api/status both online + 0 conflicts → teardown
 * (Obsidian killed, worker 8797 LEFT RUNNING, vaults LEFT PAIRED).
 *
 * Usage: node scripts/e2e/reprov-2vault.mjs   → report-reprov.json
 */

import { execFile, spawn } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { connectPage, listTargets } from './cdp.mjs';

const execFileP = promisify(execFile);
const HERE = join(fileURLToPath(import.meta.url), '..');

const WORKER = 'http://127.0.0.1:8797'; // always 127.0.0.1, never localhost
const PASSPHRASE = 'two-vault-test';
const VAULT_NAME = 'two-vault-test';
const OBSIDIAN_EXE = 'C:\\Program Files\\Obsidian\\Obsidian.exe';
const PROFILE_A = 'Z:/Projects/TestVaults/e2e-2vault-profile';
const PROFILE_B = 'Z:/Projects/TestVaults/e2e-2vault-profile-b';
const CDP_A = 'http://127.0.0.1:9222';
const CDP_B = 'http://127.0.0.1:9223';
const DEVICE4 = 'e2e-vault4';
const DEVICE5 = 'e2e-vault5';
const SYNC_TIMEOUT_MS = 25_000;
const jstr = JSON.stringify;

const report = { startedAt: new Date().toISOString(), worker: WORKER, cleanMode: { webSecurityDisabled: false, overridesInjected: false }, steps: [] };
const lines = [];
function step(id, name) {
  const entry = { id, name, status: 'RUNNING', t0: Date.now() };
  report.steps.push(entry);
  lines.push(`[RUN ] ${id} ${name}`);
  return {
    pass(detail) { entry.status = 'PASS'; entry.ms = Date.now() - entry.t0; entry.detail = detail; lines.push(`[PASS] ${id} ${name} (${entry.ms} ms) — ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`); },
    fail(detail) { entry.status = 'FAIL'; entry.ms = Date.now() - entry.t0; entry.detail = detail; lines.push(`[FAIL] ${id} ${name} (${entry.ms} ms) — ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`); },
  };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, timeoutMs, everyMs = 500, label = '') {
  const t0 = Date.now(); let lastErr;
  for (;;) {
    try { const v = await fn(); if (v !== undefined && v !== null && v !== false) return { value: v, elapsedMs: Date.now() - t0 }; } catch (e) { lastErr = e; }
    if (Date.now() - t0 > timeoutMs) throw new Error(`waitFor${label ? `(${label})` : ''} timed out after ${timeoutMs} ms${lastErr ? ` (last: ${lastErr})` : ''}`);
    await sleep(everyMs);
  }
}
async function wk(path, init = {}) {
  const res = await fetch(`${WORKER}${path}`, { signal: AbortSignal.timeout(10_000), ...init });
  const text = await res.text();
  let body; try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, body, headers: res.headers };
}

// --- vault helpers over CDP ---------------------------------------------------------------

const exists = async (cdp, p) => {
  const r = await cdp.eval(`app.vault.adapter.exists(${jstr(p)}).then(v => ({ok:true, v}), e => ({ok:false, error:String(e)}))`);
  if (!r.ok) throw new Error(r.error);
  return r.value.v === true;
};
const readTextOrNull = async (cdp, p) => {
  const r = await cdp.eval(`(async()=>{ try { return { ok:true, text: await app.vault.adapter.read(${jstr(p)}) }; } catch(e){ return { ok:false }; } })()`);
  if (!r.ok) throw new Error(r.error);
  return r.value.ok ? r.value.text : null;
};
const pluginStatus = async (cdp) => {
  const r = await cdp.eval(`(() => { const p = app.plugins?.plugins?.vaultsyncforagents; if (!p) return null;
    return { linked: p.linked, statusBar: p.statusBarItem?.textContent ?? null, status: p.client?.status?.() ?? null,
             deviceId: p.data?.deviceId ?? null, version: p.manifest?.version ?? null, overridesFetch: typeof p.overrides?.fetchImpl,
             paused: p.paused ?? null }; })()`);
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

// --- launch ------------------------------------------------------------------------------

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
  await waitFor(async () => { try { return (await listTargets(http)).some((t) => t.type === 'page'); } catch { return null; } }, 60_000, 1000, `${label}: CDP up`);
  let cdp = null; const dialogs = [];
  await waitFor(async () => {
    if (cdp === null) { try { cdp = await connectPage({ match, http }); } catch { return null; } }
    dialogs.push(...(await driveFirstRunDialogs(cdp)));
    const probe = await cdp.eval('!!(app.plugins?.plugins?.vaultsyncforagents)');
    return probe.ok && probe.value === true;
  }, 120_000, 1500, `${label}: plugin loaded`);
  return { cdp, dialogsClicked: [...new Set(dialogs)], readyMs: Date.now() - t0 };
}

const FATAL_PATTERNS = [/blocked by CORS policy/i, /Access-Control-Allow-Origin/i, /Illegal invocation/i, /Failed to execute 'fetch'/i];
function fatalConsoleHits(cdps) {
  const hits = [];
  for (const [name, cdp] of Object.entries(cdps)) {
    if (!cdp) continue;
    for (const entry of cdp.consoleLog) if (FATAL_PATTERNS.some((re) => re.test(entry.text))) hits.push({ vault: name, ...entry });
  }
  return hits;
}

/** Probe stale link → unlink if present → CLEAN pair with `code`. */
async function reprovisionVault({ cdp, code, deviceName, label }) {
  const pre = await pluginStatus(cdp);
  let unlinkOutcome = 'not-needed (plugin already unlinked)';
  if (pre?.linked === true) {
    const r = await cdp.eval(`(async()=>{ const p = app.plugins.plugins.vaultsyncforagents; await p.unlink(); return { linked: p.linked, tokenLen: (p.data.token||'').length }; })()`);
    if (!r.ok) throw new Error(`unlink: ${r.error}`);
    unlinkOutcome = `unlinked stale device ${pre.deviceId} (post: linked=${r.value.linked}, tokenLen=${r.value.tokenLen})`;
    await sleep(1000);
  }
  const pairT0 = Date.now();
  const outcome = await cdp.eval(`(async () => {
    const p = app.plugins.plugins.vaultsyncforagents;
    p.data.url = ${jstr(WORKER)};
    p.data.deviceName = ${jstr(deviceName)};
    const raced = await Promise.race([
      p.pairFromSettings(${jstr(code)}).then(o => ({ done: true, outcome: o })),
      new Promise(r => setTimeout(() => r({ done: false }), 25000)),
    ]);
    return { raced, overridesFetch: typeof p.overrides.fetchImpl, version: p.manifest?.version ?? null,
             data: { url: p.data.url, deviceId: p.data.deviceId, tokenLen: (p.data.token || '').length, deviceName: p.data.deviceName } };
  })()`);
  if (!outcome.ok) throw new Error(`pair eval: ${outcome.error}`);
  let final = outcome.value;
  if (!final.raced.done) {
    const got = await waitFor(async () => {
      const r = await cdp.eval(`(async()=>{ const d = JSON.parse(await app.vault.adapter.read('.obsidian/plugins/vaultsyncforagents/data.json')); return (d.token||'').length > 10 ? d : null; })()`);
      return r.ok ? r.value : null;
    }, 30_000, 1000, `${label} token persisted`);
    final = { raced: { done: true, outcome: { status: 'paired', late: true } }, data: got, overridesFetch: final.overridesFetch, version: final.version };
  }
  const sb = await waitFor(async () => {
    const st = await pluginStatus(cdp);
    return st?.statusBar?.startsWith('vsa ✓') ? st : null;
  }, 30_000, 1000, `${label} status bar ✓`);
  if (final.raced.outcome.status !== 'paired') throw new Error(`pair outcome: ${JSON.stringify(final.raced.outcome)}`);
  if (final.overridesFetch !== 'undefined') throw new Error(`overrides.fetchImpl set (${final.overridesFetch}) — not clean`);
  return {
    pluginVersion: final.version ?? pre?.version,
    preState: { linked: pre?.linked ?? null, staleDeviceId: pre?.deviceId ?? null },
    unlink: unlinkOutcome,
    pairOutcome: final.raced.outcome,
    pairCallMs: Date.now() - pairT0,
    persisted: { url: final.data.url, deviceId: final.data.deviceId, tokenLen: final.data.tokenLen, deviceName: final.data.deviceName },
    statusBar: sb.value.statusBar,
    clientState: sb.value.status?.state,
    overridesFetchImpl: final.overridesFetch,
  };
}

// --- main -----------------------------------------------------------------------------------

let cdp4 = null, cdp5 = null, cookie = null, exitCode = 0, fatalStop = false;
const pairCodes = {};

try {
  // R0: worker fresh + prep
  {
    const s = step('R0', 'worker fresh/unclaimed; kill Obsidian; write throwaway profiles');
    try {
      const health = await wk('/health');
      if (health.status !== 200 || health.body.ok !== true) throw new Error(`/health: ${JSON.stringify(health.body)}`);
      if (health.body.claimed !== false) throw new Error(`expected UNCLAIMED, got: ${JSON.stringify(health.body)}`);
      await execFileP('taskkill', ['/F', '/IM', 'Obsidian.exe']).catch(() => {});
      await sleep(1500);
      const { stdout: pa } = await execFileP(process.execPath, [join(HERE, 'write-profile.mjs'), PROFILE_A, 'Z:/Projects/TestVaults/TestVault4', 'Z:/Projects/TestVaults/TestVault5']);
      const { stdout: pb } = await execFileP(process.execPath, [join(HERE, 'write-profile.mjs'), PROFILE_B, 'Z:/Projects/TestVaults/TestVault5', 'Z:/Projects/TestVaults/TestVault4']);
      s.pass({ health: health.body, note: `v0.1.3 worker reports serverVersion=${health.body.serverVersion} protocolVersion=${health.body.protocolVersion}`, profileA: pa.trim(), profileB: pb.trim() });
    } catch (e) { s.fail(String(e.message ?? e)); fatalStop = true; }
  }

  // R1: claim + admin + two codes
  {
    const s = step('R1', 'claim worker (v0.1.3), admin login, mint TWO pairing codes');
    try {
      if (fatalStop) throw new Error('skipped');
      const claim = await wk('/claim', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ passphrase: PASSPHRASE, vaultName: VAULT_NAME, deviceName: 'e2e-admin', deviceType: 'desktop' }),
      });
      if (claim.status !== 200) throw new Error(`claim HTTP ${claim.status}: ${JSON.stringify(claim.body)}`);
      const login = await wk('/admin/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ passphrase: PASSPHRASE }) });
      if (login.status !== 200) throw new Error(`admin login HTTP ${login.status}`);
      cookie = (login.headers.get('set-cookie') ?? '').split(';')[0];
      for (const [key, dev] of [['code4', DEVICE4], ['code5', DEVICE5]]) {
        const res = await wk('/admin/pair', { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify({ deviceName: dev, deviceType: 'desktop' }) });
        if (res.status !== 200 || typeof res.body?.code !== 'string') throw new Error(`admin/pair ${dev} HTTP ${res.status}: ${JSON.stringify(res.body)}`);
        pairCodes[key] = res.body.code;
      }
      s.pass({
        claimResponseFields: Object.keys(claim.body),
        claim: { ok: claim.body.ok, vaultName: claim.body.vaultName, adminDeviceId: claim.body.deviceId, tokenMinted: typeof claim.body.token === 'string' && claim.body.token.length > 10 },
        pairingCodes: { vault4: pairCodes.code4, vault5: pairCodes.code5 },
      });
    } catch (e) { s.fail(String(e.message ?? e)); fatalStop = true; }
  }

  // R2: vault4 — unlink-if-needed + clean pair
  {
    const s = step('R2', 'TestVault4: probe stale link, unlink if present, CLEAN pair with code#1');
    try {
      if (fatalStop) throw new Error('skipped');
      const pid = launchObsidian(PROFILE_A, 9222);
      const ready = await awaitInstanceReady({ http: CDP_A, match: 'TestVault4', label: 'vault4' });
      cdp4 = ready.cdp;
      const result = await reprovisionVault({ cdp: cdp4, code: pairCodes.code4, deviceName: DEVICE4, label: 'vault4' });
      const cors = fatalConsoleHits({ vault4: cdp4 });
      if (cors.length) throw new Error(`FIX-REGRESSION console hits: ${JSON.stringify(cors.slice(0, 3))}`);
      s.pass({ headline: 'vault4 re-paired CLEAN on v0.1.3 (no workarounds)', pid, instanceReadyMs: ready.readyMs, dialogs: ready.dialogsClicked, ...result });
    } catch (e) {
      s.fail(String(e.message ?? e));
      report.r2ConsoleHits = fatalConsoleHits({ vault4: cdp4 }).slice(0, 10);
      if (/CORS|Illegal invocation|pair outcome|overrides/i.test(String(e.message ?? e))) fatalStop = true;
    }
  }

  // R3: vault5 — unlink-if-needed + clean pair + both online
  {
    const s = step('R3', 'TestVault5: probe stale link, unlink if present, CLEAN pair with code#2; both devices online');
    try {
      if (fatalStop) throw new Error('skipped');
      const pid = launchObsidian(PROFILE_B, 9223);
      const ready = await awaitInstanceReady({ http: CDP_B, match: 'TestVault5', label: 'vault5' });
      cdp5 = ready.cdp;
      const result = await reprovisionVault({ cdp: cdp5, code: pairCodes.code5, deviceName: DEVICE5, label: 'vault5' });
      const cors = fatalConsoleHits({ vault4: cdp4, vault5: cdp5 });
      if (cors.length) throw new Error(`FIX-REGRESSION console hits: ${JSON.stringify(cors.slice(0, 3))}`);
      const st = await waitFor(async () => {
        const res = await wk('/api/status', { headers: { cookie } });
        const devices = res.body?.devices ?? [];
        const online = devices.filter((d) => d.online).map((d) => d.name);
        return online.includes(DEVICE4) && online.includes(DEVICE5) ? devices : null;
      }, 30_000, 1000, 'both devices online');
      s.pass({
        headline: 'vault5 re-paired CLEAN; BOTH devices online in the fresh room',
        pid, instanceReadyMs: ready.readyMs, dialogs: ready.dialogsClicked,
        devices: st.value.map((d) => `${d.name}(${d.type},${d.online ? 'online' : 'offline'})`),
        ...result,
      });
    } catch (e) {
      s.fail(String(e.message ?? e));
      report.r3ConsoleHits = fatalConsoleHits({ vault4: cdp4, vault5: cdp5 }).slice(0, 10);
      if (/CORS|Illegal invocation|pair outcome|overrides/i.test(String(e.message ?? e))) fatalStop = true;
    }
  }

  // R4: ONE bidirectional verification
  {
    const s = step('R4', 'bidirectional: v4 create reprov-note.md → v5 byte-identical; v5 edit → v4 updated');
    const runOnce = async () => {
      const stamp = Date.now();
      const v1 = `reprovision from vault4 ${stamp}`;
      const created = await cdp4.eval(`app.vault.create('reprov-note.md', ${jstr(v1)}).then(() => 'created')`);
      if (!created.ok) throw new Error(`create: ${created.error}`);
      const msDown = await waitFor(async () => {
        if (!(await exists(cdp5, 'reprov-note.md'))) return null;
        return (await readTextOrNull(cdp5, 'reprov-note.md')) === v1 ? true : null;
      }, SYNC_TIMEOUT_MS, 400, 'v5 arrival').then((r) => r.elapsedMs);
      const v2 = `edited in vault5 after reprovision ${stamp}`;
      const mod = await cdp5.eval(`app.vault.modify(app.vault.getAbstractFileByPath('reprov-note.md'), ${jstr(v2)}).then(() => 'modified')`);
      if (!mod.ok) throw new Error(`modify: ${mod.error}`);
      const msUp = await waitFor(async () => {
        return (await readTextOrNull(cdp4, 'reprov-note.md')) === v2 ? true : null;
      }, SYNC_TIMEOUT_MS, 400, 'v4 sees edit').then((r) => r.elapsedMs);
      return { createToVault5Ms: msDown, editToVault4Ms: msUp, contents: { v1, v2 } };
    };
    if (fatalStop || !cdp4 || !cdp5) s.fail('skipped (fatal earlier)');
    else {
      try { s.pass(await runOnce()); }
      catch (first) {
        lines.push(`  retry-after-error: ${String(first.message ?? first).slice(0, 300)}`);
        try { s.pass(await runOnce()); } catch (e) { s.fail(String(e.message ?? e)); }
      }
    }
  }

  // R5: status + conflicts at rest
  {
    const s = step('R5', '/api/status both online; 0 conflicts, live, pending 0 in both plugins');
    try {
      if (fatalStop || !cdp4 || !cdp5) throw new Error('skipped');
      await sleep(2500);
      const st = await wk('/api/status', { headers: { cookie } });
      const devices = (st.body?.devices ?? []).map((d) => `${d.name}(${d.online ? 'online' : 'offline'})`);
      const online = (st.body?.devices ?? []).filter((d) => d.online).map((d) => d.name);
      if (!online.includes(DEVICE4) || !online.includes(DEVICE5)) throw new Error(`not both online: ${devices.join(', ')}`);
      const [s4, s5] = await Promise.all([pluginStatus(cdp4), pluginStatus(cdp5)]);
      const [c4, c5] = await Promise.all([conflictFiles(cdp4), conflictFiles(cdp5)]);
      const bad = [];
      if (c4.length) bad.push(`vault4 conflict files: ${c4.join(', ')}`);
      if (c5.length) bad.push(`vault5 conflict files: ${c5.join(', ')}`);
      for (const [name, stx] of [['vault4', s4], ['vault5', s5]]) {
        if (stx?.status?.state !== 'live') bad.push(`${name} state=${stx?.status?.state}`);
        if (stx?.status?.pending !== 0) bad.push(`${name} pending=${stx?.status?.pending}`);
        if ((stx?.status?.conflicts ?? []).length !== 0) bad.push(`${name} client conflicts=${stx.status.conflicts.length}`);
        if (!stx?.statusBar?.startsWith('vsa ✓')) bad.push(`${name} statusBar=${stx?.statusBar}`);
      }
      if (bad.length) throw new Error(bad.join('; '));
      s.pass({
        devices, vaultName: st.body?.vaultName, lastEdit: st.body?.lastEdit ?? null,
        vault4: { state: s4.status.state, pending: s4.status.pending, statusBar: s4.statusBar, paused: s4.paused },
        vault5: { state: s5.status.state, pending: s5.status.pending, statusBar: s5.statusBar, paused: s5.paused },
        conflictFiles: { vault4: c4, vault5: c5 },
      });
    } catch (e) { s.fail(String(e.message ?? e)); }
  }

  if (cdp4 && cdp5) {
    try { report.finalFiles = { vault4: await allFiles(cdp4), vault5: await allFiles(cdp5) }; } catch { /* best effort */ }
  }
} catch (fatal) {
  lines.push(`[FATAL] ${String(fatal?.stack ?? fatal)}`);
  report.fatal = String(fatal?.message ?? fatal);
} finally {
  report.consoleProblems = {};
  for (const [name, cdp] of [['vault4', cdp4], ['vault5', cdp5]]) {
    if (!cdp) continue;
    report.consoleProblems[name] = cdp.consoleLog.filter((e) => ['error', 'warning', 'warn'].includes(String(e.level).toLowerCase()));
  }
  report.finishedAt = new Date().toISOString();
  const failed = report.steps.filter((x) => x.status === 'FAIL' || x.status === 'RUNNING').length;
  const passed = report.steps.filter((x) => x.status === 'PASS').length;
  report.overall = failed === 0 ? 'PASS' : 'FAIL';
  exitCode = failed === 0 ? 0 : 1;
  lines.push('');
  lines.push(`SUMMARY: ${passed} PASS, ${failed} FAIL — overall ${report.overall}`);
  lines.push('Clean-mode re-pairing verdict: ' + ((report.steps.find((x) => x.id === 'R2')?.status === 'PASS' && report.steps.find((x) => x.id === 'R3')?.status === 'PASS')
    ? 'BOTH vaults re-paired on plugin v0.1.3 with ZERO workarounds'
    : 'see R2/R3'));
  const totalProblems = Object.values(report.consoleProblems).reduce((a, b) => a + b.length, 0);
  lines.push(`Console errors/warnings captured: ${totalProblems}`);
  for (const [name, entries] of Object.entries(report.consoleProblems)) for (const c of entries.slice(0, 10)) lines.push(`  [${name} ${c.level}] ${c.text.slice(0, 240)}`);
  try { writeFileSync(join(HERE, 'report-reprov.json'), JSON.stringify(report, null, 2)); } catch { /* best effort */ }
  cdp4?.close();
  cdp5?.close();
  await execFileP('taskkill', ['/F', '/IM', 'Obsidian.exe']).catch(() => {});
  lines.push('TEARDOWN: Obsidian killed; worker 8797 LEFT RUNNING; both vaults LEFT PAIRED (dogfood state).');
  console.log(lines.join('\n'));
  process.exit(exitCode);
}
