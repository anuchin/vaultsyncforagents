/** Read-only operational checks for the owner's ZeroKelvin deployment.
 * Credentials stay outside the vault; output contains no tokens or note text.
 * Closed Obsidian and a disconnected/backgrounded phone are expected states.
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { connectPage } from './e2e/cdp.mjs';

const dir = join(process.env.LOCALAPPDATA, 'VaultSync', 'ZeroKelvin');
const config = JSON.parse(await readFile(join(dir, 'deployment.json'), 'utf8'));
const previous = await readFile(join(dir, 'monitor-state.json'), 'utf8').then(JSON.parse).catch(() => ({}));
const result = { checkedAt: new Date().toISOString(), issues: [], worker: {}, pc: {}, phone: {}, vps: {}, content: {} };
const skip = new Set(['.obsidian', '.vaultsyncforagents', '.trash', '.git']);
async function inventory(root, prefix = '', out = {}) {
  for (const entry of await readdir(join(root, prefix), { withFileTypes: true })) {
    if (skip.has(entry.name) || entry.isSymbolicLink()) continue;
    const path = prefix + entry.name;
    if (entry.isDirectory()) await inventory(root, path + '/', out);
    else if (entry.isFile()) out[path] = createHash('sha256').update(await readFile(join(root, path))).digest('hex');
  }
  return out;
}
async function runtimeStatus(http, match) {
  let page;
  try {
    const targets = await fetch(http + '/json/list', { signal: AbortSignal.timeout(1500) }).then(r => r.json());
    if (!targets.some(t => t.type === 'page')) return null;
    page = await connectPage({ http, match });
    const response = await Promise.race([
      page.eval('({vault:app.vault.adapter.basePath,status:app.plugins.plugins.vaultsyncforagents?.client?.status(),paused:app.plugins.plugins.vaultsyncforagents?.syncingPaused})'),
      new Promise(resolve => setTimeout(() => resolve(null), 5000)),
    ]);
    return response?.ok ? response.value : null;
  } catch { return null; }
  finally { page?.close(); }
}
try {
  const healthResponse = await fetch(config.url + '/health', { signal: AbortSignal.timeout(15000) });
  if (!healthResponse.ok) throw new Error('HTTP ' + healthResponse.status);
  const health = await healthResponse.json();
  const response = await fetch(config.url + '/api/status', { headers: { authorization: `Bearer ${config.devices.pc.token}` }, signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error('device auth HTTP ' + response.status);
  const server = await response.json();
  result.worker = { reachable: true, claimed: health.claimed, serverVersion: health.serverVersion, storageBytes: server.storageBytes, devices: server.devices.map(d => ({ name: d.name, online: d.online, revoked: d.revoked })) };
  if (!health.claimed) result.issues.push('Worker is unclaimed');
  if (server.devices.some(d => d.revoked)) result.issues.push('A configured device was revoked');
} catch (e) { result.issues.push('Worker: ' + e.message); }

const pcRuntime = await runtimeStatus('http://127.0.0.1:9337', 'ZeroKelvin');
const pcStateStat = await stat(join(config.vault, '.vaultsyncforagents/state')).catch(() => null);
result.pc = { runtimeState: pcRuntime?.status?.state ?? 'not observable', stateFileAgeSec: pcStateStat ? Math.round((Date.now() - pcStateStat.mtimeMs) / 1000) : null, conflicts: pcRuntime?.status?.conflicts?.length ?? null };
if (['error', 'disconnected'].includes(result.pc.runtimeState)) result.issues.push('PC plugin is ' + result.pc.runtimeState);
if ((result.pc.conflicts ?? 0) > 0) result.issues.push('PC reports sync conflicts');

try {
  const devices = execFileSync('adb', ['devices'], { encoding: 'utf8', timeout: 5000 });
  if (/\tdevice\b/.test(devices)) {
    const sockets = execFileSync('adb', ['shell', 'cat', '/proc/net/unix'], { encoding: 'utf8', timeout: 5000 });
    const pid = execFileSync('adb', ['shell', 'pidof', 'md.obsidian'], { encoding: 'utf8', timeout: 5000 }).trim().split(' ')[0];
    if (pid && sockets.includes('webview_devtools_remote_' + pid)) {
      execFileSync('adb', ['forward', 'tcp:9338', 'localabstract:webview_devtools_remote_' + pid], { stdio: 'pipe', timeout: 5000 });
      const mobile = await runtimeStatus('http://127.0.0.1:9338');
      result.phone = { connectedByAdb: true, runtimeState: mobile?.status?.state ?? 'not observable', conflicts: mobile?.status?.conflicts?.length ?? null };
      if (mobile?.status?.state === 'error') result.issues.push('Phone plugin reports an error');
      if ((mobile?.status?.conflicts?.length ?? 0) > 0) result.issues.push('Phone reports sync conflicts');
    } else result.phone = { connectedByAdb: true, runtimeState: 'Obsidian closed' };
  } else result.phone = { connectedByAdb: false, runtimeState: 'not observable' };
} catch { result.phone = { connectedByAdb: false, runtimeState: 'not observable' }; }

let remote;
try {
  const python = `import os,json,hashlib,shutil,subprocess
root='/srv/remote-vault/zerokelvin'
skip={'.obsidian','.vaultsyncforagents','.trash','.git'}
out={}
for current,dirs,files in os.walk(root,followlinks=False):
    dirs[:]=[d for d in dirs if d not in skip and not os.path.islink(os.path.join(current,d))]
    for name in files:
        path=os.path.join(current,name)
        if os.path.islink(path): continue
        with open(path,'rb') as f: out[os.path.relpath(path,root)]=hashlib.file_digest(f,'sha256').hexdigest()
with open('/var/lib/vaultsync-zerokelvin/daemon-health.json') as f: health=json.load(f)
with open('/var/lib/vaultsync-zerokelvin/monitor-health.json') as f: monitor=json.load(f)
active=subprocess.run(['systemctl','is-active','vaultsync-zerokelvin.service'],capture_output=True,text=True).stdout.strip()
timer=subprocess.run(['systemctl','is-active','vaultsync-zerokelvin-monitor.timer'],capture_output=True,text=True).stdout.strip()
print(json.dumps({'files':out,'service':active,'timer':timer,'health':health,'monitor':monitor,'freeBytes':shutil.disk_usage(root).free}))
`;
  remote = JSON.parse(execFileSync('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', 'rvp-vps', 'python3 -'], { input: python, encoding: 'utf8', timeout: 20000, maxBuffer: 4 * 1024 * 1024 }));
  result.vps = { service: remote.service, timer: remote.timer, state: remote.health.vaults[0]?.state, pending: remote.health.vaults[0]?.pending, conflicts: remote.health.vaults[0]?.conflicts, freeBytes: remote.freeBytes, timerCheckOk: remote.monitor.ok, timerCheckAgeSec: Math.round((Date.now() - Date.parse(remote.monitor.checkedAt)) / 1000) };
  if (remote.service !== 'active') result.issues.push('VPS daemon service is ' + remote.service);
  if (remote.timer !== 'active') result.issues.push('VPS monitor timer is ' + remote.timer);
  if (!Number.isFinite(result.vps.timerCheckAgeSec) || result.vps.timerCheckAgeSec > 900) result.issues.push('VPS monitor result is missing or older than 15 minutes');
  if (remote.freeBytes < 512 * 1024 * 1024) result.issues.push('VPS has less than 512 MiB disk space free');
  if (['error', 'disconnected'].includes(result.vps.state)) result.issues.push('VPS sync is ' + result.vps.state);
  if (!remote.monitor.ok) result.issues.push(...remote.monitor.issues.map(x => 'VPS: ' + x));
  if (result.vps.conflicts > 0) result.issues.push('VPS reports sync conflicts');
} catch (e) { result.issues.push('VPS check unavailable: ' + e.message); }

if (remote) {
  const local = await inventory(config.vault);
  const paths = new Set([...Object.keys(local), ...Object.keys(remote.files)]);
  const differences = [...paths].filter(path => local[path] !== remote.files[path]);
  const signature = createHash('sha256').update(JSON.stringify(differences.sort().map(path => [path, local[path], remote.files[path]]))).digest('hex');
  result.content = { pcFiles: Object.keys(local).length, vpsFiles: Object.keys(remote.files).length, differences: differences.length };
  const pcRecentlyActive = result.pc.runtimeState === 'live' || (result.pc.stateFileAgeSec !== null && result.pc.stateFileAgeSec < 120);
  if (differences.length && pcRecentlyActive && result.vps.state === 'live' && previous.differenceSignature === signature && previous.content?.differences > 0) result.issues.push('PC/VPS file differences persisted across consecutive checks while sync was active');
  result.differenceSignature = signature;
}
result.ok = result.issues.length === 0;
await writeFile(join(dir, 'monitor-state.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result, null, 2));
if (!result.ok) process.exitCode = 1;
