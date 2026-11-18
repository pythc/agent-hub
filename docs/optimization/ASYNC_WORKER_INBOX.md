# O03: durable Worker event inbox

Scope: issue #14, development branch only. This adds host-observed envelopes to the existing Store, Worker execution, Router inbox and outbox, not a second message bus.

## Identity and processing

Each actual Worker activation gets a persisted UUID before model execution, with its real execute-job cause where available. The basis records task/assignment, effective mandate digest, goal contract digest and plan revision, ownership epoch/data revision and binding revision. Missing identities are null, not invented provider sequence numbers or contract versions. Goal control revision is retained as evidence, but benign control-only changes do not invalidate the immutable contract/plan identity.

`progress`, `blocked`, and `result` envelopes contain payload/native-turn digests and host observation time, not raw content. Native occurrence time and source sequence are unknown. Progress strings are coalesced by content per activation; genuine current callbacks still refresh watchdog heartbeat. This is not a claim that repeated provider progress labels were one native event.

The unique envelope and synchronous business effects commit together. Rollback leaves neither receipt nor effect. Identical replay returns the durable receipt without applying again; conflicting payload under the same terminal identity fails closed. The first terminal observation fences later events. Old attempts, changed authority/basis, cancellation and ended tasks only retain archived evidence. Raw late output is bounded and retained only within the existing authorized task history and cleanup boundary.

Reception, input read receipts, execution reports, and goal acceptance remain separate. A Worker ready report is not verifier acceptance. Internal outbox -> Router inbox -> router-result job is one transaction, so a failed internal enqueue remains safely retryable. External uncertain sends retain their existing reconciliation semantics and are not automatically relabeled pending.

## Authority and continuation

Root tool calls are fenced before dispatch and after asynchronous preparation. Current-attempt checks protect metadata, approval and progress callbacks. New scoped input invalidates the old basis: it is not steered into that old activation or consumed by a late steer ACK. The stale report is archived, while the still-authorized same assignment is retired and queued against pending current input. A model rejection follows the same path. This does not accept stale output or consume new input.

Pending Worker messages and composed Router replies retain envelope references. Before consuming or externally forwarding them, the host rechecks authentic receipt/attempt, current pointer, assignment, contract/plan, owner/data/binding, source, route permissions and cleanup. Normal executor completion is allowed; human cancellation is not. Old legacy messages without captured provenance retain their previous authorization checks and are not retrospectively presented as typed events.

## Persistence and UI

Starting an activation raises the state schema floor to 18. Older executables refuse it. Restore rejects a pre-18 backup or an older/different async ledger that could revive consumed results. Failed activation transactions do not raise the floor. History cleanup uses the existing redacted tombstone policy; callbacks cannot restore removed payload digests or receipt linkage.

The existing task-detail view adds a read-only disclosure with unique envelope counts and latest host observation. It carries no raw payloads, IDs or new commands. Unknown legacy data is shown as not recorded, not zero success. Received/applied counts are explicitly not acceptance. Native details/summary supports keyboard interaction; no animation is introduced, including reduced-motion mode.

## Validation boundaries

Automated tests use controlled model callbacks and local persistence, not real provider reconnects or real IM delivery. They exercise tenfold replay, reopen, duplicate progress heartbeat, atomic enqueue rollback, out-of-order/old callbacks, new-input continuation, cancellation, permissions/basis changes, cleanup, restore and final Router delivery fences. Real provider/IM evidence remains unverified and is not substituted with these fixtures. The user removed the blocking requirement for real page clicks/IM before development-branch merge; no browser screenshot or real external-send claim is made.

Exact commands, immutable tree/commit, independent review and CI results are recorded in the PR/issue acceptance evidence after the final frozen run.
