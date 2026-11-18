# S0/G01 shared contract proposal and O07–O09 implementation slices

**Status: proposal only — not frozen, not implemented, not acceptance evidence.**

This document preserves read-only design findings for review and recovery. The source inspection used `d302e4b6dd3803a16adc4743683e11a2a14b0a56` on `feat/worker-connector-acp-trace-20261116`; it is not a declaration that the later integrated head passed CI. The inspection changed no runtime state and ran no tests. The subsequent document-only save implements none of the proposed interfaces.

The parent plan is [MASTER_TODO.md](MASTER_TODO.md), especially G01, O07, O08 and O09. G00 remains a separate gate. This proposal does not authorize, implement or work around any blocked CI, sandbox or AppArmor change. Existing restrictions on real external messages, paid calls, public deployment, use of the user's Mac, and merging main remain in force.

## 1. Existing authority and reuse boundaries

References below name types and methods as inspected. Line numbers belong to the inspection snapshot and may move.

| Object | Existing definition or entry point | Authority to preserve |
| --- | --- | --- |
| Task authorization | `src/vendor/dsh-core/model.ts:125` — `Mandate`; the same module's `Ticket` | Immutable authorization, task ending and assignment lifecycle. |
| Goal contract | `src/goal-replanning.ts:18` — `GoalContract` | Original objective, criteria, mandate and permitted Worker/backend references. The type is not currently defined in `goal-contract.ts`. |
| Goal execution | `src/router-goals.ts:24` — `RouterGoal`; `src/goal-contract.ts:23` — `GoalNode` | Goal control revision, reviewed plan revision, nodes and dispatch relationships. |
| Current permissions | `src/router-scope.ts:13` — `EntryBinding`, `TaskOwnership`, `TaskChannel` | Identity, entry binding revision, owner epoch, input data revision and current capability checks. |
| Durable scheduling and delivery | `src/store.ts:12` — `Job`, `Delivery`, `Run`; table definitions at lines 45–50 | `jobs` schedules; `outbox` delivers; `records` holds domain facts; `audit.seq` supports durable catch-up. |
| Acceptance and artifacts | `src/goal-verification.ts:19` — `VerificationRound`; `src/goal-artifacts.ts:15` — `ArtifactVersion` | Fixed evidence snapshots, acceptance freshness, artifact version and content identity. |
| Short-lived execution approval | `src/approvals.ts:6` — `Approval`, `Approvals` | A 120-second approval bound to a live execution callback; pending approvals expire on restart. |
| Display and recovery entry | `src/execution-trace.ts:23` — `TraceTask`; `ExecutionTrace` | A safe read model and an entry point that delegates recovery to Runtime. It is not execution authority. |

The minimum shared contract should standardize references and projections. It should not create a second task database, effect authority, scheduler or complete event-sourced replacement.

## 2. S0/G01 minimum shared contracts

### 2.1 Task basis reference

Proposed `TaskBasisRefV1` identifies an existing goal or task with a discriminated subject reference. A goal can exist before dispatch, so it carries `goalId` and adds `ticketId`/`assignmentId` only when those objects exist; an ordinary task carries its existing `ticketId` and relevant assignment reference. Do not invent an assignment to represent an undispatched goal. Its contract reference uses the existing `GoalContract` digest for managed goals, or the immutable `Mandate` digest for ordinary tasks.

Keep these version dimensions separate:

| Version | Meaning |
| --- | --- |
| `goalRevision` | Goal control-state revision. |
| `planRevision` | Reviewed execution-graph revision. |
| Contract digest | Identity of the immutable authorization/acceptance contract. |
| `ownerEpoch` | Task ownership generation. |
| `dataRevision` | Current task input/result permission basis. |
| `bindingRevision` | Entry/destination binding revision. |
| `settingsRevision` | Configuration conflict guard. |

Do not collapse these into a generic `contractRevision`. Missing metadata on legacy records means **not captured**, not a fabricated zero that appears validated. An additive reference wrapper must not change the serialized historical `GoalContract`: its digest already participates in verification and replanning fences.

### 2.2 Asynchronous event envelope

Proposed `AsyncEnvelopeV1` has:

- `schemaVersion`, `eventId`, `subjectRef`;
- optional `basisRef`, `causationRef` and `attemptRef`;
- `occurredAt`, `observedAt`;
- bounded, allowlisted `facts` and/or an existing authorized `payloadRef`.

Continue using `audit.seq` for local stable event identity and catch-up. An attempt reference must point to the actual job, assignment or verification round rather than inventing one universal attempt count. Legacy causality remains explicitly absent. Event receipt, semantic deduplication and acceptance advancement are distinct operations.

Safe facts contain states and receipt references, not raw prompts, tool arguments, provider responses, secrets or hidden reasoning. Payload access remains under existing resource authorization and history-cleanup fences. Initially scope the journal to one instance; do not make cross-instance O41 identity work a hidden prerequisite.

### 2.3 Evidence references

Connection evidence should reference the existing `ConnectorDiagnostic` ID, source, checked layer, settings revision, check time and current-validity result. It must not copy credential-bearing configuration or raw provider payloads. Existing implementation: `src/connector-management.ts:15`.

Artifact references reuse `ArtifactVersion.id/version/sha256/size/mime` and its task/goal ownership. Generation, acceptance and publication are separate facts linked to verification or delivery receipts. A saved artifact is not automatically accepted or published.

### 2.4 State compatibility

Keep existing persisted state values under their current owners. Introduce four independent status facets as an additive projection; do not rename every database state in one migration or replace their meanings with a single success flag.

## 3. O07 — four independent status facets

A proposed read-only interface is:

```ts
projectTaskStatus(host, ticketId, context): {
  basis: TaskBasisRefV1
  execution: StatusFacet
  effect: StatusFacet
  acceptance: StatusFacet
  delivery: StatusFacet
  observedAt: number
  nextSafeActions: ActionDescriptor[]
}
```

`StatusFacet` should include its own state, authoritative receipt references and evidence level. The names above describe a proposal, not existing exports.

| Facet | Derivation and required distinction |
| --- | --- |
| Execution | Current assignment, Run, execution-call and active managed work. An idle Run alone is not successful completion. |
| Effect | Existing effect receipts. Any unknown effect remains visible even if execution finished, a task was cancelled or acceptance passed. |
| Acceptance | Existing verification rounds, with current snapshot validation. Use `GoalVerification.current(round, goal)` in `src/goal-verification.ts:200`; do not simply display the latest round's persisted `passed` state. |
| Delivery | Outbox facts. Existing `sent` records host delivery success; without stronger receipts it does not establish provider identity or readback. Local Router inbox delivery must remain distinguishable from external delivery. |

Acceptance creation already checks unfinished/uncertain task effects in `GoalVerification.ensure` (`src/goal-verification.ts:203`). Preserve that gate. A compatibility reader should mark stale verification evidence as stale instead of rewriting the original verdict.

The first UI slice can show combinations such as execution complete / effects confirmed / acceptance pending / delivery waiting to retry. Preserve the old `TraceTask.state` for existing clients while new clients consume the four facets. Do not advertise a direct retry action when any relevant effect remains unknown.

## 4. O08 — effect references and reconciliation through existing owners

Existing authorities include:

- outbox and its delivery states in `src/store.ts`;
- `Receipt` in `src/tool-connections.ts:15`;
- `browser-receipt` and its `running/complete/uncertain` states in `src/browser-manager.ts:60`;
- `WorkflowAction` in `src/workflow-actions.ts:16`;
- `pr-delivery`, `review-action` and `merge-attempt`, already checked by `repositoryEffectsSettled` in `src/repository-source.ts:28`.

Proposed first interfaces:

```ts
listEffectRefs(ticketId, context)
inspectEffect(ref, context)
reconcileEffect(ref, {
  requestId,
  expectedRevision,
  expectedFingerprint,
  basis
}, context)
```

An `EffectRef` is `{ownerKind, id}`. The unified view may carry operation/destination digests, captured authority references, an existing remote identifier, evidence level and query capability. Its state still comes from the original receipt owner. Do not create a parallel canonical `effects` state store.

Reconciliation should proceed as follows:

1. Persist a bounded local reconciliation request/receipt.
2. Outside the local transaction, make an adapter-owned read-only query using the original account, target and operation identity.
3. Revalidate current authority, target identity, fingerprint and expected version.
4. Let the original receipt owner atomically store the observation and audit fact.

`Store.atomic` is synchronous; do not await network calls inside it. Callback and query observations must converge on the same operation identity. A missing or ambiguous remote result remains unknown. Do not promise global exactly-once behavior or issue a second write to discover whether the first succeeded.

### Source adapter gap that must be explicit

`Source.deliver` currently returns `Promise<void>` (`src/sources.ts:44`). `ProcessSource.deliver` ignores the invocation result (`src/plugin-process.ts:294`). Plugin manifest methods are a strict enumeration (`src/plugin-package.ts:17`). Consequently current `sent` or tool `complete` states cannot supply a remote ID or readback that was never captured.

Remote receipt return, query-by-ID/query-by-idempotency-key and idempotency guarantees need optional, versioned, negotiated adapter capabilities. Legacy adapters default to unsupported. A TypeScript-only return-type expansion is not implementation or acceptance of those capabilities. Query operations must use canonical adapter targets, not arbitrary URLs supplied by the UI/model, and must return bounded sanitized facts rather than provider payloads.

A useful existing narrow model is `WorkflowActions.decide(... reconcile ...)` (`src/workflow-actions.ts:164`): observe the expected remote state, then record `observed`, while distinguishing it from a confirmed write by this host. Reconciliation must not silently convert every old `complete/sent` record into remote-confirmed success.

## 5. O09 — durable business decisions, separate from execution approvals

The current `Approvals` class has an in-memory Promise resolver, expires after 120 seconds and invalidates pending requests on restart (`src/approvals.ts:8–22`). Increasing that TTL cannot implement an overnight business decision. Do not migrate native approvals into business requests or reconstruct their expired native callbacks.

A proposed `BusinessDecisionRequestV1` belongs in existing `records` because it represents a necessary new domain fact: which business decision is pending for which recipient and target.

```ts
{
  id,
  schemaVersion: 1,
  revision,
  ticketId?,
  goalId?,
  basis,
  recipientBinding,
  replyBinding,
  subjectDigest,
  choices,
  createdAt,
  expiresAt,
  state: 'pending' | 'answered' | 'expired' | 'cancelled' | 'stale',
  answerRef?
}
```

Begin with `RouterGoal.state='needs_input'`, then extend to ordinary tasks. Proposed operations are `create/list/inspect/answer/cancel`; none is a general approve-and-execute-anything API.

- Before waiting, let the current execution turn checkpoint/yield normally and release resources. Do not retain a two-hour native permission token, Promise, browser lease or active provider turn.
- Bind an answer to verified identity, original entry/conversation, request ID, question revision and target digest. Capture material amount/recipient fields in structured target identity when the decision concerns them.
- Atomically retain the answer and enqueue a stable-ID local processing job.
- Before consuming the answer, recheck contract/input versions, current authority, cancellation and unsettled effects. Archive stale answers without reviving work.
- An accepted answer is new business input. Subsequent work still uses existing Router/Worker dispatch and fresh short-lived execution permission where required.
- The original `Approval` lifecycle and restart behavior stay intact.

### Semantic migration and old-binary safety

Once a persisted business decision means work **must wait**, an old binary that ignores the new record could incorrectly continue the task. Reusing `records` does not remove this compatibility problem. The implementation must choose a schema/version gate or prove a compatible, durable existing blocker that old execution cannot bypass. Review that choice before persistence is enabled.

Rollback must preserve waiting work under control. Deleting the business request to make an older binary start is not a safe rollback. Native pending approvals remain expired; they do not become long-lived approvals. New request/answer records and effect metadata also need existing visibility, history-cleanup and permission-revocation handling.

## 6. Small, independently reviewable commit order

These are proposed implementation slices; this document save performs none of them. Implementation remains within the user’s existing authorization and relevant gates. Each slice still needs current-SHA independent review and applicable actual-page/function acceptance from MASTER_TODO.

| Slice | Scope | Exit evidence |
| --- | --- | --- |
| C1 | G01 reference types, four-facet vocabulary and compatibility matrix | No persisted behavior change; existing contracts and fields retain their meaning. |
| C2 | O07 pure projection and additive API fields | Cases for execution complete but delivery pending, cancellation with unknown effects, and stale acceptance. |
| C3 | O07 existing trace UI four-facet display | Real current-head page, reload/failure behavior and reduced-motion checks. |
| C4 | O08 existing receipt references and read-only inspector | Zero external writes; unsupported capabilities are explicit. |
| C5 | One adapter's optional query capability and compatibility negotiation | Simulated remote success with lost response, duplicate query, account/target drift and unsupported old adapter. |
| C6 | Reconciliation command and original-owner atomic receipt update | Only receipt/observation repair; unknown never resends; cancellation races do not revive work. |
| C7 | O09 durable business request lifecycle and reading | Controlled clock across two hours and process restart, expiry, and unchanged native approval behavior; old-binary fail-closed decision documented. |
| C8 | Answer matching and existing job/goal input integration | Wrong identity, old target, duplicate answer and post-cancellation answer cannot advance execution. |
| C9 | O09 original-conversation/page entry and integrated regression | Keyboard/narrow viewport, answer after restart, existing authority/cleanup behavior and independent review. |

## 7. Evidence and scope limits

This document supplies source/type references, proposed interfaces, compatibility risks and a small-commit order. It contains no runtime or CI/AppArmor edits, no database migration, no new tests, no actual-service verification and no completed O07/O08/O09 claim. Historical trace tests and prior screenshots do not validate future slices. G01 can be reviewed as a draft while G00 is blocked; final freeze and release/acceptance gates remain separate.
