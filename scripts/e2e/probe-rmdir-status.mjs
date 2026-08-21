/**
 * One-vault diagnostic probe (vault4, CDP 9222):
 *   1. Does Obsidian's desktop DataAdapter.rmdir actually remove an empty folder?
 *   2. Does the renderer's cross-origin GET /api/status succeed (F-2)?
 *   3. What does the About "Vault storage" line actually render?
 * Kills Obsidian afterwards. Prints findings as JSON.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { connectPage, listTargets } from './cdp.mjs';

const execFileP = promisify(execFile);
const OBSIDIAN_EXE = 'C:\\Program Files\\Obsidian\\Obsidian.exe';
const PROFILE_A = 'Z:/Projects/TestVaults/e2e-hardened-profile';
const PORT_A = 9222;
const CDP_A = `http://127.0.0.1:${PORT_A}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, timeoutMs, everyMs = 500, label = '') {
  const t0 = Date.now();
  for (;;) {
    try {
      const v = await fn();
      if (v !== undefined && v !== null && v !== false) return v;
    } catch {}
    if (Date.now() - t0 > timeoutMs) throw new Error(`waitFor(${label}) timed out after ${timeoutMs} ms`);
    await sleep(everyMs);
  }
}

const out = {};
try {
  await execFileP('taskkill', ['/F', '/IM', 'Obsidian.exe']).catch(() => {});
  await sleep(1500);
  const { spawn } = await import('node:child_process');
  spawn(OBSIDIAN_EXE, [`--user-data-dir=${PROFILE_A}`, `--remote-debugging-port=${PORT_A}`], { detached: true, stdio: 'ignore' });
  await waitFor(async () => (await listTargets(CDP_A).catch(() => [])).some((t) => t.type === 'page'), 60_000, 1000, 'CDP up');
  let cdp = null;
  await waitFor(async () => {
    if (cdp === null) {
      try { cdp = await connectPage({ match: 'TestVault4', http: CDP_A }); } catch { return null; }
    }
    const probe = await cdp.eval('!!(app.plugins?.plugins?.vaultsyncforagents)');
    return probe.ok && probe.value === true ? true : null;
  }, 120_000, 1500, 'plugin loaded');
  await waitFor(async () => {
    const r = await cdp.eval(`(() => { const p = app.plugins.plugins.vaultsyncforagents; return p?.client?.status?.().state === 'live'; })()`);
    return r.ok && r.value === true;
  }, 45_000, 1000, 'client live');
  await sleep(3000);

  // 1. rmdir probe on a fresh empty folder
  out.rmdirProbe = await cdp.eval(`(async () => {
    const name = 'rmdir-probe-' + Date.now();
    try { await app.vault.createFolder(name); } catch (e) { return { stage: 'createFolder', error: String(e) }; }
    try {
      await app.vault.adapter.rmdir(name, false);
      const gone = !(await app.vault.adapter.exists(name));
      return { stage: 'rmdir', rmdirResolved: true, dirGone: gone };
    } catch (e) {
      const stillThere = await app.vault.adapter.exists(name).catch(() => 'unknown');
      return { stage: 'rmdir', rmdirThrew: String(e), dirStillThere: stillThere };
    }
  })()`);
  if (!out.rmdirProbe.ok) out.rmdirProbe = { evalError: out.rmdirProbe.error };

  // 1b. adapter method presence on the plugin's own storage adapter
  out.adapterHasRemoveDir = await cdp.eval(`(() => {
    const p = app.plugins.plugins.vaultsyncforagents;
    const cand = p.storageAdapter ?? p.storage ?? null;
    return { exposedProperty: cand !== null, typeofRemoveDir: cand ? typeof cand.removeDir : 'no-adapter-exposed' };
  })()`);

  // 2. renderer cross-origin /api/status fetch
  out.statusFetch = await cdp.eval(`(async () => {
    const p = app.plugins.plugins.vaultsyncforagents;
    try {
      const res = await fetch(p.data.url + '/api/status', { headers: { authorization: 'Bearer ' + p.data.token } });
      const body = await res.json().catch(() => null);
      return { ok: true, status: res.status, storageBytes: body?.storageBytes, devices: (body?.devices ?? []).length };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  })()`);
  if (!out.statusFetch.ok) out.statusFetch = { evalError: out.statusFetch.error };

  // 3. About section render
  const before = cdp.consoleLog.length;
  await cdp.eval(`(async () => { app.setting.open(); app.setting.openTabById('vaultsyncforagents'); return 'opened'; })()`);
  await sleep(4000);
  out.aboutDesc = await cdp.eval(`(() => {
    const item = [...document.querySelectorAll('.setting-item')].find(el => el.querySelector('.setting-item-name')?.textContent === 'Vault storage');
    return item?.querySelector('.setting-item-description')?.textContent ?? null;
  })()`);
  out.settingTabCount = await cdp.eval(`document.querySelectorAll('.setting-item').length`);
  out.consoleDuringAbout = cdp.consoleLog.slice(before).map((e) => ({ level: e.level, text: String(e.text).slice(0, 160) }));
  await cdp.eval(`(() => { try { app.setting.close(); } catch (e) {} return 'closed'; })()`);
} catch (e) {
  out.fatal = String(e?.stack ?? e);
} finally {
  console.log(JSON.stringify(out, null, 2));
  await execFileP('taskkill', ['/F', '/IM', 'Obsidian.exe']).catch(() => {});
  process.exit(0);
}
