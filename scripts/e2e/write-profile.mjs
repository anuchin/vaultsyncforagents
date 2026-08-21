// Writes a throwaway Obsidian profile's vault registry (obsidian.json) so the
// wanted vault(s) open on launch. Obsidian is then launched with
// `--user-data-dir=<profileDir>` so it never touches the real profile.
//
//   node scripts/e2e/write-profile.mjs
//     → legacy single-vault profile (TestVault4-e2e) at the hardcoded path.
//
//   node scripts/e2e/write-profile.mjs <profileDir> <openVaultPath> [moreVaultPaths...]
//     → registers every vault path; the FIRST one is marked open:true.
//       Used by scenario-2vault.mjs (one profile per Obsidian instance).
import { mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

function vaultId(path) {
  return createHash('md5').update(path).digest('hex').slice(0, 16);
}

function writeProfile(profileDir, vaultPaths) {
  mkdirSync(profileDir, { recursive: true });
  const vaults = {};
  vaultPaths.forEach((p, i) => {
    const winPath = process.platform === 'win32' ? p.replace(/\//g, '\\') : p; // Obsidian's registry uses backslashes on Windows
    vaults[vaultId(winPath)] = { path: winPath, ts: Date.now() + i, ...(i === 0 ? { open: true } : {}) };
  });
  const file = `${profileDir.replace(/[\\/]$/, '')}/obsidian.json`;
  writeFileSync(file, JSON.stringify({ vaults }, null, 2));
  return file;
}

const args = process.argv.slice(2);
if (args.length === 0) {
  // legacy behavior: the original single-vault e2e profile
  const file = writeProfile('Z:/Projects/TestVaults/e2e-obsidian-profile', [
    ['Z:', 'Projects', 'TestVaults', 'TestVault4-e2e'].join('\\'),
  ]);
  console.log(`written ${file}`);
} else {
  const [profileDir, ...vaultPaths] = args;
  const file = writeProfile(profileDir, vaultPaths);
  console.log(`written ${file} (${vaultPaths.length} vault(s), open: ${vaultPaths[0]})`);
}
