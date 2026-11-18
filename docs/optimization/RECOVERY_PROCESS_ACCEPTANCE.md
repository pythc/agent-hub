# O11/O49: real host crash at a tool-effect boundary

`tests/recovery-crash-process.spec.ts` launches the actual Runtime in a separate Node process with a temporary SQLite state directory and an explicitly granted local MCP connection. A deterministic task is prepared using existing Engine/store fixture contracts; real model inference and automatic Runtime ticks are disabled. The fault-injection fixtures do not change production execution, authorization, recovery policy or CI configuration. This increment also corrects the recovery-manifest tool-checkpoint query to exclude model-call transitions already classified as run events by the trace, as described below.

The parent test owns a loopback-only HTTP MCP server. Its write tool records one synthetic effect in an independent temporary file and fsyncs that file before resolving a barrier. In the unacknowledged case it withholds the MCP response. The parent then verifies the host's real tool receipt is still `running`, sends SIGKILL, and waits for process close before reopening the same state directory in another real host process. This does not simulate a crash by throwing an exception or gracefully closing Runtime.

The original two cases are:

- **Effect recorded, reply withheld:** startup changes the retained receipt to `uncertain`; the recovery manifest requires reconciliation, forbids replay and offers no session-resume action. Calling the existing tool with the same request ID returns the uncertain receipt without contacting the tool again.
- **Result committed:** the initial host returns its completed result before SIGKILL. Reopening and repeating the same request ID returns the identical saved result, without another effect.

Each case reopens twice. The independently owned effect file and tool invocation count must remain exactly one. Original tool audit events must survive, manifest checkpoints must reference the latest retained tool transition, and the second reopening must not add duplicate tool-receipt transitions (wrapper invocation records can legitimately change on a deduplicated call). A startup `running` to `uncertain` transition is expected; cursor equality to the pre-crash event is not incorrectly required.

Synchronization uses IPC and a tool-effect barrier, not sleep-based crash timing. Deadline timers only bound test failure. Cleanup kills and awaits only the test's own children, releases pending fixture responses, closes local MCP connections, and removes only its temporary directory. Loopback errors are test failures rather than skipped or bypassed checks. Ubuntu/macOS are the intended SIGKILL targets.

Those original two cases prove process-crash behavior for an existing request identity under unchanged authority. The expanded matrix below adds other bounded windows; none proves power-loss durability, real platform acceptance, exactly-once execution for a new request ID, actual provider session restoration, or a complete recovery engine.

Reproduce locally:

```sh
npx vitest run tests/recovery-crash-process.spec.ts --maxWorkers=1
npm run typecheck
```

## O11 retained-runtime checkpoint matrix

The focused matrix now adds the following real Runtime process boundaries. Each
fault is a SIGKILL followed by process `close`, then a fresh Runtime on the same
state directory. IPC identifies each window; no sleep chooses when to crash.

| Boundary | Local evidence and recovery expectation |
| --- | --- |
| Before the Worker tool entry | The host acknowledges an unreleased IPC gate immediately before the actual tool call. Two reopens leave the independent MCP effect count at zero and create no tool receipt. A live explicitly released control reaches the real tool once. |
| Tool effect completed, receipt missing / receipt committed | The original two MCP cases above remain unchanged in purpose: unknown requires reconciliation; the same completed request identity returns its saved result. |
| Worker result persisted, acceptance not recorded | After a completed MCP effect, the real Runtime execute/report path consumes a deterministic local model fixture and saves its result. The parent kills only after that return. Two reopens retain the result and complete tool receipt but do not manufacture a passed verification, rerun the model, or repeat the effect. This is a boundary before any independent acceptance round, not a claim that an in-progress verifier was crashed. |
| Outbox pending, before send | Kill before `flush`; reopening and explicitly flushing sends the original delivery exactly once, preserving its identity. |
| Outbox sending, destination effect without ACK | A local MessageSource deliver waits on IPC while the parent fsyncs the independent destination ledger. Kill before the response; reopens retain `uncertain`, require reconciliation, and repeated flushes never send again. |
| Changed authority or recovery observation | Settings revokes the original operator (retaining a valid replacement), Engine stops the mandate, or a fixture persists uncertain repository evidence before the crash. Reopened `ExecutionTrace.recover` rejects both stale observations and fresh requests that lack authority / reconciliation. Unchanged fresh explicit resume is the positive control and queues one assignment without inference; repeated request IDs do not queue twice. |

The model and MessageSource are explicitly local controlled adapters, not real
provider or IM acceptance. Automatic Runtime ticks are disabled so fault windows
and explicit resume/flush operations remain isolated. The result fixture invokes
the production execution/report path directly after an Engine note; it does not
replace persistence, recovery, permission or delivery implementations. Authority
fixtures persist their unknown repository receipt directly and do not claim to
have contacted a repository service.

The result case also guards the tool-checkpoint classification: legacy audit
`execution-call` records for worker/router/subagent model calls are displayed as
`run` transitions and must not be selected as tool checkpoints. The checkpoint
query keeps the existing retained-ticket index and ignores these non-tool calls;
legacy tool records without `callKind` remain valid.

Run the complete local process matrix with:

```sh
npx vitest run tests/recovery-crash-process.spec.ts tests/recovery-delivery-crash.spec.ts tests/recovery-authority-crash.spec.ts tests/recovery-checkpoint-index.spec.ts --maxWorkers=1
```

These are bounded local process-crash checks, not proof of every external effect,
OS power-loss durability, cross-machine restoration, real credentials/platforms,
or browser/keyboard/narrow-screen acceptance. The diagnostic package remains a
non-executable redacted handoff, not an importable restore or authorization token.
Issue closure requires separate review, exact integrated checks and the agreed
remaining acceptance; adding this matrix alone does not declare O11 complete.
