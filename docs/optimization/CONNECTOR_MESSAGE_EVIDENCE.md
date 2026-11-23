# O14 message evidence gap

Connector configuration and diagnostics report transport response, identity, and
directory evidence separately. The connection snapshot also describes the missing
message evidence on the same instance and settings revision, without running
any provider call or reading credentials. The existing real-call status remains
`not_tested`; missing records are not an unsuccessful send.

The delivery interface currently returns no provider acknowledgement or remote
message identifier. A local outbox completion records that the current adapter
returned successfully, not independent observation of the same message. Incoming
native events are not correlated to an exact acknowledged outbound message and
its binding. Neither a local success nor the presence of an inbound event
promotes the diagnostic. No historical messages, payloads, IDs, or evidence
fingerprints are added to the connector response.

A future authorized end-to-end check must correlate one uniquely marked message
with the exact instance, destination, configuration and attempt, with a provider
acceptance, a remote ID, and a separately attributable readback or callback.
This patch does not implement that producer, send a message, change any
permissions, or rerun the existing connector diagnostics.
