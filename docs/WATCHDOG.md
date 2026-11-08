# Independent Watchdog

The watchdog observes ongoing managed Router goals independently of the host event loop. It can detect an ineffective Worker even while model activity continues, submit a fenced recovery request, and follow subsequent evidence until progress resumes or independent goal acceptance succeeds. It never changes the original objective, mandate, acceptance criteria, allowed Workers or backends.

## Running

`node --import tsx src/cli.ts supervise /absolute/config.json` starts and supervises **two independent children**: the host and the watchdog. The existing systemd service using `supervise` therefore includes both. A failed watchdog restarts without restarting a healthy host. Repeated failed host probes or an expired scheduler heartbeat allow the supervisor to terminate and restart only its own host child, with a startup grace and graceful termination period. Stopping the supervisor stops both children and disables its restart loops.

For a separately managed host, run `node --import tsx src/cli.ts watchdog /absolute/config.json`. This observer can submit task recovery, but cannot restart a host it does not own. `serve` alone does not install an external service. The legacy `watch <url> <token-file>` remains a status reporter; it is not the semantic watchdog.

Configuration defaults:

| Field under `watchdog` | Default | Meaning |
| --- | --- | --- |
| `enabled` | `true` | Enable semantic review and infrastructure intervention; the observer stays available for live re-enable |
| `staleMs` | `600000` | Initial no-milestone observation window and host health threshold |
| `intervalMs` | `30000` | Probe cadence; daemon caps its sleep at 60 seconds |
| `reviewIntervalMs` | `600000` | Minimum spacing between semantic reviews of one target |
| `modelTimeoutMs` | `60000` | Bound each read-only model judgment |
| `maxReviewsPerHour` | `12` | Persisted shared inference allowance |
| `maxRecoveries` | `3` | Persisted per-task recovery allowance |
| `backend` | Router backend | Must also belong to the goal's original/current allowed backends |

The observer uses the host-current approved backend, effective model/options and managed credentials. It refreshes the target before every inference and cancels in-flight judgment when subsequent probes show revocation, pause or configuration changes. Credentials travel only in the dedicated control-plane envelope and never enter the model prompt. Health probing continues during slow inference; each semantic batch reviews at most one target before taking a fresh budget/config snapshot. Unavailable inference is recorded as an observation error, never converted into a successful judgment. Ordinary independent acceptance and plan-review limits continue to apply.

## State and authority

Host records: `watchdog-recovery` stores recovery requests and their lifecycle in the same SQLite transactions as Router changes. The accepted observation is retained as immutable failure evidence, accessible to both the replanner and independent plan reviewer under the exact recovery ID quoted in the failure report. The observer has a separate `watchdog/state.sqlite`, daemon lock, observation windows, inference budget, verdict metadata and pending request journal. No free-form model reasons, raw model errors, goal/node names or task content are retained there; original failure evidence stays in the host cleanup domain. It does not open the host database. A lost HTTP response reuses the original request ID; duplicate IDs with changed content are rejected.

The host creates a separate mode-0600 `watchdog-access-token`. It authorizes only `/watchdog/snapshot`, `/watchdog/recover`, and `/watchdog/heartbeat`. Operator/browser credentials cannot read this endpoint's private member contexts, and the watchdog credential cannot access operator APIs. Each model call receives one authorized target and uses its principal and allowed backend. No Worker tools, mutation tools, or resumed Worker session are given to the judge.

Snapshots distinguish model activity, artifact/check changes, and independently accepted milestones. Artifact changes are evidence for review, not proof of completion. Waiting for human input, approval, scheduled retry, or a managed background job suppresses interruption. Missing, over-budget or revoked evidence is surfaced as unavailable. Human-controlled tasks and goals that are paused, cancelled, held or beyond their turn allowance cannot be automatically recovered.

Recovery proceeds through `interrupting` and `watching`, then `resolved`, `held` or `stale`. The request fence binds the host instance, goal/plan revision, assignment, current input/ownership, artifact observations and original contract. The host rechecks authority and evidence after interruption. Unsettled external effects require reconciliation; the watchdog does not blindly replay writes. Once settled, the Router records failure evidence and invokes its existing bounded replanning and independent plan review. A changed artifact means progress has resumed; only the existing independent final acceptance can complete the goal. If no progress appears, later budgeted assessments remain possible.

## Coverage and limits

Semantic recovery currently applies to **managed goal nodes with immutable contracts**. Ad-hoc tasks without such a contract are not automatically replanned. Host/scheduler health covers process and loop failures; this is not an unrestricted agent that rewrites its own prompts or trigger policies. Background commands retain their existing job deadlines. A model can misjudge progress, so evidence citations, stale-state rejection, bounded intervention and final independent acceptance remain mandatory. Recovery allowance exhaustion durably holds the unresolved goal and notifies once. A restart during an unconfirmed interruption explicitly holds uncertain effects rather than silently abandoning recovery.

All additions use additive records; no host database schema migration is introduced. Stop the supervisor/standalone observer before restoring or rolling back. Host backups retain recovery receipts; the observer's separate history is diagnostic and can be re-baselined. A new host instance rejects uncommitted requests from an old instance, including after restore. A previous program version does not implement these recovery fences; reconcile unfinished work before running it.

Configuration rollback is a separate compatibility boundary: startup writes the expanded Watchdog settings into `settings/current`, while older strict schemas accept only `staleMs` and `intervalMs`. Switching code alone therefore fails even if the startup JSON was unchanged. A rollback requires a compatible pre-upgrade backup (subject to the existing external-effect/restore fences), or a reviewed offline conversion of both startup and retained settings to the older schema. Saving settings through the new host restores its defaults and is not such a conversion. Rollback to old code was not exercised by the acceptance script.

## Validation

- `tests/watchdog.spec.ts`: retained observations, busy-but-unproductive activity, legitimate waiting, budgets, duplicate requests, restart, authorization revocation, stale artifacts/inputs, unknown effects, reviewed replanning and final acceptance.
- `tests/watchdog-daemon.spec.ts`: independent health probes during slow inference, current inference configuration, credential exclusion, queued/in-flight revocation and live disable/re-enable.
- `tests/watchdog-process.spec.ts`: real child-process isolation, observer restart, frozen live host recovery, credential separation, intentional shutdown. Uses only isolated temporary state.
- `node --import tsx examples/watchdog-smoke.ts`: real-model fault injection, independent watchdog judgment, reviewed replanning, two host restarts, actual multi-stage artifacts and independent acceptance. Prints the isolated evidence directory. This is local acceptance, not production deployment.
