# Scheduler admission and observations

The existing Runtime queue remains the only scheduler. `cancel` and `cleanup` bypass worker capacity and pause; read-only state inspection does not consume a slot or advance fairness.

Optional live settings:

```json
{"scheduler":{"interactiveBurst":3,"projectConcurrency":2,"backendConcurrency":{"codex":2},"workspaceConcurrency":1}}
```

Only `interactiveBurst` has an enabled default. Omitted resource limits are unlimited. Limits count distinct root task families: a root and its children share one project/workspace slot, and consume one slot on each backend actually used. A child's different backend must independently admit it. Native continuations use their retained backend identity, not a newly selected profile. Source/worktree aliases are canonicalized. Browser session capacity and per-session action serialization reuse the existing browser manager; browser limits are not a second task scheduler.

Lowering a limit does not terminate admitted work. Unknown resource identities fail closed when the affected limit is enabled. Restarted work retains interrupted history; confirmed released capacity is marked separately. Shell recovery only releases after a POSIX process-group existence probe confirms that the group no longer exists. A result file or exited leader alone is insufficient. Windows, absent PID, permission errors, and unconfirmed group shutdown remain conservatively blocked and require inspection; automatic recovery is not promised.

After the interactive burst, all ordinary candidates are considered before further interactive candidates in that scheduling domain. Blocked ordinary candidates do not consume the opportunity. This prevents continuous interactive input from starving eligible ordinary work without bypassing authority, serialization, or resource limits.

The scheduler panel and task trace show the same admission reasons and opaque resource references. References are for correlation, not filesystem paths or access capabilities. Wait summaries contain actual enqueue-to-admission samples from the previous hour with sample counts, p50, p95, and maximum. Historical jobs without recorded enqueue times remain unknown. These are observations, not a provider-latency promise or an SLA. No samples means no measured latency.

Validation uses deterministic local model fixtures. Actual paid providers, real IM delivery, and manual browser interaction are not validated by these scheduler tests.
