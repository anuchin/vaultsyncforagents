/**
 * End-to-end scenario for the VaultSyncforAgents Obsidian plugin, driving the
 * REAL Obsidian app over CDP (see cdp.mjs) and a real `wrangler dev` worker on
 * http://localhost:8801 (claim state in packages/worker/.wrangler/devstate-e2e).
 *
 * Steps: plugin load → claim/admin/pair-code → plugin pairing → push → edit →
 * CLI second-device pull/push → status dashboard → conflict smoke.
 *
 * Usage: node scripts/e2e/scenario.mjs
 * Exit code 0 iff every step passed. Report also written to scripts/e2e/report.json.
 */

import { execFile } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { connectPage } from './cdp.mjs';

const execFileP = promisify(execFile);
const HERE = dirnameOf(import.meta.url);
const REPO = join(HERE, '..', '..');
const WORKER = 'http://localhost:8801';
const PASSPHRASE = 'e2e-test-pass';
const VAULT_NAME = 'e2e-vault';
const PUSH_NOTE = 'e2e-push-test.md';
const CLI_NOTE = 'e2e-cli-note.md';
const CLI_VAULT = 'Z:/Projects/TestVaults/e2e-cli-vault';
const CLI_CONFIG = 'Z:/Projects/TestVaults/e2e-cli-config.json';
const VSA = join(REPO, 'packages', 'cli', 'bin', 'vsa.js');

function dirnameOf(u) {
  return join(fileURLToPath(u), '..');
}

// --- reporting ------------------------------------------------------------------------------

const report = { startedAt: new Date().toISOString(), worker: WORKER, steps: [] };
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
      lines.push(`[PASS] ${id} ${name} (${entry.ms} ms)${detail === undefined ? '' : ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`}`);
    },
    fail(detail) {
      entry.status = 'FAIL';
      entry.ms = Date.now() - entry.t0;
      entry.detail = detail;
      lines.push(`[FAIL] ${id} ${name} (${entry.ms} ms) — ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`);
    },
  };
}

function log(...a) {
  lines.push(a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' '));
}

// --- worker HTTP helpers ----------------------------------------------------------------------

async function wk(path, init = {}) {
  const res = await fetch(`${WORKER}${path}`, init);
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
  const res = await wk('/admin/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ passphrase: PASSPHRASE }),
  });
  if (res.status !== 200) throw new Error(`admin login HTTP ${res.status}: ${JSON.stringify(res.body)}`);
  const setCookie = res.headers.get('set-cookie') ?? '';
  const cookie = setCookie.split(';')[0];
  return cookie;
}

async function mintPairCode(cookie, deviceName, deviceType = 'desktop') {
  const res = await wk('/admin/pair', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ deviceName, deviceType }),
  });
  if (res.status !== 200) throw new Error(`admin pair HTTP ${res.status}: ${JSON.stringify(res.body)}`);
  return res.body.code;
}

async function apiGet(cookie, path) {
  return wk(path, { headers: { cookie } });
}

async function historyOf(cookie, vaultPath, timeoutMs = 20000) {
  const t0 = Date.now();
  let last = null;
  while (Date.now() - t0 < timeoutMs) {
    const res = await apiGet(cookie, `/api/history?path=${encodeURIComponent(vaultPath)}`);
    last = res;
    if (res.status === 200 && Array.isArray(res.body.versions) && res.body.versions.length > 0) {
      return { elapsedMs: Date.now() - t0, ...res.body };
    }
    await sleep(500);
  }
  throw new Error(`history for ${vaultPath} empty after ${timeoutMs} ms (last: ${JSON.stringify(last?.body)})`);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitFor(fn, timeoutMs, everyMs = 500) {
  const t0 = Date.now();
  let lastErr;
  for (;;) {
    try {
      const v = await fn();
      if (v) return { value: v, elapsedMs: Date.now() - t0 };
    } catch (e) {
      lastErr = e;
    }
    if (Date.now() - t0 > timeoutMs) {
      throw new Error(`waitFor timed out after ${timeoutMs} ms${lastErr ? ` (last: ${lastErr})` : ''}`);
    }
    await sleep(everyMs);
  }
}

async function vsa(args) {
  const { stdout, stderr } = await execFileP(process.execPath, [VSA, ...args], {
    cwd: REPO,
    timeout: 60000,
    env: { ...process.env, NO_COLOR: '1' },
  });
  return { stdout: stdout.trim(), stderr: stderr.trim() };
}

// --- main --------------------------------------------------------------------------------------

let cdp;
let cookie;
let exitCode = 0;

try {
  // -- connect CDP (early: console capture starts here) --------------------------------------
  cdp = await connectPage({ match: 'TestVault4-e2e' });
  log(`CDP connected to target: ${cdp.targetTitle}`);

  // STEP a: plugin loaded ----------------------------------------------------------------------
  {
    const s = step('a', 'plugin loaded in real Obsidian');
    const basePath = await cdp.eval('app.vault.adapter.basePath');
    const loaded = await cdp.eval('!!app.plugins?.plugins?.vaultsyncforagents');
    const enabled = await cdp.eval('app.plugins.enabledPlugins.has("vaultsyncforagents")');
    const pairable = await cdp.eval('typeof app.plugins.plugins.vaultsyncforagents?.pairFromSettings');
    if (basePath.ok && loaded.ok && enabled.ok && pairable.ok && loaded.value === true && enabled.value === true && pairable.value === 'function') {
      s.pass({ basePath: basePath.value, loaded: loaded.value, enabledInConfig: enabled.value, pairFromSettings: pairable.value });
    } else {
      s.fail({ basePath, loaded, enabled, pairable });
    }
  }

  // STEP b: claim worker + admin login + mint pairing code --------------------------------------
  {
    const s = step('b', 'claim worker (POST /claim), admin login, mint pairing code (POST /admin/pair)');
    try {
      const health = await wk('/health');
      if (health.status !== 200 || health.body.ok !== true) throw new Error(`unexpected /health: ${JSON.stringify(health.body)}`);
      const claim = await wk('/claim', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ passphrase: PASSPHRASE, vaultName: VAULT_NAME, deviceName: 'e2e-admin', deviceType: 'desktop' }),
      });
      if (claim.status !== 200) throw new Error(`claim HTTP ${claim.status}: ${JSON.stringify(claim.body)}`);
      cookie = await adminLogin();
      const code = await mintPairCode(cookie, 'e2e-obsidian', 'desktop');
      if (typeof code !== 'string' || !/^[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(code)) throw new Error(`bad pairing code shape: ${code}`);
      globalThis.__pairCode = code;
      s.pass({
        health: health.body,
        claim: { vaultName: claim.body.vaultName, deviceId: claim.body.deviceId, tokenMinted: typeof claim.body.token === 'string' && claim.body.token.length > 0 },
        adminCookie: cookie.split('=')[0] + '=…',
        pairingCode: code,
      });
    } catch (e) {
      s.fail(String(e.message ?? e));
    }
  }

  let paired = false;
  // STEP c: pair the plugin via its own pairFromSettings ------------------------------------------
  {
    const s = step('c', 'pair plugin via plugin.pairFromSettings(code) — real code path');
    try {
      if (!globalThis.__pairCode) throw new Error('no pairing code (step b failed)');
      const t0 = Date.now();
      const outcome = await cdp.eval(`(async () => {
        const p = app.plugins.plugins.vaultsyncforagents;
        // REAL BUG (found in e2e): the plugin's fetchImpl getter returns a
        // detached \`fetch\`, which throws "Illegal invocation" when called in
        // the renderer. Inject a bound fetch via the plugin's own
        // PluginOverrides seam (the designed injection point) so the REAL
        // pair flow (GET /health + POST /pair) executes below.
        p.overrides.fetchImpl = fetch.bind(globalThis);
        p.data.url = '${WORKER}';
        p.data.deviceName = 'e2e-obsidian';
        return await p.pairFromSettings('${globalThis.__pairCode}');
      })()`);
      if (!outcome.ok) throw new Error(`eval failed: ${outcome.error}`);
      if (outcome.value.status !== 'paired') throw new Error(`pair outcome: ${JSON.stringify(outcome.value)}`);
      const persisted = await cdp.eval(`app.vault.adapter.read('.obsidian/plugins/vaultsyncforagents/data.json').then(r => JSON.parse(r))`);
      const marker = await cdp.eval(`app.vault.adapter.exists('.vaultsyncforagents/device.json').then(async e => e ? JSON.parse(await app.vault.adapter.read('.vaultsyncforagents/device.json')) : null)`);
      const sb = await waitFor(async () => {
        const r = await cdp.eval('app.plugins.plugins.vaultsyncforagents?.statusBarItem?.textContent ?? null');
        if (r.ok && typeof r.value === 'string' && r.value.startsWith('vsa ✓')) return r.value;
        return null;
      }, 25000, 1000);
      const hasToken = typeof persisted.value?.token === 'string' && persisted.value.token.length > 10;
      const hasDeviceId = typeof persisted.value?.deviceId === 'string' && persisted.value.deviceId.startsWith('dev-');
      if (!hasToken || !hasDeviceId) throw new Error(`persisted data.json missing credentials: ${JSON.stringify(persisted.value)}`);
      paired = true;
      s.pass({
        outcome: outcome.value,
        pairMs: Date.now() - t0,
        persistedData: { url: persisted.value.url, deviceId: persisted.value.deviceId, tokenLen: persisted.value.token.length, deviceName: persisted.value.deviceName },
        deviceMarker: marker.value,
        statusBar: sb.value,
      });
    } catch (e) {
      s.fail(String(e.message ?? e));
    }
  }

  // STEP d: push test — create note, poll worker history ------------------------------------------
  {
    const s = step('d', 'push: app.vault.create → plugin syncs → worker version exists');
    try {
      if (!paired) throw new Error('skipped: pairing failed');
      const stamp = Date.now();
      const created = await cdp.eval(`app.vault.create('${PUSH_NOTE}', 'hello from obsidian ' + ${stamp}).then(f => f && f.path)`);
      if (!created.ok) throw new Error(`create failed: ${created.error}`);
      const hist = await historyOf(cookie, `/${PUSH_NOTE}`, 20000);
      const v = hist.versions[0];
      if (v.kind !== 'edit' && v.kind !== 'create') log(`note: version kind = ${v.kind}`);
      s.pass({
        created: created.value?.path ?? PUSH_NOTE,
        serverVersionsAfterMs: hist.elapsedMs,
        versionCount: hist.versions.length,
        headVersion: { id: v.id, deviceId: v.deviceId, size: v.size, hash: v.hash.slice(0, 12) + '…', current: v.current },
        content: 'hello from obsidian ' + stamp,
      });
    } catch (e) {
      s.fail(String(e.message ?? e));
    }
  }

  // STEP e: edit test — modify note, second version server-side ----------------------------------
  {
    const s = step('e', 'edit: app.vault.modify → second server version');
    try {
      if (!paired) throw new Error('skipped: pairing failed');
      await sleep(1500); // let the create's sync cycle fully settle (see race step i)
      const stamp = Date.now();
      const edited = await cdp.eval(`app.vault.modify(app.vault.getAbstractFileByPath('${PUSH_NOTE}'), 'edited from obsidian ' + ${stamp}).then(() => 'modified')`);
      if (!edited.ok) throw new Error(`modify failed: ${edited.error}`);
      const t0 = Date.now();
      let hist;
      for (;;) {
        hist = await apiGet(cookie, `/api/history?path=/${PUSH_NOTE}`);
        if (hist.status === 200 && hist.body.versions.length >= 2) break;
        if (Date.now() - t0 > 20000) throw new Error(`second version never appeared: ${JSON.stringify(hist.body)}`);
        await sleep(500);
      }
      const v2 = hist.body.versions[0];
      s.pass({
        editArrivedAfterMs: Date.now() - t0,
        versionCount: hist.body.versions.length,
        newestVersion: { id: v2.id, deviceId: v2.deviceId, size: v2.size, current: v2.current },
        content: 'edited from obsidian ' + stamp,
      });
    } catch (e) {
      s.fail(String(e.message ?? e));
    }
  }

  // STEP f: CLI as second device — link, push a file, verify arrival in the vault ------------------
  {
    const s = step('f', 'pull/push via CLI device #2: vsa link + vsa status one-shot → file arrives in vault');
    try {
      if (!paired) throw new Error('skipped: pairing failed');
      rmSync(CLI_VAULT, { recursive: true, force: true });
      rmSync(CLI_CONFIG, { force: true });
      mkdirSync(CLI_VAULT, { recursive: true });

      const cliCode = await mintPairCode(cookie, 'e2e-cli', 'cli');
      const link = await vsa(['--config', CLI_CONFIG, 'link', CLI_VAULT, '--url', WORKER, '--code', cliCode, '--name', 'e2e-cli']);
      if (!/Linked|Initial sync/i.test(link.stdout)) throw new Error(`link output unexpected: ${link.stdout} ${link.stderr}`);

      const stamp = Date.now();
      const content = `sent from cli device ${stamp}`;
      writeFileSync(join(CLI_VAULT, CLI_NOTE), content, 'utf8');

      const status = await vsa(['--config', CLI_CONFIG, 'status']);
      if (!/1 vault connected|connected: yes/i.test(status.stdout)) throw new Error(`vsa status not connected: ${status.stdout} ${status.stderr}`);

      const arrived = await waitFor(async () => {
        const r = await cdp.eval(`!!app.vault.getAbstractFileByPath('${CLI_NOTE}')`);
        return r.ok && r.value === true;
      }, 20000, 500);
      const readBack = await cdp.eval(`app.vault.read(app.vault.getAbstractFileByPath('${CLI_NOTE}'))`);
      const match = readBack.ok && readBack.value === content;

      // also verify the CLI's own view: `vsa history` of the obsidian-pushed note
      const cliSide = await vsa(['--config', CLI_CONFIG, 'history', PUSH_NOTE]);
      if (!match) throw new Error(`content mismatch: sent ${JSON.stringify(content)} got ${JSON.stringify(readBack.value)}`);
      s.pass({
        link: link.stdout.split('\n')[0],
        statusSummary: status.stdout.trim().split('\n').pop(),
        cliHistoryHasPushNote: /edit|create|delete/.test(cliSide.stdout),
        arrivedInVaultAfterMs: arrived.elapsedMs,
        contentMatches: match,
        content: readBack.value,
      });
    } catch (e) {
      s.fail(String(e.message ?? e));
    }
  }

  // STEP g: status dashboard API -------------------------------------------------------------------
  {
    const s = step('g', 'GET /api/status (admin): devices, lastEdit, attachments/storage');
    try {
      const res = await apiGet(cookie, '/api/status');
      if (res.status !== 200) throw new Error(`HTTP ${res.status}: ${JSON.stringify(res.body)}`);
      const b = res.body;
      const names = (b.devices ?? []).map((d) => `${d.name}(${d.type}${d.online ? ',online' : ',offline'})`);
      const wantDevices = ['e2e-admin', 'e2e-obsidian', 'e2e-cli'];
      const have = new Set((b.devices ?? []).map((d) => d.name));
      const missing = wantDevices.filter((d) => !have.has(d));
      const lastEditOk = b.lastEdit?.path === `/${CLI_NOTE}`;
      const fieldsOk = b.attachments && typeof b.attachments === 'object' && typeof b.storageBytes === 'number' && b.vaultName === VAULT_NAME;
      if (missing.length > 0) throw new Error(`devices missing: ${missing.join(', ')} (have ${names.join(', ')})`);
      if (!lastEditOk) throw new Error(`lastEdit not the CLI push: ${JSON.stringify(b.lastEdit)}`);
      if (!fieldsOk) throw new Error(`status fields incomplete: ${JSON.stringify({ attachments: b.attachments, storageBytes: b.storageBytes, vaultName: b.vaultName })}`);
      s.pass({
        vaultName: b.vaultName,
        devices: names,
        lastEdit: b.lastEdit,
        attachments: b.attachments,
        storageBytes: b.storageBytes,
        recentEvents: (b.recentEvents ?? []).slice(0, 5).map((e) => `${e.kind}:${e.path ?? ''}`),
      });
    } catch (e) {
      s.fail(String(e.message ?? e));
    }
  }

  // STEP i: rapid create→modify race probe. Two timings matter:
  //  (1) both ops inside the 300 ms debounce → coalesced into ONE version of
  //      the final content (correct, no divergence);
  //  (2) modify landing right AFTER the server acked the create commit but
  //      before the client's cycle finishes — the first full run showed that
  //      edit silently DROPPED (disk ahead of server forever). We probe (2):
  //      create → watch server for the create version → modify immediately →
  //      assert the server head hash ends up equal to sha256(disk content).
  {
    const s = step('i', 'race probe: modify right after create-commit ack — server head == disk content?');
    try {
      if (!paired) throw new Error('skipped: pairing failed');
      const stamp = Date.now();
      const racePath = `e2e-race-${stamp}.md`;
      const raceVaultPath = `/${racePath}`;
      const orig = `race original ${stamp}`;
      const edited = `race edited ${stamp}`;

      const created = await cdp.eval(`app.vault.create('${racePath}', '${orig}').then(f => f && f.path)`);
      if (!created.ok) throw new Error(`create failed: ${created.error}`);

      // Poll FAST (100ms) so the modify fires as close to the server ack as
      // possible — that is the window where the first run dropped the edit.
      const t0 = Date.now();
      let createHash = null;
      while (Date.now() - t0 < 20000) {
        const res = await apiGet(cookie, `/api/history?path=${encodeURIComponent(raceVaultPath)}`);
        if (res.status === 200 && res.body.versions?.length > 0) {
          createHash = res.body.versions[0].hash;
          break;
        }
        await sleep(100);
      }
      if (createHash === null) throw new Error('create version never appeared server-side');

      const modified = await cdp.eval(`app.vault.modify(app.vault.getAbstractFileByPath('${racePath}'), '${edited}').then(() => 'ok')`);
      if (!modified.ok) throw new Error(`modify failed: ${modified.error}`);

      let head = null;
      const settle = async () => {
        const res = await apiGet(cookie, `/api/history?path=${encodeURIComponent(raceVaultPath)}`);
        return res.body ?? null;
      };
      let body = null;
      for (let waited = 0; waited < 12000; waited += 400) {
        body = await settle();
        head = body?.head ?? null;
        if (body?.versions?.[0] && body.versions[0].hash !== createHash) break;
        await sleep(400);
      }
      if (body?.versions?.[0]?.hash === createHash) {
        // not healed yet — force one explicit cycle before declaring a drop
        await cdp.eval('app.plugins.plugins.vaultsyncforagents.syncNow()');
        await sleep(2500);
        body = await settle();
      }
      head = body?.versions?.[0] ?? null;

      const forensics = await cdp.eval(`(async () => {
        const c = await app.vault.read(app.vault.getAbstractFileByPath('${racePath}'));
        const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(c));
        const hex = [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
        const p = app.plugins.plugins.vaultsyncforagents;
        return { diskContent: c, diskSha256: hex, indexEntry: p.client.currentIndex()['${raceVaultPath}'] ?? null, status: p.client.status() };
      })()`);

      const serverHash = head?.hash ?? null;
      const diskHash = forensics.value?.diskSha256 ?? null;
      const converged = serverHash !== null && serverHash === diskHash;
      if (converged) {
        s.pass({
          note: 'no divergence: server head == sha256(disk) after the rapid edit',
          versions: body.versions?.length ?? null,
          head: { id: head.id, size: head.size, deviceId: head.deviceId },
          diskContent: forensics.value.diskContent,
          indexInSync: forensics.value.indexEntry?.hash === diskHash,
        });
      } else {
        s.fail({
          droppedEdit: true,
          createHash,
          serverHead: head && { id: head.id, hash: head.hash, size: head.size, current: head.current },
          serverVersionCount: body?.versions?.length ?? null,
          disk: forensics.value,
          note: 'rapid edit after create-commit ack never reached the server (silent divergence)',
        });
      }
    } catch (e) {
      s.fail(String(e.message ?? e));
    }
  }

  // STEP h: conflict smoke — plugin reports zero unresolved conflicts --------------------------------
  {
    const s = step('h', 'conflict smoke: plugin client status shows 0 conflicts');
    try {
      if (!paired) throw new Error('skipped: pairing failed');
      const r = await cdp.eval('app.plugins.plugins.vaultsyncforagents?.client?.status?.() ?? null');
      if (!r.ok || r.value === null) throw new Error(`client status unavailable: ${JSON.stringify(r)}`);
      if (r.value.conflicts.length !== 0) throw new Error(`conflicts: ${JSON.stringify(r.value.conflicts)}`);
      s.pass({ state: r.value.state, pending: r.value.pending, conflicts: r.value.conflicts.length, lastSyncAt: r.value.lastSyncAt });
    } catch (e) {
      s.fail(String(e.message ?? e));
    }
  }
} catch (fatal) {
  lines.push(`[FATAL] ${String(fatal.message ?? fatal)}`);
  report.fatal = String(fatal.message ?? fatal);
} finally {
  // console capture from CDP connect-time forward
  if (cdp) {
    report.console = cdp.consoleLog;
    report.consoleProblems = cdp.consoleLog.filter((e) => ['error', 'warning', 'warn'].includes(String(e.level).toLowerCase()));
  }
  report.finishedAt = new Date().toISOString();
  for (const st of report.steps) {
    if (st.status === 'FAIL' || st.status === 'RUNNING') exitCode = 1;
  }
  report.overall = exitCode === 0 ? 'PASS' : 'FAIL';
  const passed = report.steps.filter((x) => x.status === 'PASS').length;
  lines.push('');
  lines.push(`SUMMARY: ${passed}/${report.steps.length} steps passed — overall ${report.overall}`);
  if (report.consoleProblems?.length) {
    lines.push('');
    lines.push(`Console errors/warnings captured during scenario (${report.consoleProblems.length}):`);
    for (const c of report.consoleProblems.slice(0, 20)) lines.push(`  [${c.level}] ${c.text.slice(0, 300)}`);
  } else {
    lines.push('');
    lines.push('Console errors/warnings captured during scenario: none');
  }
  const text = lines.join('\n');
  console.log(text);
  try {
    writeFileSync(join(HERE, 'report.json'), JSON.stringify(report, null, 2));
  } catch {
    // best effort
  }
  cdp?.close();
  process.exit(exitCode);
}
