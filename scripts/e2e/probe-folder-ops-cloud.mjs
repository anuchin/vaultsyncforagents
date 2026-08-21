// One-shot diagnostic: why did F1 app.vault.create('projects/a.md') ENOENT and
// F5 app.vault.delete(folder) EISDIR in the cloud resume run? Probes Obsidian's
// vault API directly (fresh single instance, same profile/vault) and prints
// every layer's result + plugin console errors.
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync } from 'node:fs';
import { connectPage, listTargets } from './cdp.mjs';

const execFileP = promisify(execFile);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const OBSIDIAN_EXE = 'C:\\Program Files\\Obsidian\\Obsidian.exe';
const PROFILE = 'Z:/Projects/TestVaults/e2e-2vault-profile';
const CDP = 'http://127.0.0.1:9222';

await execFileP('taskkill', ['/F', '/IM', 'Obsidian.exe']).catch(() => {});
await sleep(1500);
const child = spawn(OBSIDIAN_EXE, [`--user-data-dir=${PROFILE}`, `--remote-debugging-port=9222`], { detached: true, stdio: 'ignore' });
child.unref();

// wait for plugin
let cdp = null;
for (let i = 0; i < 60 && !cdp; i++) {
  await sleep(1500);
  try {
    const targets = await listTargets(CDP);
    if (targets.some((t) => t.type === 'page')) {
      try {
        const c = await connectPage({ http: CDP, match: 'TestVault4' });
        const probe = await c.eval('!!(app.plugins?.plugins?.vaultsyncforagents)');
        if (probe.ok && probe.value) cdp = c;
        else c.close();
      } catch { /* not ready */ }
    }
  } catch { /* endpoint not up */ }
}
if (!cdp) { console.log('FAILED to get ready instance'); process.exit(1); }
await sleep(4000); // let sync settle

const jstr = JSON.stringify;
async function ev(label, expr) {
  const r = await cdp.eval(expr);
  console.log(`\n=== ${label}\n${JSON.stringify(r).slice(0, 600)}`);
  return r;
}

// status first
await ev('plugin status', `(() => { const p = app.plugins.plugins.vaultsyncforagents;
  return { statusBar: p.statusBarItem?.textContent, state: p.client?.status?.()?.state, pending: p.client?.status?.()?.pending }; })()`);

// 1) the exact F1 op that failed
await ev('create projects/a.md (F1 op, as-is)', `(async () => {
  try { await app.vault.create('projects/a.md', 'probe A ${Date.now()}'); return 'created'; }
  catch (e) { return String(e && e.stack || e).slice(0, 400); } })()`);

// 2) decomposed: folder first, then file
await ev('createFolder probe-folder', `(async () => {
  try { await app.vault.createFolder('probe-folder'); return 'folder-created'; }
  catch (e) { return String(e).slice(0, 300); } })()`);
await ev('create probe-folder/a.md', `(async () => {
  try { await app.vault.create('probe-folder/a.md', 'probe B'); return 'created'; }
  catch (e) { return String(e).slice(0, 300); } })()`);

// 3) adapter-level mkdir + write (below vault API)
await ev('adapter.mkdir probe-folder2', `(async () => {
  try { await app.vault.adapter.mkdir('probe-folder2'); return 'mkdir-ok'; }
  catch (e) { return String(e).slice(0, 300); } })()`);
await ev('adapter.write probe-folder2/a.md', `(async () => {
  try { await app.vault.adapter.write('probe-folder2/a.md', 'probe C'); return 'write-ok'; }
  catch (e) { return String(e).slice(0, 300); } })()`);

// 4) F5 op that EISDIR'd: delete an EMPTY folder via vault.delete
await ev('vault.delete empty probe-folder2 (has file inside? list first)', `(async () => {
  const f = app.vault.getAbstractFileByPath('probe-folder2');
  const listing = f ? (f.children ?? []).map((c) => c.name) : null;
  try {
    const fa = app.vault.getAbstractFileByPath('probe-folder2/a.md');
    if (fa) await app.vault.delete(fa);
    const folder = app.vault.getAbstractFileByPath('probe-folder2');
    await app.vault.delete(folder);
    return { deleted: true, listingBefore: listing };
  } catch (e) { return { deleted: false, err: String(e).slice(0, 300), listingBefore: listing }; } })()`);

// 5) any 'projects' remnants in the file tree?
await ev('projects in tree?', `app.vault.getAllLoadedFiles().filter((f) => /projects|probe/.test(f.path)).map((f) => f.path)`);

// cleanup probes (best effort)
await ev('cleanup', `(async () => {
  const kill = async (p) => { const f = app.vault.getAbstractFileByPath(p); if (f) { try { await app.fileManager.trashFile(f); return 'trashed'; } catch (e) { try { await app.vault.delete(f); return 'deleted'; } catch (e2) { return String(e2).slice(0, 120); } } } return 'absent'; };
  return { a: await kill('projects/a.md'), b: await kill('probe-folder/a.md'), c: await kill('probe-folder2'), d: await kill('probe-folder') }; })()`);

// console problems since connect
const problems = cdp.consoleLog.filter((e) => ['error', 'warning', 'warn'].includes(String(e.level).toLowerCase()));
console.log(`\n=== console problems (${problems.length})`);
for (const p of problems.slice(0, 12)) console.log(` [${p.level}] ${p.text.slice(0, 200)}`);
cdp.close();
await execFileP('taskkill', ['/F', '/IM', 'Obsidian.exe']).catch(() => {});
process.exit(0);
