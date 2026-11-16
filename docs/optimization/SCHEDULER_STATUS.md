# O05.1: read-only scheduler observation

This first slice adds `GET /api/scheduler-status` behind the existing current-operator authorization. O05 / issue #16 remains open: this first aggregate observation slice has a simple UI, independent review and cloud-local actual-page acceptance; full queue reasons, fairness and broader quotas remain future work. No execution, effect, recovery, or admission permission is added or relaxed. The previously blocked trace POST recovery scope is untouched.

`Runtime.schedulerStatus(): SchedulerStatus` synchronously reads the actual `runningJobs` and `controllers` maps, configured `workerProfiles`, current `Run`/`WorkItem` records and jobs table. It never calls `dispatchWorker`, selects a Worker, updates a pool cursor, repairs a record, invokes a model or probes a provider. The response contains only the following bounded aggregate shape; no task, actor, source, worker, session or job IDs, prompts, parameters, paths, errors or model output are returned. Failures return a fixed `scheduler_status_unavailable` code (503), without underlying exception text.

```ts
interface SchedulerStatus {
  schema: 1
  observedAt: number // host milliseconds; one synchronous observation, no reservation
  paused: boolean
  occupancy: {
    jobs: number; routingJobs: number; workerJobs: number; controllers: number
    backgroundReservations: number; activeManagedWork: number
  }
  workers: {
    configured: number; enabled: number; paused: number; retiring: number
    idleEnabled: number
  }
  routing: { countedLimit: 4; admittedButWorkerCountedJobs: number }
  interactive: {
    additionalLimit: 1; eligibleQueued: number; activeReservedExecutions: number
    mode: 'existing_session' | 'legacy_pool'
  }
  queue: { ready: number; delayed: number; blocked: number; uncertain: number }
}
```

## Meaning and limits

- `jobs`, `routingJobs` and `workerJobs` count live Runtime job promises using the scheduler's original key prefixes. `controllers` separately counts actual active cancellation controllers. A persisted `running` phase alone never adds a live job or controller.
- `backgroundReservations` counts background Runs with automatic, nonterminal work belonging to the same assignment and no active ticket controller. This is the scheduler's global observation; admission excludes the candidate's own background reservation, so it is not a per-candidate decision. `activeManagedWork` includes all starting/running work (including held work and foreground work), without double-adding it to live job occupancy.
- `configured` is the existing configured worker profile count used by the admission gate, including paused/retiring profiles as the scheduler does today. `enabled` excludes paused/retiring. `idleEnabled` applies dispatch's busy predicate to enabled configured profiles; it describes globally idle profiles, not a promise that a particular task may use them. Task assignment, existing session affinity, scope/private access, ownership, pauses and other authority constraints still apply. Retiring Workers may serve eligible prior owners under the existing dispatch policy, but never count as idle enabled Workers. Profiles outside the configured pool are not added.
- `countedLimit` is the existing limit for prefix-counted routing jobs. **It is not a maximum of four for every Router activity.** In the current code, `router-scheduled-followup` and `router-skill-run` use routing admission while their keys count on the worker side. `admittedButWorkerCountedJobs` exposes that existing difference. This slice preserves it instead of silently repairing quotas.
- `additionalLimit` describes the existing non-routing admission rule's maximum extra slot of one. With an explicit pool, interactive execution needs an existing thread; without it, the legacy interactive rule applies. `eligibleQueued` counts due jobs satisfying this exact additional-slot predicate; it does not mean they pass every other admission check or have a free profile. Routing followups also match that predicate but use routing admission, not an extra Worker slot. `activeReservedExecutions` counts recorded `interactiveReserve` executions only while they have a live controller or background reservation; it is not a count of all interactive Router jobs.
- Queue `ready` means pending and due by `observedAt`, not immediately runnable. It includes maintenance/control jobs, serialized discussions and jobs held by other policy checks. `delayed` means pending but not yet due; `blocked` and `uncertain` preserve their authoritative states. Counts are not terminal success/delivery claims.
- `paused` means ordinary scheduling is paused. Existing work may still be running, and cancellation/cleanup are processed under the original rules.

Suggested default UI labels: “Working”, “Waiting”, “Paused”, “Background work”, “Available Workers”, “Continuing a conversation”. Use normal readable text; keep routing accounting details in optional diagnostics. Do not render `configured − occupancy` as universal free capacity or infer a reason for each queued task from these aggregate counts.

## Verification and rollback

Focused tests cover real tick saturation, four prefix-counted routing jobs, the two preserved routing/counting exceptions, paused admission, enabled/paused/retiring profiles, stale assignment and held background work, session-dependent interactive eligibility, actual fake-model controllers and a reserved continuation, redaction, exact records/jobs/outbox/audit stability, unchanged pool cursor, protected GET and denied POST. Provider/network/effect tests are not required or claimed. The model fixture is deterministic and creates no real third-party effects.

Run `npx vitest run tests/scheduler-status.spec.ts tests/worker-pool.spec.ts` and `npx tsc --noEmit --pretty false`; final integrated checks and browser acceptance belong to the integration line. No persistent schema or data migration exists. Rollback removes the endpoint/projection and restores the equivalent inline scheduler predicates. No ledger or new scheduling state needs cleanup.


## Independently verified first-slice checkpoint

Draft [PR #62](https://github.com/pythc/agent-hub/pull/62), source head `d1685363102f69d0a296e360c81d4ea477a002ff`, includes the reviewed backend, plain team panel and persisted actual Runtime/browser fixture. The runtime/UI is unchanged from native357e482, independently exercised by the integration owner. Ordinary [CI43899511531](https://github.com/pythc/agent-hub/actions/runs/43899511531) passed all three platform/Node jobs; [container43899511380](https://github.com/pythc/agent-hub/actions/runs/43899511380) passed at this exact head. No main merge, public deployment or user Mac.

Root's cloud-local browser run: `.local/scheduler-root-final/browser-report.json`, ten actual screenshots under its `screenshots/`, zero page errors, scheduler endpoint GET only. The real Runtime holds one deterministic Worker while a second task is genuinely pending; protected GET and page show working1/waiting1/idle0. Actual pause retains running work; releasing the first gate dispatches the second and clears the queue; releasing the second returns occupancy0/idle1. These normal observations are not response mocks. Separate labelled browser-only injections cover active aggregate variations, 503/invalid-schema refresh retention; theme/narrow/keyboard/Chinese/reduced motion are real rendering checks. No provider calls.

Reproduce in a fresh private fixture directory (set `CHROMIUM_EXECUTABLE` to a cloud-local Chromium if needed):

```sh
npm run build:chat
python3 tests/browser/run-scheduler-status.py .local/scheduler-review
```

Cloud integrated `npm run check`: 1623 pass /75 fail /4 skip,104 files pass/8 fail. `.local/scheduler-failure-comparison.json` proves the exact75 failing cases equal unchanged main on this same kernel; sandbox network isolation is refused (`NETLINK_ROUTE`), and the one EPIPE is also seen in baseline. This is not described as a green local full suite. All32 CI-policy Python regressions also passed independently. Read-only backend focused19 and frontend40 checks passed independently. The normal CI runner's full suite and actual container checks are separately green above.

The endpoint and panel are an observation only; no per-task blocked reason, new fairness algorithm, cross-project quota or SLA is promised. Issue #16 and master #11 remain open.
