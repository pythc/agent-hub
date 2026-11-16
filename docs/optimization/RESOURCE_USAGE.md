# O43.1 — read-only resource observations

O43 remains open. This slice adds a numeric-only projection over existing accounting, context checks and managed-work records. It adds no billing system, prices, quota, reservation, budget enforcer, model invocation or UI. Existing ledger, context enforcement, WorkManager and project-budget authority remain unchanged.

## API and scope

`GET /api/resource-usage` requires the existing current operator authorization. Only an empty query is accepted: parameters, including an empty `workspace`, `source`, duplicate or unknown parameter, return `400 {"code":"resource_usage_query_invalid"}`. This is an empty-query rule, not server-side workspace selection or isolation. The real local host still owns one Runtime. Future UI transport must use its separately reviewed C1 binding; the response is explicitly `scope: 'host'`.

Other methods return 405. Projection failure returns only `503 {"code":"resource_usage_unavailable"}`. Provider errors, paths, raw records, prompts, output, source/task/agent/session IDs and configuration objects are never returned. The response is not an action receipt or an admission decision.

```ts
interface ResourceUsageSnapshot {
  schema: 1
  observedAt: number
  settingsRevision: number
  scope: 'host'
  usage: UsageSummary // existing src/usage-contract.ts, not a new accounting contract
  context: {
    retainedActivities: number
    withinBudgetActivities: number
    exceededActivities: number
    unrecognizedActivities: number
    lastCheckAt: number | null
  }
  work: {
    retainedItems: number
    states: Record<'starting'|'running'|'completed'|'failed'|'cancelled'|'interrupted', number>
    unrecognizedStateItems: number
    deadlineItems: number
    pastDeadlineItems: number
    invalidDeadlineItems: number
    limits: {
      maxAgentsPerTicket: number
      maxDepth: number
      backgroundTimeoutMs: number
      maxOutputBytesPerShell: number
    }
  }
}
```

`ResourceUsage.snapshot()` captures the Runtime getter once and completes synchronously without awaiting a replacement host. Its settings revision, config, work, store and existing usage instance come from that same Runtime. `observedAt` records observation time, not a provider billing cutoff. The watchdog database is observed separately; there is no atomic transaction across host and observer. Settings revision is metadata, not a usage cache key.

## Existing facts and limits

- `host.usage.summary()` is reused. It has no cache or lazy writes. It reads retained host usage and execution-call records and, when present, opens the watchdog database with `readOnly: true`, executes a SELECT and closes it. The observer's running records are not finished or copied into the host. ENOENT does not set `watchdogUnavailable`; another observer read failure preserves host counts and marks the summary incomplete. This is application-level read-only behavior, not a promise about SQLite implementation-level shared-memory files.
- Do not instantiate UsageLedger in this read path: its constructor repairs running host usage to interrupted. Do not instantiate Store or Settings either. This module creates none of these owners and never calls accounting writes, WorkManager.tick(), scope repair, budget enforcement, model calls or task recovery.
- Existing step snapshots replace the same attempt/usage ID. Retries retain their separate reported usage. Unknown and explicit zero remain different. Partial calls are a subset of reported calls and include failed/interrupted or incomplete reporting. Cache input is already included in input; reasoning output is already included in output. Aggregate token fields may have different reporting coverage and must not be recombined to infer missing totals. Safe-integer overflow remains null through the existing ledger.
- The returned UsageSummary is cloned through a numeric/enum whitelist, with original coverage semantics and no accidental extra metadata. A structurally unreadable summary, inconsistent/nonrepresentable coverage counters, or unreadable host JSON fails as unavailable. The projection does not invent a replacement accounting total. Existing invalid provider telemetry continues to be ignored by the ledger's normalization and therefore remains unknown.
- Runtime stores `context-budget` by activity, replacing the previous receipt. Context counters classify those retained latest checks, not all checks ever performed, cumulative bytes, current task readiness or current free context. Used fields (activity, phase, basis, status, bytes, limit, reserve and time) must be recognizable. Invalid or contradictory receipts count as unrecognized; only valid checks contribute to `lastCheckAt`. The within/exceeded comparison uses `bytes <= maxBytes - reservedBytes` so an unsafe addition is never emitted as a precise total. No bytes are summed across activities or API/native bases.
- Work counters describe retained records, not live jobs, processes, leases, schedulable capacity or proof of a side effect. Unknown kinds/states count as unrecognized. Known starting/running items with a valid recorded deadline contribute to deadlineItems; a recorded time at or before observedAt contributes to pastDeadlineItems. Invalid present deadlines count separately. Terminal records do not contribute to these deadline counters. Reading does not expire or cancel work. The sum of state counts plus unrecognizedStateItems equals retainedItems.
- `maxAgentsPerTicket` is the existing per-ticket subagent admission limit, not host-wide free Worker slots. `maxDepth` is the existing nesting gate. `backgroundTimeoutMs` is the configured background-turn deadline interval: WorkManager attaches deadlines after a turn, clears them on a new turn, and treats held/handoff work separately. `maxOutputBytesPerShell` caps retained managed-shell output, not disk quota, tokens or API output. These numeric values come from current config; they do not retroactively attest which limit governed a retained item. This endpoint neither changes nor promises enforcement beyond existing owners.
- Existing `projectBudget()` estimates only authorized local code-project usage using the operator's configured rates and existing elapsed-time rules. Its enforcement remains in RouterGoals. This first slice does not include project cost, prices, account balance, monthly billing, CPU/network usage, polling costs or new limits. Missing telemetry does not prove zero resource use.

## Verification

Focused automated checks: `npx vitest run tests/resource-usage.spec.ts tests/model-usage.spec.ts tests/context-budget.spec.ts`. Host type check: `npx tsc --noEmit --pretty false`. Integration owns final combined checks and later UI/browser acceptance.

The new tests compare every host table and observer table before/after repeated reads, retain both running accounting records, check original unknown/partial/zero/retry deduplication, observer failure, token overflow, latest-check replacement and malformed context/work records. They verify same-Runtime getter capture even if the active getter target changes during summary construction, and fresh usage with an unchanged settings revision. HTTP checks cover authorization, GET-only behavior, strict empty query and fixed unavailable responses. Synthetic work records are fixture data only, never live processes, and are removed during teardown.

No real provider, paid call, IM operation or external message is required or claimed. This backend slice does not count as whole-O43 acceptance.

## Migration and rollback

No persistent schema, ledger rewrite, repair step or data migration is introduced. Roll back the new GET route/import/instance and `src/resource-usage.ts`; remove its tests/docs if desired. Existing usage/context/work records remain intact and continue to serve their original owners. Future UI must treat a missing endpoint as unavailable, retain only an explicitly dated last snapshot on refresh failure, and never substitute zero or route a mutation through this projection.
