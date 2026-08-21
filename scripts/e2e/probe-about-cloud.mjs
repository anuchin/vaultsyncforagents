/**
 * Focused F-2 About-tab re-verification (the A4 retry after the harness bug in
 * scenario-fix-verify-cloud.mjs run 1: `waitFor` returns {value, elapsedMs} and
 * the run forgot to unwrap .value before regexing — the storage line itself
 * HAD rendered real data). Launches ONLY vault4 (already paired + synced),
 * opens the plugin's real settings tab (settings modal has never rendered in
 * this Obsidian build; the registered VaultSyncSettingTab instance is
 * displayed into a mounted host div — the same render code path), and asserts:
 *
 *   1. the About "Vault storage" row shows REAL numbers from the worker
 *      (cross-checked against the admin /api/status view)
 *   2. ZERO CORS-pattern / error-level console entries for /api/status
 *
 * Usage: node scripts/e2e/probe-about-cloud.mjs   (VSA_E2E_WORKER/VSA_E2E_PASSPHRASE)
 * Writes scripts/e2e/report-about-cloud-probe.json.
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
const PROFILE_A = 'Z:/Projects/TestVaults/e2e-hardened-profile';
const CDP_A = 'http://127.0.0.1:9222';

const jstr = JSON.stringify;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = { startedAt: new Date().toISOString(), worker: WORKER, ok: false };

async function waitFor(fn, timeoutMs, everyMs = 400, label = '') {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v !== undefined && v !== null && v !== false) return v;
    if (Date.now() - t0 > timeoutMs) throw new Error(`waitFor(${label}) timed out after ${timeoutMs} ms`);
    await sleep(everyMs);
  }
}

try {
  await execFileP('taskkill', ['/F', '/IM', 'Obsidian.exe']).catch(() => {});
  await sleep(1500);

  const login = await fetch(`${WORKER}/admin/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ passphrase: PASSPHRASE }),
  });
  const cookie = (login.headers.get('set-cookie') ?? '').split(';')[0];
  if (login.status !== 200) throw new Error(`admin login HTTP ${login.status}`);
  const st = await (await fetch(`${WORKER}/api/status`, { headers: { cookie } })).json();
  out.workerStatus = {
    storageBytes: st.storageBytes,
    attachments: st.attachments,
    devices: (st.devices ?? []).length,
  };

  const { stdout } = await execFileP(process.execPath, [join(HERE, 'write-profile.mjs'), PROFILE_A, V4_DIR]);
  out.profile = stdout.trim();
  const child = spawn(OBSIDIAN_EXE, [`--user-data-dir=${PROFILE_A}`, '--remote-debugging-port=9222'], { detached: true, stdio: 'ignore' });
  child.unref();

  await waitFor(async () => {
    try {
      return (await listTargets(CDP_A)).some((t) => t.type === 'page');
    } catch {
      return false;
    }
  }, 60_000, 1000, 'CDP up');
  const cdp = await waitFor(async () => {
    try {
      return await connectPage({ match: 'TestVault4', http: CDP_A });
    } catch {
      return null;
    }
  }, 120_000, 1500, 'vault4 page');
  await waitFor(async () => {
    const r = await cdp.eval('!!(app.plugins?.plugins?.vaultsyncforagents)');
    return r.ok && r.value === true;
  }, 120_000, 1500, 'plugin loaded');
  out.liveBar = (await waitFor(async () => {
    const r = await cdp.eval(`app.plugins.plugins.vaultsyncforagents.statusBarItem?.textContent ?? null`);
    return r.ok && String(r.value ?? '').startsWith('vsa ✓') ? r.value : null;
  }, 60_000, 1000, 'vault4 live')).value ?? (await cdp.eval(`app.plugins.plugins.vaultsyncforagents.statusBarItem?.textContent ?? null`)).value;

  // --- open the REAL settings tab (modal has never rendered in this build) ---
  const consoleMark = cdp.consoleLog.length;
  const open = await cdp.eval(`(async () => {
    try { app.setting.open(); } catch (e) {}
    await new Promise((r) => setTimeout(r, 1500));
    const items = document.querySelectorAll('.setting-item').length;
    let modal = items > 0;
    if (modal) { try { app.setting.openTabById('vaultsyncforagents'); } catch (e) {} }
    let via = modal ? 'modal' : null;
    if (!modal) {
      const tabs = [...((app.setting && app.setting.settingTabs) || []), ...((app.setting && app.setting.pluginTabs) || [])];
      let tab = tabs.find(t => t.plugin?.manifest?.id === 'vaultsyncforagents')
        || tabs.find(t => t.id === 'vaultsyncforagents')
        || tabs.find(t => t.constructor && t.constructor.name === 'VaultSyncSettingTab');
      if (!tab) return { ok: false, why: 'no-tab-instance', tabCount: tabs.length,
        ids: tabs.map(t => ({ id: t.id ?? null, cls: t.constructor?.name ?? null, hasPlugin: !!t.plugin })) };
      const host = document.createElement('div');
      host.id = 'vsa-e2e-settings-host';
      document.body.appendChild(host);
      tab.containerEl = host;
      await tab.display();
      via = 'detached-tab(' + (app.setting.pluginTabs?.includes(tab) ? 'pluginTabs' : 'settingTabs') + ')';
      modal = true;
    }
    return { ok: true, via };
  })()`);
  if (!open.ok || open.value?.ok !== true) throw new Error(`settings open: ${jstr(open.value ?? open.error)}`);
  out.uiPath = open.value.via;

  const line = await waitFor(async () => {
    const r = await cdp.eval(`(() => {
      const item = [...document.querySelectorAll('.setting-item')].find(el => el.querySelector('.setting-item-name')?.textContent?.trim() === 'Vault storage');
      return item ? (item.querySelector('.setting-item-description')?.textContent ?? '') : null;
    })()`);
    return r.ok && typeof r.value === 'string' && /Storage used:/i.test(r.value) && !/Checking the worker|unavailable/i.test(r.value) ? r.value : null;
  }, 25_000, 500, 'storage line');
  out.storageLine = line;

  // --- assertions ---
  const problems = [];
  const m = /Storage used:\s*([\d.]+)\s*(B|KB|MB|GB)/i.exec(line);
  if (!m) problems.push(`no storage magnitude in line: ${line}`);
  if (!new RegExp(`${out.workerStatus.attachments.count}\\s*attachment`, 'i').test(line)) problems.push(`attachment count missing/mismatch (worker: ${out.workerStatus.attachments.count})`);
  if (out.workerStatus.devices > 0 && !new RegExp(`${out.workerStatus.devices}\\s*device`, 'i').test(line)) problems.push(`device count missing/mismatch (worker: ${out.workerStatus.devices})`);
  await sleep(1500);
  const window5 = cdp.consoleLog.slice(consoleMark);
  out.consoleWindowEntries = window5.length;
  const FATAL = [/blocked by CORS policy/i, /Access-Control-Allow-Origin/i, /Illegal invocation/i, /Failed to execute 'fetch'/i];
  const cors = window5.filter((e) => FATAL.some((re) => re.test(e.text)));
  const apiErrs = window5.filter((e) => /api\/status/i.test(e.text) && String(e.level).toLowerCase() === 'error');
  if (cors.length) problems.push(`CORS-pattern console entries: ${jstr(cors.slice(0, 3))}`);
  if (apiErrs.length) problems.push(`error-level /api/status console entries: ${jstr(apiErrs.slice(0, 3))}`);
  out.crossCheck = { line: line, workerStatus: out.workerStatus };
  out.problems = problems;
  out.ok = problems.length === 0;

  await cdp.eval(`(() => { try { app.setting.close(); } catch (e) {} const h = document.getElementById('vsa-e2e-settings-host'); if (h) h.remove(); return 'closed'; })()`).catch(() => {});
  cdp.close();
} catch (e) {
  out.fatal = String(e?.stack ?? e);
} finally {
  await execFileP('taskkill', ['/F', '/IM', 'Obsidian.exe']).catch(() => {});
  out.finishedAt = new Date().toISOString();
  try {
    writeFileSync(join(HERE, 'report-about-cloud-probe.json'), JSON.stringify(out, null, 2));
  } catch { /* best effort */ }
  console.log(JSON.stringify(out, null, 2));
  process.exit(out.ok ? 0 : 1);
}
