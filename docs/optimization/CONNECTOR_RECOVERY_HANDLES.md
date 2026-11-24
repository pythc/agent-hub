# Connector credential and delivery recovery fences

Configured connector diagnostics use a host-local opaque reference for each
authentication or directory request. It is bound to the configured source,
the pinned account namespace (when one exists) and sealed credential basis,
the operation purpose, the directory target (if any), the settings revision,
and the currently running probe. It expires with that probe, at most 20
seconds, and is revoked when the call settles. Neither the reference nor its
binding is returned or sent to the child. Existing environment references
and the process sandbox remain the way adapters receive their configured
credentials. No new resolver exposes secret values or allows arbitrary tool
or worker use. A directory operation's binding is checked again as the
isolated plugin leaves its serialized queue, after launching, and at the
call boundary; a stale response cannot verify the new configuration. Native
adapters still execute within their existing trust boundary.

The external outbox records invocation before dispatch and records its
acknowledgement, rejection, or ambiguity along with the corresponding outbox
transition. Receipts contain timing, attempt number, and state, not raw
provider responses, credential values, destinations, or message content.
If the host stops during delivery, the tracked operation becomes unknown.
Retrying that outbox item cannot resend it. Check the original destination
before starting an independent new action. An acknowledgement means the
existing adapter completed, not that a recipient read the message; there
is no automatic provider lookup, cross-account fallback or reconciliation.
Existing pre-feature outbox rows are not retroactively assigned receipts.

The first tracked dispatch advances the local database marker to 22. Older
hosts must not open that database and retry an item without the new fence.
Do not downgrade the database marker. Restore a compatible pre-change
backup if reverting the host. No credential import, rotation, background
retry, or external account check is introduced by enabling this code.
