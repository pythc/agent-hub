# Notification candidates: project review slice

A host-managed pending project review is the first typed notification fact.
Its topic identifies the authorized goal owner, entry, and exact destination.
Its fact revision identifies the review, verification round, delivery, and
integrated commit. Neither key depends on the composed message. Enqueuing
and binding authority reuse the durable outbox atomically. Rewording the same
fact does not create another delivery or reset an uncertain receipt.

Immediately before the existing delivery path, the host rereads the goal,
pending review, verification evidence, receipt, and destination. A returned,
approved, replaced, or otherwise stale review is withdrawn while pending. A
new review over new evidence gets its own fact revision and reports the
commit for that review. Current verification uses read-only mode; it does
not create routes or reconstruct missing caches to qualify a notification.
Notification facts do not grant any permission or authorize a new destination.

An exactly matching legacy outbox record with its existing goal owner and
context is associated with the current typed fact without another send. Other
legacy goal notices keep their existing safeguards; content is not parsed
to infer missing facts. Unstructured scheduled findings, generic goal failures and
external issues such as GitHub PR state do not have a trusted current-fact
resolver in this slice. Those paths retain existing behavior; no cross-channel
dedupe, new provider reads, automatic remediation, or external freshness is
claimed. Delivery already in flight or uncertain cannot be cancelled or
silently replayed by this guard. Retained outbox rows define the dedupe horizon.

## Host execution holds

The normal turn controller now persists a typed hold cause when the
autonomous turn allowance or repeated-failure threshold stops a goal.
It evaluates the authorized original audience, current causal evidence and
retained outbox state before evaluating the copy callback. A repeat of
the same cause is not news; repeated failures after a delivered
turn-allowance notice are a separate fact and the text explains the change.
Pending notices are rechecked even during quiet time; a resumed,
replaced, or no-longer-authorized goal does not send its old hold notice.
No model-authored reason string is enough to mint a fact. Explicit silent
mode suppresses these notifications. Existing schedule policies and
delivery mechanics still apply after the candidate passes.

This does not convert arbitrary goal errors, model-generated scheduled
findings, or provider PR lifecycle events into facts. Only host-owned
project review and turn-controller state are resolved. The host does not
fetch GitHub state in this path, so a remotely merged PR alone is not a
supported invalidation signal. An unresolved current local review has no
arbitrary expiration; current evidence is revalidated before delivery.
