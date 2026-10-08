import { readFile, writeFile, statfs } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
const configDir = '/var/lib/vaultsync-zerokelvin';
const issues = [];
const cfg = JSON.parse(await readFile(configDir + '/config.json', 'utf8'));
const secrets = JSON.parse(await readFile(configDir + '/secrets.json', 'utf8'));
const vault = cfg.vaults[0];
const health = JSON.parse(await readFile(configDir + '/daemon-health.json', 'utf8'));
const service = spawnSync('/usr/bin/systemctl', ['is-active', 'vaultsync-zerokelvin.service'], { encoding: 'utf8', timeout: 5000 });
if (service.status !== 0 || service.stdout.trim() !== 'active') issues.push('daemon service not active');
if (!health.running || !health.vaults?.some(v => v.state === 'live' || v.state === 'syncing')) issues.push('daemon not live');
if (health.vaults?.some(v => v.error)) issues.push('daemon reports an error');
if (health.vaults?.some(v => v.conflicts > 0)) issues.push('daemon reports sync conflicts');
const fs = await statfs(vault.id);
const freeBytes = fs.bavail * fs.bsize;
if (freeBytes < 512 * 1024 * 1024) issues.push('less than 512 MiB disk space free');
for (const path of ['/health', '/api/status']) {
  try {
    const res = await fetch(vault.url + path, { headers: { authorization: `Bearer ${secrets[vault.id]}` }, signal: AbortSignal.timeout(20000) });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const body = await res.json();
    if (!body.claimed) issues.push('worker unclaimed');
    if (path === '/api/status' && body.devices?.some(d => d.id === vault.deviceId && d.revoked)) issues.push('VPS device revoked');
  } catch (e) { issues.push(path + ': ' + String(e.message)); }
}
const result = { checkedAt: new Date().toISOString(), ok: issues.length === 0, freeBytes, issues };
await writeFile(configDir + '/monitor-health.json', JSON.stringify(result, null, 2) + '\n', { mode: 0o600 });
if (issues.length) { console.error(JSON.stringify(result)); process.exitCode = 1; }
else console.log(JSON.stringify({ ok: true, freeBytes }));
