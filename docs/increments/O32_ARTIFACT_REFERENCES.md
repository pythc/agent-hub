# O32: retained goal-artifact references

`GET /goal-artifact-versions/:id` adds a schema-1, operator-only descriptor for an
existing retained binary goal artifact. It reuses the exact artifact ID, version,
hash, byte count and MIME metadata. The ID, not a mutable title or progress card,
selects the retained bytes at the existing `/goal-artifacts/:id` download route.
Only the basename is presented; internal workspace paths and raw goal context are
not part of the descriptor. Current goal/source ownership and private-context
restrictions are checked on every metadata read, just as on download. Guessing an
ID grants no authority. Missing and inaccessible versions have the same HTTP
response; POST is not supported.

Visibility is `operator_workspace`; retention is explicitly subject to history
cleanup, not a permanent-storage promise. Availability describes presence in the
local retained byte table, not independent content acceptance. `publication` is
`not_tracked`: neither presence nor download proves delivery, external publication
or acceptance. Missing bytes have no download path. Current authorization remains
necessary at download time even if an earlier descriptor showed availability.

This slice neither changes existing immutable storage nor adds publication,
rename, deletion, sharing, backup, or cross-machine access. It does not unify chat
attachments or Workspace Views into the registry and does not implement a new
results page. #43 remains open for those broader requirements. No real provider,
IM, browser visual/keyboard, or public deployment verification was performed.

Descriptor reads use scope and memory read-only guards. An unreconciled
revocation ledger or missing route fails closed without repairing state on GET.
