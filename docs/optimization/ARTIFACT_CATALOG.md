# O32: operator artifact catalog

The read-only `/artifact-catalog` endpoint and `/configure#artifacts` page project task file versions and verified, currently enabled Workspace View packages. Each task file passes the existing `GoalArtifacts.describe` operator, scope, context and cleanup guards. Inaccessible versions are omitted, not counted. Conversation attachments are deliberately not globally enumerated.

The response uses keyset pagination: task versions by ID, then enabled View packages by ID. Each page returns at most 100 visible entries and checks at most 200 task records plus at most 200 View packages. Task IDs are selected through the indexed records key rather than materializing all records. View configuration is already in memory; package reads and verification are bounded per page.

`nextCursor` is an opaque random token held only in a workspace Runtime's process-local cache, limited to 256 tokens with a ten-minute expiry. It exposes neither inaccessible IDs nor raw offsets and grants no access. Each page, including a replay or Previous, rechecks current permissions and cleanup. Unknown, expired, cross-workspace or restart-invalidated cursors return a generic error; Refresh restarts from the first page. No database writes are made. Pages may be empty when scanned entries are inaccessible, and a continuation may lead to an empty final page. Inserts, deletions, scope changes and package changes are not frozen into a snapshot; refresh for a new traversal.

The page uses the captured workspace transport and cancels stale reads on unmount, retry and workspace invalidation. File links keep fixed version identity; View links use the dedicated workspace-bound entry and open the currently enabled package, not a historical package or runtime snapshot. Metadata, bundle, runtime data and navigation revalidation all retain the captured workspace binding; managed frame navigation is limited to explicitly selected configuration pages. Both destinations reauthorize independently. Same-page hash navigation preserves an explicit workspace query.

No writes, new object grants, publication, external delivery, history retention changes or main merge are introduced. Metadata is not evidence of acceptance or publication.

## Verification

- Host/chat/View typecheck: passed.
- Focused catalog/model/transport and goal verification suite: 73/73 passed, including real HTTP auth, method, no-store, revoked scope, private scope and cleanup checks.
- Independent detailed review: no blocking findings; reviewed pagination boundaries, workspace-scoped opaque cursors and deferred browser testing.
- Full suite and remote exact-head CI/container evidence: recorded in the PR when complete. Known environment failures must be compared against the unchanged base, not presented as a full local pass.
- Browser visual, mobile, keyboard and reduced-motion interaction checks and real IM: deferred, not passed.

O32 remains open: this slice is not a persistent cross-kind registry, does not globally index conversation attachments and does not add historical attachment/View resolution. Overall completed-item count is unchanged.

## O36 cleanup impact preview (task file slice)

The operator catalog now offers an on-demand, read-only preview for a pinned
task file version. It reuses the same operator, goal-context and read-only
guards as file metadata plus the cleanup fence. The series is identified by
the authorized version's exact goal/node/path, not by user input or filename
alone. The response gives only counts for a bounded sample of that series and
whether the selected version has retained local bytes; no paths, other record
identifiers, file bytes, unpublished links, or third-party details are shown.
The flag for a partial sample is explicit. This is not a stable snapshot or
authorization for any destructive action.

The preview distinguishes the selected version, the whole series, card removal,
link revocation, and recovery. The base lacks independently scoped per-artifact
delete/card mutations, a registry of published links for this source, and a
per-artifact restore window. Those capabilities are not added here. Local bytes
do not describe backup, cache, downloaded or third-party copies. Whole-history
cleanup is governed by its existing separate confirmation and revocation flow.
Conversation attachments, Workspace View history, publication/revocation
producers, and any restore flow remain outside this slice.
