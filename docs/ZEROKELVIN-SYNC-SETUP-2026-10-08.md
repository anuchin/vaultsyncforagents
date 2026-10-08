# ZeroKelvin sync setup

Configured on 2026-10-08 (Asia/Calcutta), using the locally fixed 0.1.6 build.
The original vault is active; it was backed up before installing or enabling sync.

Later that day, the owner removed OpenWebUI, Pocket TTS and CouchDB. A further
daemon reconnect bug was fixed and deployed; available VPS space rose to about
16 GB. See [the removal and reconnect report](VPS-APP-REMOVAL-2026-10-08.md).

## Connected vaults

| Device | Vault | Operation |
|---|---|---|
| PC | `Z:\Personal\ZeroKelvin` | Obsidian plugin, startup sync and 10-second rescan |
| Android phone | `/storage/emulated/0/Documents/ZeroKelvin/ZeroKelvin` | Obsidian plugin, startup sync and 10-second rescan |
| VPS | `/srv/remote-vault/zerokelvin` | Dedicated daemon, enabled at boot, running as `rvp` |

Each device has its own identity and token. Existing phone and PC plugins remain
installed. Older test deployments and masked legacy VPS sync services were preserved.
The plugin bundles installed on PC and phone match the fixed repository build
by SHA-256. Following the one-time write-warning update, the installed hash is
`d8ac3ce06d75634d7335d9ba9a6c17e917ade8b2a2f84bf5f6f928e8a04f2e4d`.
See [write-warning update](WRITE-WARNING-2026-10-08.md).

The authority and dashboard are
[ZeroKelvin VaultSync](https://vaultsync-zerokelvin-eb6b79.abhijith-nuchinj.workers.dev).
The Worker and R2 bucket are both named `vaultsync-zerokelvin-eb6b79` in the
owner's Cloudflare account. Deployed server version: `0.1.6+audit.20261008`;
deployment ID: `652f9659-ea01-488c-ac01-077e4e2ab730`.

The owner's credential notes, including the existing conflict copy, are included
as explicitly requested. This deployment uses Cloudflare as its authority and
does not offer end-to-end encryption. Its authenticated server can read stored
content. `.obsidian`, `.vaultsyncforagents`, `.trash`, and `.git` stay local.

## Backups and restore point

- PC: `Z:\Backups\ZeroKelvin-before-vaultsync-20261008`. All 407 original
  files, including Obsidian settings, were verified with SHA-256 before activation.
- Phone: `Z:\Backups\ZeroKelvin-phone-before-vaultsync-20261008.tar.gz`.
- VPS: `/srv/backups/zerokelvin-before-vaultsync-20261008.tar.gz`, mode 0600.
  SHA-256: `2f1600f1f4bbda15bb03852e4e60df323c189110e77f19a910067510c0af864f`.
- Cloudflare snapshot: `s1`, **ZeroKelvin verified baseline 2026-10-08**.
  Created after removing the temporary test notes. The snapshot captures heads,
  including deletion records; its reported 395 entries are not 395 live notes.

These pre-setup backups are retained. Restoring a vault or snapshot changes live
content and should be a deliberate operation with active sync coordinated first.

## Verification

All **392 live content files match by SHA-256 on PC, phone, and VPS**. The PC's
392 files also match the original pre-setup backup, with no additions, missing
files, or content differences. Existing historical conflict notes were preserved;
the active PC and VPS clients report zero new sync conflicts.

The actual Obsidian PC plugin and production VPS daemon passed:

- PC creation reaching the VPS, and a VPS edit reaching the PC.
- VPS outage followed by catch-up after restarting the service.
- Empty-folder creation and deletion from the VPS reaching the PC.
- VPS file deletion reaching the PC.
- PC reconnection to the deployed server version.

The phone verification finished successfully on 2026-10-08 after the owner
unlocked it once. A temporary browser screen wake lock kept Obsidian awake
through the remaining checks, then was released. The Android keep-awake setting
remained unchanged at `0`; no permanent screen-lock or battery setting was changed.
The interrupted initial work completed, and the plugin automatically reconnected
to the current server version without re-pairing or an app restart.

The real three-device checks passed:

- PC edits reaching phone and VPS.
- Phone edits reaching PC and VPS.
- VPS edits reaching PC and phone.
- A PC edit reaching VPS while phone sync was paused, with the phone retaining
  its previous bytes, then catching up when sync resumed.
- Empty-folder creation and deletion reaching phone and VPS.
- Temporary-note deletion reaching phone and VPS.

The final inventory contains only the 392 original content files, with every
SHA-256 matching on all three devices and matching the original PC backup.
The final monitor reported all three clients live, no conflicts, zero PC/VPS
differences, and healthy VPS monitoring. No phone tests remain pending.
One pause test initially hit a syntax error in the test script, before pausing
the phone; the script was corrected and the remaining checks completed. The
original failed run is retained as `verification-before-script-fix.json`.

At the owner's later request, a retained `VaultSync Test - 2026-10-08 214830.md`
note was created. Creation and edits from PC, phone, and VPS reached the other
devices with identical hashes. The resulting live vault contains 393 files;
the original 392-file baseline and backups remain intact.

During an Android overwrite, the adapter reported that atomic replacement was
unavailable and used the plugin's verified direct-write fallback. The current
backup and inventory checks show no changed original bytes.

The prior code audit fixes passed 1,129 tests, type checks, coverage gates,
production builds, and a zero-vulnerability dependency audit. See
[audit remediation](AUDIT-FIXES-2026-10-08.md). Those earlier checks preceded
this real deployment.

Local operational evidence is under `dist/sync-operations/`, including
`verification-pc-vps.json`, `verification.json`, `backup-content-verification.json`,
`monitor-final.json`, deployment logs, and `vps-doctor.log`.
`monitor-verification.json` confirms that the monitor detected a deliberately
stopped daemon and then detected recovery after the daemon was restarted.
The three-device comparison is `dist/audit-vault-comparison.json`.
The completed phone checks are in `verification.json` and
`verification-phone-recovery.log`; `monitor-phone-final.json` records final health.

## Monitoring and normal use

The VPS daemon is `vaultsync-zerokelvin.service`. A separate
`vaultsync-zerokelvin-monitor.timer` checks it and the authenticated Worker every
five minutes. Its result is `/var/lib/vaultsync-zerokelvin/monitor-health.json`;
failures appear in the monitor service journal. Both units are enabled and active.

The active Codex automation **Monitor ZeroKelvin sync** checks every 30 minutes
from this chat. It verifies authentication, service and timer state, disk space,
conflicts, PC/VPS content convergence, and phone runtime status when accessible.
It stays quiet while healthy and reports confirmed problems or recoveries.
It does not silently change notes or restart services. Codex checks require this
PC and its local automation environment to be available; VPS checks run independently.

An immediate, read-only PC check is available from `Z:\Projects\syncv2`:

```powershell
node scripts/zerokelvin-monitor.mjs
```

The VPS was almost full. Approximately 958 MiB of replaceable npm download cache
was cleared, increasing available space to about 1.6 GB immediately after cleanup.
No application data, vault content, system logs, or containers were removed.
Monitoring alerts below 512 MiB; the server still needs its ordinary capacity
management because other workloads can consume this space.

Open ZeroKelvin normally in Obsidian on both devices. The PC plugin syncs while
Obsidian runs. The phone catches up with Obsidian open in the foreground;
continuous syncing while Android locks or backgrounds the app is not guaranteed.
Routine monitoring does not require the owner to repeatedly unlock the phone:
backgrounded, sleeping, and disconnected phones are expected states. Use Obsidian
normally; it catches up when open in the foreground. The temporary testing wake
lock is not needed for ordinary use.
The VPS daemon runs independently of either app. Avoid running a one-shot CLI
sync against a vault already being synchronized by its plugin or daemon.

## Configuration and credentials

Public deployment configuration and service definitions are in
[`ops/zerokelvin`](../ops/zerokelvin/). They contain no pairing tokens or admin
password. Worker redeployment uses `ops/zerokelvin/wrangler.json` after building
the dashboard. The deployed CLI is `/opt/vaultsync-zerokelvin/bin/vsa.js` with
its bundled implementation at `/opt/vaultsync-zerokelvin/dist/cli.js`.

The generated admin passphrase and device credentials are saved in
`C:\Users\Jitu\AppData\Local\VaultSync\ZeroKelvin\deployment.json`, in a folder
restricted to Jitu and SYSTEM. Keep this file private and outside the synced
vault. PC and phone plugin settings also contain their respective local tokens.
The VPS registry and secrets are under `/var/lib/vaultsync-zerokelvin/`, owned
by `rvp`, with the secrets file mode 0600. Credentials are not printed in reports
or committed to the project.
