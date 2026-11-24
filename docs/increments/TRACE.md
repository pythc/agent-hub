# Execution trace and conservative recovery

The operator workspace at `/configure#execution-trace` follows tasks, dispatch, execution, permission waits, managed tools, retained results, acceptance, jobs and deliveries. Commit and test evidence are displayed independently; deployment remains **unverified** because this change adds no deployment verifier. A completed tool call or Worker report cannot establish a successful commit, test run or deployment.

## Authority and durable events

Existing `records`, `jobs`, `outbox` and `audit` tables remain authoritative. `ExecutionTrace(() => runtime)` installs observation-only SQLite triggers that append versioned `execution.trace` metadata to the existing audit ledger in the source write's transaction. Direct SQL job/outbox updates are observed. Rolling back an authoritative write rolls its event back too. The projection cannot dispatch work or change task/job/outbox state.

`event:<audit.seq>` is a stable event ID; `audit.seq` is the monotonic cursor. Clients read after the returned cursor and drain `more` pages. Gaps belong to unrelated audit events. Event pages are bounded to 200 and task pages to 100; the UI keeps 600 loaded events. A cursor above the current ledger yields `trace_cursor_ahead`, requiring a fresh read after database restore. A page refresh replays retained events rather than inventing earlier transitions.

Existing domain audit events (`ticket.created/resumed/ended`, `assignment.started/ended`) retain their original timestamps. First installation also captures current record/job/outbox states, explicitly marked **state at first capture**. Their observation timestamp is not presented as the time a historical transition occurred. A host restart does not duplicate baseline capture. Runtime replacement through configuration activation rebinds the service through its getter.

Observation covers ticket and Worker assignment, run, approval, execution-call, managed work, external tool/browser/workflow receipts, goal delivery, goal verification, and host project commit/test evidence. A verification round emits acceptance events for each referenced ticket. Task snapshots associate Router deliveries through existing `router-reply-owner.taskIds`; this grants no authority to send or retry them.

## Safe display and evidence

The projection selects enum states, host record IDs and result-presence flags. It copies no task text, title, prompt, command, arguments, provider response, raw error, stderr, result body, approval parameters or internal reasoning. UI labels are content-free; provider session/entity IDs are represented by opaque stable references. Configured Worker/backend IDs retain their existing schema. Results remain in the established task history rather than being copied into a second store.

Commit status comes only from a host `project-commit` receipt with a full hexadecimal commit ID. Test status comes from that receipt's recorded test exit code; commands/output are not returned. Acceptance exposes retained verdicts/counts, without explanatory model text. A retained external call receipt proves only that the host recorded the call; it does not prove an external side effect occurred or was undone.

History-cleanup fences filter task and event reads, including late writes. Responses include a cleanup-plan digest; a mounted UI discards cached events when visibility changes. Recovery checks the cleanup fence before returning even an existing idempotent receipt.

## Recovery actions

- **Check current state** reads local retained state.
- **Check original session** explicitly requests a read-only history check from the existing backend and original thread. Only readability is returned, never raw history or a provider exception. Observation times out after 15 seconds; an underlying read that later finishes cannot apply stale state. This does not resume work or reconcile an unknown effect.
- **Resume original session** calls `Runtime.retry`, retaining the existing thread and Engine scheduling. It requires an open retryable task, exact resumable backend identity, current source/actor/assignment authority, no active execution/job/work, question, context hold, pending approval, unsettled workflow, unknown receipt, uncertain delivery or interrupted command. This service does not rewrite run/job/outbox state.
- **Stop task** calls `Runtime.stop`, keeping Engine, tool and approval cancellation fences. Existing external effects remain. A merge already submitted must be reconciled through its established controls.

Unknown run/job/tool/browser/workflow/delivery effects block resume and lead to **check outcome** guidance. Authentication/configuration problems retain typed codes and a link to the existing Connections workspace. Context/permission changes require established task recovery controls. Human questions return to the original Router conversation. No second Worker conversation or blanket approval path is introduced.

Actions require settings `revision`, the digest of the observed task/effect state (`observed`), and a stable `requestId`. Existing records hold `execution-trace-command` receipts. Repeated completed requests return the same receipt; changed content conflicts and pending calls cannot duplicate. Resume and its receipt commit atomically. Interrupted cancellation retains an uncertain receipt and cannot replay; a later read may recognize the already stopped outcome. Neither stale nor fresh resume requests can revive cancellation. Late history observations are rejected after runtime, settings, task/evidence, authority or visibility changes.

## API integration

All endpoints belong behind existing current-operator authentication and same-origin checks:

| Endpoint | Method |
| --- | --- |
| `GET /api/execution-trace?offset=0&limit=50&ticketId=...` | `trace.snapshot(query)` |
| `GET /api/execution-trace/events?cursor=0&limit=80&ticketId=...` | `trace.events(query)` |
| `POST /api/execution-trace/recover` | `await trace.recover(body)` |

Omit optional `ticketId` for global reads. Recovery body is `{ticketId, action, revision, observed, requestId}`; actions are `inspect`, `read_history`, `resume_session`, `cancel`. Strict schemas bound inputs. `TraceError` exposes only `code` and HTTP `status`; never serialize an underlying provider exception. React export: `ExecutionTrace({language})`.

## Migration and rollback

No global schema-version bump or destructive migration occurs. Initial attachment installs `execution_trace_v1_*` observation triggers and `execution-trace-meta/current` version 1. The additive audit event has no Engine authority. Existing sessions, Worker grants, Codex bindings, jobs and outbox semantics stay under their original owners.

For rollback: stop the host, take the normal private backup, call `uninstallExecutionTrace(store)` from this checkout against the stopped instance, and start the previous application. This removes only the trace triggers. Preserve additive audit evidence, receipts and the marker; no task or history deletion is needed. Reinstall recreates hooks without duplicating baseline snapshots. Never roll back by clearing uncertain effects or editing execution phases.

Example offline command with the operator's actual private database:

```sh
node --import tsx --input-type=module -e 'import {Store} from "./src/store.ts"; import {uninstallExecutionTrace} from "./src/execution-trace.ts"; const s=new Store(process.argv[1]); uninstallExecutionTrace(s); s.close()' /private/instance/state.sqlite
```

## Verification and recovery provenance

`npx vitest run tests/execution-trace.spec.ts` contains 22 deterministic cases covering SQLite restart and durable cursors, filtered catch-up, baseline labeling, transactional rollback, direct SQL state changes, redaction, separate commit/test evidence, read-only session observation, settings/task/evidence races, idempotence, original-session Runtime retry, unknown effects, permissions/approvals/backend identity, cancellation and uncertain cancellation, cleanup visibility/cached receipts, and hook rollback. These fixtures invoke no model inference, paid service, real credential or external message.

The initial cloud filesystem became unavailable before this module's first commit. These five module files were reconstructed in `agent-hub-recovery` from retained tool-write records, including the formerly unconfirmed 22nd test. Old 21-test/typecheck results are historical only. Fresh results, the committed artifact and integrated UI/build acceptance must be recorded by the coordinator; this document does not claim earlier checks validate restored bytes.

Actual light/dark/narrow/reduced-motion page captures, refresh recovery and cross-module HTTP behavior are integrated acceptance tasks. Unit tests do not establish live IM, ACP, provider, deployment or visual acceptance.

## References and original design

Documentation/behavior references at Octop `bf134dbd379036ce7545c7df1a1da7e381ece9ff`:

- [README](https://github.com/TencentCloud/Octop/blob/bf134dbd379036ce7545c7df1a1da7e381ece9ff/README.md): shared control-plane and retained remote-history product context.
- [ACP documentation](https://github.com/TencentCloud/Octop/blob/bf134dbd379036ce7545c7df1a1da7e381ece9ff/docs/acp.md): documented session status, permission wait and close workflows.

This original implementation uses Agent Hub's transaction/audit identities and Runtime recovery gates. It does not introduce Octop's runner-tool invocation flow or copy/translate its source, prompts or tests. No SDK/dependency is added by this module. The references establish documented behavior; running Octop/external runners was not part of this acceptance.

## Read-only recovery summary (O11)

The selected task's progress page now exposes its existing RecoveryManifest in an expandable recovery section. It explains the next safe step, whether the original session can currently be inspected, and the retained local tool/acceptance/delivery checkpoint cursors. Imported baseline checkpoints are explicitly distinguished from recorded transitions. Missing checkpoints do not establish that no external action happened.

The UI accepts only schema 1 metadata matching the selected task ID, current settings revision and observation digest. It rejects malformed/duplicate checkpoints, replay permission, inconsistent original-session availability and non-reconciliation guidance for an unknown effect. It copies only safe fixed fields and renders fixed bilingual text; raw identity/digest values, provider content and extra payload fields are not shown. Older snapshots without a manifest render no section; mismatched information asks for refresh rather than displaying stale guidance.

This is presentation of the existing captured-workspace snapshot, not another request, export, backup, restore engine or recovery authorization. Existing task actions and their server-side rechecks remain unchanged. No new controls are enabled by the manifest, and no uncertain effect is replayed. Full external-effect checkpoint coverage and executable restoration remain outside this slice. Automated rendering/validation and original transport/recovery tests are covered; actual browser interaction, narrow-screen/keyboard/reduced-motion and real provider/IM acceptance remain unverified.

### Managed work cancellation evidence
The current assignment's trace distinguishes a stop request, unconfirmed shutdown,
and confirmed managed-work shutdown. This does not cancel a previously committed
external action. Earlier effects may remain and must be checked independently.

Workspace-write managed commands reserve canonical local workspace keys, including
an existing Git common directory shared by linked worktrees. A competing write
fails before launch; after shutdown, reread the workspace before retrying. Reads
and different workspace roots remain independent. This is a host-side guard,
not a remote idempotency mechanism. Nested roots, unmanaged processes, browser
sessions, and external writes are not coordinated by this reservation. Browser
handoff retains its existing controls. No write reservation is released on an
elapsed timer alone.
