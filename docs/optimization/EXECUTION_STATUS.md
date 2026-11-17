# O07 task status projection

This increment adds a read-only `TaskStatusProjection` (`schema: 1`) to `TraceTask.status`. Existing task, authorization, scheduling, receipt and recovery owners remain authoritative. It introduces no ledger, database migration, external query or new execution command.

The four facets describe different facts:

- `execution`: the current assignment and its Run/work lifecycle. An idle Run alone is not successful completion.
- `effects`: retained operation receipts, including unresolved receipts from earlier assignments. `recorded` means local receipt metadata exists, not that a remote effect has been independently confirmed.
- `acceptance`: the applicable node/final verification round and its current evidence basis. Read-only freshness checks refuse missing caches, missing routes or unapplied revocations rather than repairing them on GET.
- `delivery`: attributable result-delivery evidence. `recorded` has only `host_record` evidence; it never means remote readback, recipient acknowledgement or read status.

## Conservative delivery attribution

Reply IDs in the existing core are content-derived. Equal bodies therefore do not prove that a new assignment or report generated a new delivery. Wall-clock timestamps also have millisecond resolution, and repeated `ready` reports may not create a second state-only trace event.

A completed result receipt is displayed as `recorded` only when the existing journal supplies all required attribution evidence:

1. The current assignment has a retained `assignment.started` event.
2. A non-baseline ticket `ready` projection identifies that ticket and assignment.
3. The outbox's first original non-baseline projection follows both lifecycle events by `audit.seq`.
4. Its observation time is **strictly later** than the current report time. Equality is deliberately insufficient, including a normal delivery that happened within the same millisecond.
5. The result body or the existing Router report-read association matches the current result basis.

When these conditions cannot be established, `not_recorded` means **no retained evidence attributable to the current result**. It is not a statement that no message was sent, no remote effect occurred, or earlier receipts disappeared. Earlier operation receipts remain in their existing owners and effect facet. Unsettled associated messages are still shown as pending, sending, held or uncertain; an older sent message cannot hide them.

No new write hook or report identity was introduced to fill historical evidence gaps. Supporting finer-grained attribution later requires a separately reviewed receipt contract, not weaker comparisons or inferred success.

## Validation scope

Focused regressions cover independent facets, old assignments, stale/malformed acceptance snapshots, text/document/input changes, terminal goals, mixed delivery scopes, progress versus result, same-body cross-assignment replies, same-millisecond progress/ready order, and repeated `ready` reports on an open followed task. Normal recorded-delivery fixtures explicitly advance to a later observation time rather than relying on incidental test timing.

Read-only tests compare all database table contents before and after full `trace.snapshot` reads, including artifact bytes, cached workbook observations, jobs, outbox and audit. They use a history-capable synthetic backend and persisted task/goal contexts. Fixtures make no real provider calls, paid inference or external message sends. Exact check results must be bound to the integration commit; these tests do not establish live platform delivery or readback.

## Deferred recovery boundary

This O07 projection does not implement O08 reconciliation or change Runtime retry semantics. A proposed additional POST resume fence for repository-effect uncertainty was rejected by automatic approval review and was not applied. That separate operation-semantics change requires its own resolved authorization and review; display of an unknown effect must not be described as proof that this deferred server-side repair is implemented.
