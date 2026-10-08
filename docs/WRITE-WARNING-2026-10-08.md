# Device write warning update

The owner requested a one-time, dismissible warning for non-atomic file writes,
installation on PC and phone, and a Git commit and push of the project work.

When the Obsidian adapter cannot rename a temporary file onto its destination,
VaultSync continues using direct writes with a post-write size check. This
underlying limitation and the risk of a partial note if the app crashes during
writing remain unchanged. Failed writes and other sync errors are still reported.

The warning now has a **Got it** button. Its acknowledgement is persisted for
the current device identity in the local plugin settings. Reconnecting or
reloading Obsidian does not repeat an acknowledged warning. A different device
identity must acknowledge its own warning. If the acknowledgement cannot be
saved, the choice is rolled back and the button remains retryable.

The recorded limitation remains visible under **Advanced → File writes on this
device**, in copied diagnostics, and in support bundles after acknowledgement.
Older settings migrate without silently acknowledging a warning. Temporary
notices are removed when the plugin unloads.

Validation: all 1,134 tests across the seven packages passed, all workspace
type checks passed, the coverage gate passed, and the dependency audit reported
zero vulnerabilities. Four new regression checks cover persistence through
reload, device identity changes, a failed save and retry, and old settings.

The production bundle was installed on both the existing PC and Android vaults.
Their SHA-256 matches the repository bundle:
`d8ac3ce06d75634d7335d9ba9a6c17e917ade8b2a2f84bf5f6f928e8a04f2e4d`.
The phone's actual **Got it** action persisted; reloading the plugin produced
no repeated warning and returned sync to `live`. Original plugin bundles were
backed up outside the vault in the protected local deployment directory.
The temporary testing screen wake lock was released afterward.
After installation, edits made through the real phone and PC Obsidian APIs
reached both peers, with the retained test note identical on all three devices.

Operational evidence, including installation and runtime verification, is under
ignored `dist/sync-operations/`. Credentials and unrelated local files are not
part of the commit.
