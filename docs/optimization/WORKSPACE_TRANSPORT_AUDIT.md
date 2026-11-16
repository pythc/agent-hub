# O17 workspace transport audit and proposed first slice

Status: **audit plus proposal; not implemented or frozen**. Audited tree: `88a7c20fe408ed0b28cc7a819858b95754eef8e8`. This document does not claim a completed O17, current multiworkspace support, or a demonstrated cross-tenant authorization bypass. Root review and an explicit implementation assignment must precede code changes.

## Finding and current boundary

The shipped HTTP server owns one mutable Runtime reference. It does not implement a workspace inventory or `/workspaces/:id/...` dispatch. Its existing operator, current-session, origin, revision, ownership and execution checks remain authoritative. There is no second real workspace available in this implementation with which to demonstrate cross-workspace reading or mutation.

The legacy configuration controller nevertheless supports optional workspace-aware hosts. It discovers `/workspaces`, prefixes scoped requests only after validating that inventory, rejects explicit unsupported workspace links, and rejects responses from an obsolete workspace epoch. The three React capability pages bypass this controller and issue root API requests. They therefore omit the existing explicit-link guard and are not ready to be safely composed with the optional workspace host contract. A selected workspace must never silently become an operation on the default Runtime.

This is a transport/context integration finding. It is not evidence that an operator token authorizes another tenant, that query strings select a Runtime, or that any real external effect occurred.

## Call chain and authority references

| Layer | Source reference | Observed behavior |
| --- | --- | --- |
| React routing | `web/chat/main.tsx:1407` | Mounts WorkerTemplates, ConnectorManagement or ExecutionTrace with `language` only, without workspace identity or epoch. Route synchronization at lines 684–688 preserves a `/configure` query string. |
| Legacy activation boundary | `web/chat/configuration.tsx:13–16,53–58` | Excludes these three hashes from legacy active configuration. An initially hidden Configuration with no controller returns before preparing the content module. A direct capability-page link need not run workspace discovery. |
| Content module | `web/chat/configuration-plugin.ts:38–42` | Bundles legacy scripts into a `mount` closure. It exports activate, language and the workspace picker; it exports neither the existing request function nor the workspace context. This is not an iframe and there is no global fetch rewrite. |
| Existing workspace state | `src/ui/workspaces.js:2,14–17,27–44,56–64` | One existing context owns managed mode, active ID and epoch. Inventory opt-in controls path prefixing. Missing inventory plus explicit `workspace` query fails closed; successful switching advances epoch only after scoped responses validate. |
| Existing transport | `src/ui/application.js:130–147` | `api` calls `workspacePath`, retains current token/origin/error handling, captures epoch and rejects obsolete results. Startup calls workspace discovery before loading configuration at lines 289–294. |
| Template page | `web/chat/worker-templates.tsx:8–19` | Root `/api/worker-templates` transport. Component lifetime guard protects some loads, not a workspace change. Preview, export and mutation helpers also bypass the workspace bridge. |
| Template retry ledger | `web/chat/worker-template-requests.ts:2–15` | A single sessionStorage key and an intent identity without workspace/account fields retain exact creation requests across refresh. This retry property must survive partitioning. |
| Connection page | `web/chat/connector-management.tsx:8–19,53` | Root connector transport and a separate root `/api/plugin-market/connection/apply` fetch. All stages must share the same captured context; fixing only inventory loading is insufficient. |
| Trace page | `web/chat/execution-trace.tsx:11–16,54–92` | Root trace transport. Generation and AbortController protect selection/unmount polling, but no workspace identity participates. Recovery has its existing server-side semantics; this proposal does not alter them. |
| HTTP authority | `src/server.ts:50–61,103–110,112–113,178–180,211` and capability routes | A single Runtime getter supplies feature services. Operator/current-session and origin checks gate requests. No workspace routing or workspace-specific operator gate is implemented. Changing a query string cannot select another Runtime. |

Line numbers describe the audited tree and may move. Source references are not substitutes for the runtime evidence below.

## Evidence: real HTTP versus simulation

No repository source was modified during the audit. The real HTTP fixture used a temporary private state directory, localhost, a paused Runtime, disabled managed shell and a model that throws if inference is attempted. The authenticated requests used only that fixture's operator token. No real provider, connector, account, paid call or external message was used. Temporary state was removed afterward.

| Real cloud-local HTTP observation | Source/deferred simulation observation |
| --- | --- |
| Authenticated `GET /workspaces` returned 404 `Unknown endpoint`. | Executing the actual legacy `workspaceDiscover` with a 404 inventory and `location.href` containing `?workspace=studio` rejected with “This host does not support the workspace in this link.” |
| Authenticated `GET /workspaces/studio/api/connectors` and `/workspaces/studio/api/execution-trace` returned 404. No routing to a second Runtime exists. | Actual `workspacePath` with validated managed mode and active ID `studio` produced `/workspaces/studio/api/connectors`. This requires inventory opt-in; it is not inferred merely from a URL. |
| Authenticated `GET /api/connectors?workspace=studio` and `/api/worker-templates?workspace=studio` returned 200, revision 0, from the sole fixture Runtime. The query did not establish a workspace. | Each actual React module was transpiled and invoked in a minimal hook harness with deferred fetch. WorkerTemplates requested `/api/worker-templates`; ConnectorManagement requested `/api/connectors`; ExecutionTrace requested `/api/execution-trace?limit=100` and its root events endpoint. None requested an inventory or a scoped path. |
| Authenticated `GET /api/execution-trace?workspace=studio` returned 400 `validation_error`: trace rejects this extra query field rather than interpreting it as routing context. | After simulated selected context changed from `studio`, epoch 1, to `other`, epoch 2, the three deferred snapshots still stored old revision 101. In the legacy transport control, the equivalent delayed response was rejected with `workspace_obsolete`. |
| Unauthenticated `GET /api/connectors` returned 401. Root access remains operator-protected. | The harness tests missing context participation, not a real switch in the shipped single-Runtime server. It does not prove cross-tenant access or a browser-level exploit. |

The HTTP observations establish the actual server boundary and that root APIs do not derive context from a workspace query. The direct-link bypass follows from that boundary plus the React/legacy mounting chain above. **A real browser opening an explicit unsupported capability link has not yet been run for O17.** It belongs in acceptance before implementation is considered complete. Likewise, no cross-workspace mutation was attempted, and no real multiworkspace server exists in this audited tree.

The deferred harness used TypeScript `transpileModule`, Node VM, hook state capture and a deferred mocked fetch. It ran each real page module, changed a simulated workspace context before resolving a snapshot, and observed the stored state revision. A separate VM ran the original legacy `api` and `workspacePath` functions to establish scoped-path and obsolete-epoch behavior. This is intentionally reported separately from real HTTP and browser acceptance.

## Proposed minimal shared transport

Prefer exposing/reusing the legacy `api` and `workspaceContext` through the existing configuration content controller. Do not create a second workspace inventory, selected-workspace store, Router workflow, permission system or server dispatch layer. A read-only React adapter may subscribe to the existing controller; its snapshots must be derived from the existing context and existing session identity, not become another authority.

The existing content module can expose an internal bridge alongside activate/language/workspace-picker: initialization readiness, a safe context observation, subscription to committed context/session changes, and a request method that delegates to the current `api`. A shared React owner must initialize that bridge even when a capability page is the first route, without forcing legacy content to appear. The exact names are implementation choices pending root review. Initialization must not trigger provider checks, installation, authorizations or external actions merely to obtain context.

Required behavior:

1. **Single Runtime stays normal.** If `/workspaces` is unsupported and the URL does not request a workspace, retain ordinary root requests and current operator protections. Do not fabricate an inventory or claim multiworkspace support.
2. **Explicit context fails closed.** If the URL requests a workspace and inventory is unsupported, malformed, unauthorized or does not contain it, show one readable normal-size explanation. Do not load default capability data, expose default pending requests, submit a mutation or silently drop the query and fall back. Configuration capability flags, clone-enabled UI, or an apparently available endpoint cannot bypass inventory or authority gates.
3. **Managed context is optional and validated.** Only a genuinely successful inventory opt-in may select a workspace or prefix its path. A future compatible host can be tested with a fake workspace-aware server, without adding support to the current server in this slice. Do not automatically retry a failed scoped request unscoped.
4. **Responses and callbacks stay bound.** Capture active ID and epoch before requests and multi-step actions. Recheck both before storing snapshots, previews, errors, notices or credentials-related setup plans, and before subsequent action stages. Subscribe to committed context changes, abort obsolete reads, and clear displayed context-owned state. Abort alone is insufficient: a response may already be queued. Existing legacy epoch rejection is reused; explicit active-ID fencing additionally prevents an old closure from acting after an identity change. Transport/network failure is never permission to rebind an operation to a new workspace.
5. **All requests use the bridge.** Cover template preview/import/install/export/remove/create and retries, connector validate/plan/probe/control and connection apply, plus trace snapshot/events/recovery requests. Routing an existing trace request through context does not change which recovery actions the server permits. Do not alter recovery payload semantics, unknown-effect fences, admission, grants, source execution or effect policy.
6. **Keep uncertain effects explicit.** Switching a page or aborting its fetch does not cancel or undo a server action already accepted. Retain the original request identity in its original partition for reconciliation. Never replay it in a new workspace or present the old result as the new workspace's success.

The existing legacy `api` also carries token, timeout, same-origin and error behavior. Reuse those rules rather than introducing an independent generic fetch wrapper. The bridge is internal UI plumbing, not a new plugin-facing permission capability. Inventory discovery failures must remain distinguishable from normal single-Runtime capability absence.

## Retry ledger partition and compatibility

Partition template attempts by the stable host/authority origin, validated stable workspace identity (or an explicit single-Runtime namespace), and a stable nonsecret account ID **when that identity is actually available from the existing session**. An epoch or settings revision is not a stable workspace identity. Do not use a credential, cookie, display name, guessed actor or fabricated account ID as a key. Where stable account identity is unavailable, avoid sharing an account-ambiguous persisted partition; use conservative session-local isolation until the existing identity can be established.

Within a partition, retain the exact existing body and requestId for the same intent. A new inventory/settings revision is not a new intent. Do not issue a new create request merely because context was refreshed. Pending attempts from workspace A must neither appear as B's actionable attempts nor be retried against B. Reset/logout/account changes must invalidate visible old-account state without erasing an unresolved effect or asserting that it never happened.

The old unpartitioned `roppo.worker-template.pending.v1` key contains no reliable workspace/account provenance. Do not silently assign its attempts to the currently selected managed workspace. Migration should quarantine/preserve these old attempts as unattributed, non-actionable recovery information until their original context is established; no automatic replay. Even single-Runtime adoption requires a proven compatible original authority/account context. The UI should explain uncertainty plainly, not delete the original request and offer a fresh duplicate create. Final migration details require review alongside the existing retry tests.

The normal single-Runtime API and server-side request formats stay compatible. No database schema, server workspace routing, execution authority, grant, scheduling or recovery migration is proposed. Older UI can still use the existing controller exports. If the bridge is unavailable, an explicitly requested workspace must remain blocked; unrestricted fallback to root is not a compatibility strategy.

## Proposed ownership and small commits

These are future exclusive ownership assignments, not permission to modify files now. Do not have multiple agents edit the bridge or root mounting code concurrently.

| Commit | Exclusive owner/file scope | Review boundary |
| --- | --- | --- |
| C1 | Integration owner: `web/chat/configuration-plugin.ts`, `web/chat/configuration.tsx`, the existing virtual-module declaration, and minimal notification hooks in `src/ui/workspaces.js` / `src/ui/application.js` if needed | Export/reuse existing context and api, initialization, stable read snapshots, subscribe/unsubscribe. Preserve legacy behavior and all authority checks. No new server workspace routing. |
| C2 | Same integration owner: one small shared React bridge module, `web/chat/main.tsx`, focused bridge tests | Ensure direct capability entry initializes context; explicit unsupported/missing workspace blocks root reads and writes; context reset and obsolete-result rejection. No duplicate inventory/state source. |
| C3 | Template owner: `web/chat/worker-templates.tsx`, `web/chat/worker-template-requests.ts`, corresponding ledger/component tests | Consume the bridge; partition/preserve original retry intent; quarantine unproven old attempts; stale preview and export response fencing. |
| C4 | Connector owner: `web/chat/connector-management.tsx`, focused tests | Consume the same bridge through validation, planning and apply; no continuation after context switch; no secrets retained in the new page context. No real diagnostics or external effects in regression tests. |
| C5 | Trace owner: `web/chat/execution-trace.tsx`, focused UI transport tests | Bind reads, cursor, polling and existing action requests to the context. Preserve server action lists and existing recovery semantics. Explicitly exclude the previously denied unknown-effect POST guard. |
| C6 | Integration owner: this document/evidence plus browser fixture tests | Run single-Runtime real browser and fake multiworkspace-host failure matrix; root independent review; integrated check/build. Keep UI short, readable and consistent with existing style. |

No one in this proposal owns `src/runtime.ts`, source adapters, permission managers, AppArmor/CI security policy, or the previously denied trace POST unknown-effect fence. Any new need in those areas must be handled as a separate scope decision. O05 scheduler work and its existing legacy transport fence are not to be duplicated or changed here.

## Acceptance matrix for implementation review

| Environment | Scenario | Required evidence |
| --- | --- | --- |
| Real current single-Runtime browser | Normal `/configure#worker-templates`, `#connectors`, `#execution-trace`, without workspace query | Normal data and existing local reversible operations still work; existing operator login, style, keyboard navigation and reduced-motion behavior remain intact. Record actual screenshot/request evidence, not a concept render. |
| Real current single-Runtime browser | Direct capability links with explicit `?workspace=studio`; enter capability before any legacy page | Readable unsupported-context message; zero default capability API reads/writes, no default pending-attempt disclosure, no automatic link rewriting. Test all three pages. |
| Real current single-Runtime browser | Unauthenticated, expired/logout session; direct deep link | Existing authentication boundary preserved; old page data and actionable pending attempts are not inherited by a different account. No token/cookie/secret in UI, logs or evidence. |
| Real current single-Runtime browser | Ledger refresh, network result unknown, same-intent retry | Exact original requestId/body retained within proven context. No fresh request due only to revision change. Legacy unattributed attempts do not silently replay. |
| Fake optional workspace host only | Valid inventory, nondefault selected workspace; all three pages and every request stage | Every scoped request uses the validated selected workspace. No implicit root request; actor/session authorization remains the fake host's responsibility. Report this as simulation, not real multiworkspace support. |
| Fake optional workspace host only | Inventory 401/403/500, malformed/duplicate/empty inventory, missing requested ID, unsupported inventory with explicit link | Fail closed and show a clear message. No scoped failure retries at root. Ordinary unrequested single-Runtime 404/405 remains compatible. |
| Fake optional workspace host only | Delay snapshot/event/preview/plan; commit a workspace change before reply, including A→B→A | Old data, errors, notices and cursor cannot update current state. Verify both epoch and active ID, not only selected ID. Abort and delayed queued responses are covered. |
| Fake optional workspace host only | Switch after validation/before plan or apply; switch during any already submitted mutation | No new stage executes in another workspace. Original uncertain effect retains its original partition and request identity; no automatic replay, cancellation claim or success in new workspace. |
| Fake optional workspace host only | Equal revisions, identical template/connection/task IDs and same labels across A/B; private or unauthorized workspace | Identity stays workspace/account-bound. Revision collisions or endpoint availability do not bypass inventory or permission gates. |
| Fake optional workspace host only | Separate accounts, stable identity unavailable, old unpartitioned ledger, logout/login same origin | No cross-account pending-attempt disclosure/action. Conservative recovery preserves unresolved intent without guessing provenance. |
| Both, independent root review | Integration and rollback | Run focused transport/ledger/component tests, existing frontend contracts, repository check/typecheck/build and real single-Runtime browser checks. Confirm no authority or server action semantics changed and no external/paid calls occurred. |

Rollback removes the additive bridge consumption while preserving or quarantining partitioned pending attempts, with no automatic replay or reverse migration into an ambiguous legacy key. Reverting UI plumbing is not evidence that an accepted mutation was undone. Before reverting to older unpartitioned UI, unresolved entries need an explicit safe handling plan. No database rollback or new ledger is involved.

## Remaining work

Only the audit and this proposal are complete. Real O17 browser acceptance, a reviewed transport API, safe ledger migration details, implementation, focused tests and integrated acceptance are outstanding. The deferred tests do not replace a real browser, and fake workspace-host tests must never be presented as current server multiworkspace support. The denied trace POST unknown-effect behavior remains outside this line and unchanged.
