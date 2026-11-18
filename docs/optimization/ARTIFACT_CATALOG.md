# O32: operator artifact catalog

The read-only `/artifact-catalog` endpoint and `/configure#artifacts` page project task file versions and verified, currently enabled Workspace View packages. Each task file passes the existing `GoalArtifacts.describe` operator, scope, context and cleanup guards. Inaccessible versions are omitted, not counted. Conversation attachments are deliberately not globally enumerated.

The response is ordered by kind and stable identity and contains at most 200 visible entries. `truncated` explicitly states that the response is incomplete. The implementation scans metadata before limiting the response; it is not a paginated persistent registry. It does not load artifact bytes. View package verification uses the existing package validation path.

The page uses the captured workspace transport and cancels stale reads on unmount, retry and workspace invalidation. File links keep fixed version identity; View links explicitly open the currently enabled view, not a historical package or runtime snapshot. Both destinations reauthorize independently. Same-page hash navigation preserves an explicit workspace query.

No writes, new object grants, publication, external delivery, history retention changes or main merge are introduced. Metadata is not evidence of acceptance or publication.

## Verification

- Host/chat/View typecheck: passed.
- Focused catalog/model/transport and goal verification suite: 57/57 passed, including real HTTP auth, method, no-store, revoked scope, private scope and cleanup checks.
- Independent detailed review: no blocking findings; explicitly noted full metadata scan and deferred browser testing.
- Full suite and remote exact-head CI/container evidence: recorded in the PR when complete. Known environment failures must be compared against the unchanged base, not presented as a full local pass.
- Browser visual, mobile, keyboard and reduced-motion interaction checks and real IM: deferred, not passed.

O32 remains open: this slice is not a cross-kind persistent registry, does not globally index conversation attachments and does not add historical attachment/View resolution. Overall completed-item count is unchanged.
