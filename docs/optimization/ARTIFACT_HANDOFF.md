# O33: Accept, hand off and publish are separate

The fixed goal artifact page reports these facts independently:

- **Acceptance:** a draft remains a draft unless the host has a passed final
  verification snapshot with this artifact ID, version, digest and source task.
  A project also needs its own matching operator review. Finishing an
  intermediate step or keeping a file does not accept it.
- **Private handoff:** a completed goal and retained, permission-checked bytes
  make an accepted version available for an authorized workspace operator.
  Preview only reads state; it cannot create a public URL or send anything.
  The receipt ID binds the artifact version, workspace destination,
  authorized-operator audience, permission version and acceptance round. A
  handoff download verifies this receipt again. A matching explicit withdrawal is durable and idempotent, affects only the
  specified version, and does not delete the private file or revoke preexisting
  workspace access. A stale receipt cannot change current readiness.
- **External publication:** not confirmed. The existing goal release/outbox
  may deliver a text report under its existing authorization; neither that
  report, an outbox acknowledgement nor an operator download is a receipt for
  these artifact bytes at an external destination. This feature does not
  change, hold or add a click to the existing automatic report path. G05 must
  supply the authorized sender and verified, version-matched public receipt
  before a destination can report publication. There is no public trigger or
  simulated publication success in this change.

Authorization and scope are checked for each read and mutation. The receipt's
permission version binds the origin policy version, tenant context epoch, scope revision, entry
revision, and task ownership and data revisions. Withdrawal records reference
their source goal, task and trigger so history cleanup can erase them. A new
version has a distinct handoff.
