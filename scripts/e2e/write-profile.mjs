// Writes the throwaway Obsidian profile's vault registry so the e2e vault
// opens on launch. Run: node scripts/e2e/write-profile.mjs
import { writeFileSync } from 'node:fs';

const profile = 'Z:/Projects/TestVaults/e2e-obsidian-profile/obsidian.json';
const vaultPath = ['Z:', 'Projects', 'TestVaults', 'TestVault4-e2e'].join('\\');
writeFileSync(profile, JSON.stringify({ vaults: { aa11bb22cc33dd44: { path: vaultPath, ts: Date.now(), open: true } } }, null, 2));
console.log(writeFileSync ? 'written' : 'bug');
