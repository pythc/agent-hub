# Scheduled notification lifecycle (O24)

Quiet hours apply to wholly scheduled outbox notices, never to a direct human
reply or an internal Worker transfer. They are evaluated against the IANA
wall clock, optionally restricted by source, plan, exact topic label and
importance (`normal` / `high`). Operators can set topic and importance on
each plan. The stored run revision supplies this classification, so plan
edits do not reclassify older notices. Legacy notices without a classification
still match unfiltered rules but cannot match a filter on a missing field.
All selected dimensions must match the same run. If only some runs in a
combined notice match, delay the notice intact rather than replacing it
with digest metadata. Classifying a plan as high importance is not an urgent
exception. The
legacy default holds eligible notices for their normal delivery after the
quiet window. Operators can opt into a metadata-only workbench digest. This
atomically drops each not-yet-attempted original outbox candidate and records
a local count against its real run. It contains no duplicate message body,
does not add an outbound digest, and does not imply delivery. Already
attempted or uncertain messages retain the existing retry/reconciliation
behavior. Only a current, individually operator-granted urgent plan revision
can bypass quiet hours; an inferred model label never grants an exception.

Pausing remains distinct from ending. Snooze skips future occurrences during
the chosen period and gates unsent notices; expiry and the next due time use
the existing scheduler. Plan end is permanent for that plan ID. It prevents
new scheduled work, rejects later scheduled authority and drops wholly
scheduled pending notices. Neither control recalls a send already started.
Independent or already dispatched work can have effects; use the per-run
stop and existing reconciliation procedures for work that is already in flight.

The digest marker lives with the owning Router reply and only shows aggregate
counts and time on admitted runs, not the destination address or raw text.
External notification candidates other than scheduled Router replies and
monetary budget controls are not part of this implementation.
