# External effect receipts and verification

O08 first production slice uses the existing workflow status adapter and its
`workflow-action` record. The versioned `effectReceipt` is embedded in that record:
there is no second ledger whose state can diverge, and no global exactly-once claim.

## Evidence, not permission

The receipt identifies the local operation, request digest, source, verified remote
account and object, original entry/owner/data authorization versions, and a source
identity/configuration digest. It contains no credential value. These captured
facts are not a permission grant: current authority is checked before and after
remote reads, and before writes. A changed identity or authorization cannot reuse
an old approval. Historical records without these facts are not backfilled from
today's configuration.

A remote object ID identifies the issue, not the provider's write operation.
`remoteOperationId: null` explicitly means that no remote operation identifier is
available. The existing workflow adapter supports reading current state; arbitrary
MCP tools, browser calls and outbox deliveries do not acquire a fabricated query
capability through this change.

## States and interruption

- `prepared`: a proposal exists, but no write was attempted.
- `unknown`: a durable write intent exists; its outcome needs verification.
- `confirmed`: the adapter returned a successful write and a matching authorized
  readback was recorded. This is not proof of globally exactly-once execution.
- `observed`: readback found the intended state, but cannot establish the writer.
- `not_executed`: this proposal was declined or superseded before execution.

The intent is committed before provider I/O. Provider calls run outside SQLite
transactions. If the provider succeeds but the response or final local write is
lost, the durable intent remains an execution fence. Restart does not replay it.
Reconcile only reads remote state and updates the original receipt. A failed,
unsupported, unauthorized, mismatched or inconclusive read does not permit another
write. Repeated approval or reconciliation is not a second execution channel.

## Projection and recovery

Four-state task status consumes the authoritative workflow record once, preserving
unknown outcomes from all other producers. Malformed or mismatched new evidence
must not present as success. A valid observed state is distinguished from confirmed
write attribution in the operator view. Reading a page never initiates provider
reconciliation. Existing current-state recovery fingerprints include workflow
receipt evidence, so changed evidence invalidates an older command observation.
This is not a monotonic journal capable of proving a full delete-and-identical-
restore ABA history.

Schema 21 marks the new semantics. Restore rejects schema downgrade and any
bidirectional change in workflow action history, including removal, resurrection
or rollback of a receipt. Other existing receipt and authorization restore fences
remain in force.

## Validation limits

Automated fault tests use the existing adapter against a local HTTP provider
fixture. They can demonstrate response loss, local commit failure, restart,
permission changes and non-repetition, but are not evidence of live Linear, IM or
paid-provider delivery. No real external write, public deployment or main merge is
part of this slice. Manual browser interaction remains unverified.
