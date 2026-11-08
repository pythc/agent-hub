# Watchdog validation — 2026-11-08

Status: implemented and locally validated on `codex/watchdog-recovery-20261108`, based on `7991ad5592113364e246b74741d2eed4517fa623`. No production deployment, merge or push was performed. See [operation and authority boundaries](WATCHDOG.md).

## Final automated checks

| Check | Result |
| --- | --- |
| `npm run typecheck` | Backend and chat TypeScript checks passed |
| `npm test -- --maxWorkers=2` | 63 files, 984 tests passed |
| `node --import tsx src/cli.ts help` | New observer and supervisor commands visible |
| `git diff --check` | Passed |

The full suite includes real subprocess supervision: killing the observer preserves the healthy host; freezing the host with SIGSTOP causes its owning supervisor to replace it while the observer survives; stopping the supervisor stops both without respawning. Dedicated watchdog/operator credentials cannot cross-access each other's endpoints.

Focused regressions cover durable duplicate request replay, stale artifacts and inputs, revoked authorization, paused/stopped tasks, legitimate waits, interruption across restart, uncertain effects, recovery exhaustion, private-content retention, effective native/API settings, independent health polling during slow inference, and live disable/re-enable. Historical configuration fixtures remain unchanged; new defaults are explicitly accounted for, including continued acceptance of previously valid fractional milliseconds.

## Real-model task and restart evidence

Command: `node --import tsx examples/watchdog-smoke.ts`. Actual Codex model calls were used for the Worker, watchdog, Router planner, independent plan reviewer and acceptance agents. Task-side operations stayed in an isolated temporary workspace with task network disabled. Initial instructions deliberately made the Worker rerun a faulty calculation three times and return waiting without a live job or human question.

The accepted task computed grouped totals from a real `input.json` and produced a report. Final output: `north=42`, `south=8`.

| Checkpoint | Host PID | Retained state |
| --- | --- | --- |
| 0 | 87831 | Watchdog recovery persisted and delivered to Router |
| 1 | 89701 | First revised plan independently approved and applied |
| 2 | 90958 | Four nodes passed; final goal independently accepted |

One independent watchdog process remained active across these **two host restarts**. Replanning continued without user intervention. The first plan added an input-analysis prerequisite. Independent acceptance rejected that analysis twice because its claims lacked the original input evidence. Router then obtained a second independently reviewed plan, added an input-capture prerequisite and adjusted dependencies. The final graph was:

`capture_input → inspect_input → aggregate → report`

Both replan reviews approved the original objective and acceptance boundaries. The initial contract object was compared with the final retained contract and remained identical. SHA-256 of the saved original contract file: `bf7bac227021462286f8e4a29957828a1e5b378961090f1d9d45f2ec16064dcc`. The recovery resolved on observed progress; goal completion waited for the separate final acceptance round.

Final local evidence is retained under `.local/validation/watchdog-20261108/native-final/`: `summary.json`, three phase snapshots, the original contract, observer metadata and actual task files. Test/typecheck logs are in the parent validation directory. These files are ignored by Git; no credentials or entire host-state directory were copied. The native host and observer both shut down after completion.

The final native run exercised the evidence-chain fix. Subsequent API-only effort isolation and legacy fractional-setting compatibility changes were covered by focused tests and the final full suite; they do not alter the native run's configured execution path.

## Review findings and fixes

Self-review and independent delegated review found and corrected:

- Queued/in-flight inference could retain stale authority or provider configuration. The daemon refreshes before inference, monitors revocation, and uses the current host-fenced backend/options envelope.
- Private model text could persist outside host history cleanup. The observer now retains metadata and opaque IDs; content-bearing observations remain within the host cleanup domain.
- Slow model calls could delay health checks; dynamic disabling and recovery exhaustion also lacked complete handling. Health polling is separate, configuration is refreshed, and exhausted recovery explicitly holds the unresolved goal.
- A restart during interruption could lose the recovery path. Persisted interruption now suppresses ordinary replay and explicitly holds uncertain effects.
- The real-model test exposed a missing evidence reference: a failure report cited the watchdog recovery ID but the planner/reviewer could not read that record. The accepted observation is now included as immutable failure evidence under the exact referenced ID. An earlier run failed independent plan review for this reason; the successful run above followed the structural fix.
- Native effort defaults incorrectly affected API backends. Only native Codex receives the global fallback; Anthropic and provider-specific reasoning options have regression coverage.

Codex Security scan `725ea2ce-dd14-4432-a2e8-b5cbed2f3973` completed against its frozen initial patch. It retains three medium findings about stale authorization, stale provider selection and private-text retention, all corrected in the subsequent working tree. That sealed report describes the initial snapshot and separately records remediation; it is not an assertion that the final source is the frozen snapshot. Scan token usage was unavailable.

## Boundaries

Semantic recovery covers managed Router goals with immutable contracts. Unknown external effects require reconciliation; a model judgment cannot bypass acceptance or expand authorization. Standalone observers cannot restart hosts they do not own. No production/platform acceptance or Windows execution was performed. Native failure injection and successful local recovery do not establish guaranteed success for arbitrary long tasks. Restoring backups and rolling back to older code have separate compatibility/side-effect requirements; a real rollback was not exercised.
