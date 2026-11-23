# Local completion reconciliation (O23)

Event Automations shows last attempt, last successful full sweep, coverage and
next eligible time. The existing webhook maintenance cadence checks at most
100 retained completion events per page. While it has another page to read,
coverage is partial. A failed page leaves the last full success intact, shows
unknown coverage and retries the same page. A sweep only covers the retained
local webhook completion ledger through its starting watermark, not remote
sources or the latest time in an external platform.

A completed goal with a retained completion event, current goal acceptance and
a currently authorized matching webhook grant can get a local operator notice
when its callback record is missing, held or dead and has no 2xx receipt.
The CloudEvent id used by the callback is the notice's completionEventId and
persistent key. Rechecking never appends another notice for that event; a later
2xx receipt updates its display in place. Existing Event Automations detail
shows the latest notices under Events, after another authority check. Revoked
or stale evidence is not displayed. The notice contains no event payload,
artifact, credentials, or callback target.

The completion observer does not dispatch a task, initiate or retry a callback,
or send a new message. Existing explicitly authorized callback maintenance,
sender policies and retry semantics are unchanged. A missing 2xx is not proof
the receiver did not get the callback. This work does not add external polling
and cannot infer a completion when the authoritative local event is missing.

Suggested verification: page through more than 100 local completion events;
make a scan fail and confirm it keeps the last successful full-sweep time;
remove only the callback record of an independently accepted local completion,
reconcile twice, then restore its acknowledged receipt. The same event should
have one local notice, updated in place, with no task re-execution or new send
by this observer. Revoke the grant and ensure the notice is not returned.
