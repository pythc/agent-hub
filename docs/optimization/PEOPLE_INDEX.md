# O28: verified entry-local people observations

The authenticated operator can read `GET /api/people-index?entryId=<exact-binding-id>`
or add `actorId=<exact-native-account-id>` for an exact lookup. This is an
uncached, read-only projection over local records. It requires an enabled,
healthy, previously verified source account and a live matching non-private
entry classified as group and management scope. There is no tenant-wide search, discovery, external
request, alias merging, account linking or automatic sharing.

A returned actor must be currently allowlisted and not listed as a bot, and
have a persisted human native trigger and matching host proof from the last five
minutes. Its routed entry, binding revision, scope, router and tenant authority
epoch must still match. It is excluded after local deletion/invalidation, a
recorded removal, entry disablement, scope or settings changes that invalidate
the evidence, or expiry. Returned IDs are source/account/entry qualified; names
and cross-workspace forwarded text are never identity inputs. The only optional
role is the exact qualified actor's current local management role. A positive,
recent and matching lifecycle addition, where present, is described as
`observed-added`, not presented as a durable membership guarantee.

A team in this response means a configured Roppo management scope, not an
external company, team roster, employment relationship or relationship score.
Results are always partial or unavailable. No unobserved person, alias,
organizational claim or unknown membership is promoted to a known fact. An
unreported external removal cannot be ruled out inside the short observation
window. This is not an input to an authorization decision, task routing,
recipient resolution, chat/model context or permission assignment. External
organization connectors, human confirmation workflows, aliases and UI remain
outside this slice.
