# O45: sourced task history and concrete operation evidence

This increment adds a protected, read-only history panel to the task drawer. It reuses retained Router journal items, atomic command receipts, current source visibility and task ownership. It does not add authorization, task mutation, or inferred execution.

## Records and replacement impact

Requirements, decisions and commitments have distinct labels, recorded times, original source words and predecessor history. Up to five current related records and twenty predecessors per record are displayed, with explicit incomplete-history notices. A replacement requires the successor's atomic journal receipt to identify the predecessor; a mutable `supersededBy` pointer is not enough. Legacy receipts without that evidence do not establish replacement history. Unavailable/removed sources are never reconstructed from summaries.

Replacement changes the recorded conclusion, not permissions or already-completed effects. Exact user quotations are distinguished from assistant interpretations and promises. An item without an explicit operation linkage says confirmation/execution is not recorded, not that neither ever occurred. In particular, “could consider” is not approval, and a task completing does not prove each free-text item was executed.

An ended task remains readable when the existing host visibility, source, owner, context and result permissions still permit it. Held ownership, revoked sources, changed ownership and removed evidence continue to fail closed. This does not introduce an archive permission that bypasses current access. History is task-scoped and bounded, not an unlimited cross-task archive.

## Concrete proposals, confirmation and execution

A separate operation-history section projects existing `WorkflowAction` receipts for this task. It shows each concrete status-change proposal and its before/after state names, explicit operator or same-entry manager decision, and execution/readback independently:

- A proposal alone has no confirmation or execution receipt.
- Explicit approval is not execution.
- `applied` requires the matching target-state readback and approval to display “written and read back”.
- `observed` only proves the target state was read back, not who wrote it.
- Lost responses remain unknown; this read-only display never replays an operation.
- Declined or stale proposals are not shown as applied.

Source configuration, configured target, entry audience/revision, task owner/data revision and source provenance are revalidated before displaying even target labels. Conversational decisions require an explicit human input, current manager membership, exact decision command and the original notification's source/thread. A different current manager in the same entry can decide; an unrelated message cannot. Revoked resources or missing provenance remove the corresponding row. Up to twenty currently visible proposals are shown with an overflow notice. Concrete operation evidence is not fabricated into a semantic link to unrelated journal text.

## Validation and limits

- `npm run typecheck`, `npm run build:chat`, and the full Vitest suite; exact-base comparison separates the cloud kernel's sandbox failures from new failures.
- Focused tests cover production admitted-input/capture/build/manager assignment, replacement history, read-only database checks, ended-task history, cross-task/source isolation, explicit same-entry manager approval, local workflow write/readback, response loss and reconciliation, malformed DTOs and unsafe provenance.
- `node --import tsx examples/o45-history-acceptance.ts <fresh-private-directory>` starts the real local HTTP/SQLite application, checks protected history reads, performs a local-only workflow proposal and authenticated operator decision through production handlers, verifies the receipt projection, ended history and revocation, and closes the service. No model or real external platform call is made. The local adapter is a fixture, not evidence of a real provider write.
- Independent review found the different-manager visibility bug; alignment with production decision authority and regression tests fixes it.
- Browser interaction/visual/keyboard testing was not executed. The user waived real clicks as a completion prerequisite. Native disclosures, existing styles, focus-visible styling and no added animation retain the existing interaction pattern; this is not a claim of executed accessibility QA.

This covers the minimum read-only Issue #56 product scope using retained and verifiable evidence. Merge/delivery and remote CI remain separate gates; this document does not itself close the Issue or assert public deployment.
