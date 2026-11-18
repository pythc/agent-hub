# O11/O49: real host crash at a tool-effect boundary

`tests/recovery-crash-process.spec.ts` launches the actual Runtime in a separate Node process with a temporary SQLite state directory and an explicitly granted local MCP connection. A deterministic task is prepared using existing Engine/store fixture contracts; model inference and automatic Runtime ticks are disabled. Production code, authorization, recovery policies and CI configuration are unchanged.

The parent test owns a loopback-only HTTP MCP server. Its write tool records one synthetic effect in an independent temporary file and fsyncs that file before resolving a barrier. In the unacknowledged case it withholds the MCP response. The parent then verifies the host's real tool receipt is still `running`, sends SIGKILL, and waits for process close before reopening the same state directory in another real host process. This does not simulate a crash by throwing an exception or gracefully closing Runtime.

Two cases are covered:

- **Effect recorded, reply withheld:** startup changes the retained receipt to `uncertain`; the recovery manifest requires reconciliation, forbids replay and offers no session-resume action. Calling the existing tool with the same request ID returns the uncertain receipt without contacting the tool again.
- **Result committed:** the initial host returns its completed result before SIGKILL. Reopening and repeating the same request ID returns the identical saved result, without another effect.

Each case reopens twice. The independently owned effect file and tool invocation count must remain exactly one. Original tool audit events must survive, manifest checkpoints must reference the latest retained tool transition, and the second reopening must not add duplicate tool-receipt transitions (wrapper invocation records can legitimately change on a deduplicated call). A startup `running` to `uncertain` transition is expected; cursor equality to the pre-crash event is not incorrectly required.

Synchronization uses IPC and a tool-effect barrier, not sleep-based crash timing. Deadline timers only bound test failure. Cleanup kills and awaits only the test's own children, releases pending fixture responses, closes local MCP connections, and removes only its temporary directory. Loopback errors are test failures rather than skipped or bypassed checks. Ubuntu/macOS are the intended SIGKILL targets.

This proves process-crash behavior for an existing request identity under unchanged authority. It does not prove power-loss durability, real platform acceptance, exactly-once execution for a new request ID, inference/session restoration, delivery/outbox crash safety, or a complete recovery engine. O11/O49 remain open beyond this narrow evidence.

Reproduce locally:

```sh
npx vitest run tests/recovery-crash-process.spec.ts --maxWorkers=1
npm run typecheck
```
