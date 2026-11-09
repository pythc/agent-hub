# Execution plugin history fixes

Baseline: `54095f2460299caa033b86cc135bd370b100a3c7`. Both reported defects were reproduced using the supplied independent script, an actual adapter subprocess and the OS sandbox. The original script and evidence were left unchanged.

## Deletion ordering and recovery

History cleanup previously redacted the plugin session's identity before calling native `purge`, making deletion permanently fail its identity check. Cleanup now retains only the required native/account mapping while its normal read/resume fence is active. Unrelated payload is still removed immediately. The verified backend deletion receipt permits final mapping removal and leaves a tombstone for subsequent cleanup retries.

The planner also discovers selected plugin session records directly, without requiring a duplicate model-session record. Original configuration, account, workspace and pinned-package checks still apply before native deletion. If the native file was deleted but its success response was lost, the adapter retries deletion idempotently; if the verified receipt survived but the cleanup checkpoint did not, restart completes from that receipt.

An older version may already have erased the required mapping. Without verified original metadata, the host cannot safely associate remaining native files with a particular host session. Such cases remain pending rather than guessing an ID or reporting successful deletion. The running local deployment was inspected read-only before publication: it had no plugin session records or pending history cleanups affected by this legacy condition.

## History identity

Plugin history must be an object with the requested native `id` and a `turns` array. The adapter validates both before replacing the top-level ID with the host's `plugin:<uuid>` identity. Other history fields remain intact. Direct reads, transcript resources and verified history exports therefore refer to the same host session. Wrong/missing IDs and malformed envelopes fail before projection/export.

## Validation

- `npm run check`: **81 test files / 1,178 tests passed**, including type checks and frontend build.
- **13 new regression cases** cover history/export/transcript identity, malformed history, failed deletion before/after file removal, restart, interrupted cleanup checkpoint, invalid deletion receipts, account/configuration guards, package upgrade/rollback, record-only session discovery and already-erased legacy mappings.
- Linux ARM64 in a networkless container with the actual Bubblewrap sandbox: **94 tests passed** across plugin history, execution plugins and memory cleanup. The container used the documented nested-sandbox test policy, no host mounts or business credentials.
- The two original reproductions were rerun with fixed-outcome assertions: export succeeded with host IDs; cleanup reached `verified`, erased the native file and removed the mapping only after deletion.
- Manual review covered durable receipts, late callback redaction, repeated cleanup, account/workspace binding and pinned-package behavior.

Local before/after evidence and logs are under `.local/plugin-history-fixes/`. These checks use disposable local adapters, not live Codex/model accounts or real provider-side history deletion. No security scan was invoked, and no database schema change was introduced.
