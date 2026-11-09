# Runtime recovery fixes — 2026-11-09

Baseline: `2f695dde7743052757f72ed89d768ca9a12ba0f4` (host `0.10.0`). The supplied isolated reproducer confirmed all five failures on this baseline before source changes. This patch fixes the runtime behavior and adds regression coverage; it does not update a running deployment.

## Changes

| Issue | Resulting behavior | Regression evidence |
| --- | --- | --- |
| Old backup discards tool deduplication receipts | Restore rejects a backup that lacks or differs from current MCP tool, browser-operation or merge-attempt records. Running and uncertain outcomes remain protected, as well as completed results. Unchanged receipts can still be restored. | Backup progress checks and a real local stdio MCP write: restore is refused, the receipt survives restart, and repeating the same request ID returns its result without another write. |
| Disabled GitHub source can merge | New grants require an enabled source, including after asynchronous preflight. Policy authorization skips disabled sources. The final pre-submit check verifies enablement and the current source instance. | Disabled source, policy grants, source withdrawal during snapshot reading and withdrawal during merge-account lookup. |
| Failed merge query removes uncertainty | `submitting` / `uncertain` cannot become `waiting` because a check fails, policy is disabled or a grant expires. The original write reason is retained; the new check failure is recorded separately as `checkError`. | Query failure followed by recovery and Merger restart never causes another PUT; a confirmed matching merged head can still reconcile the attempt. |
| Batched clarification leaves chat queued | A successfully delivered clarification is projected into the original chat, once. Chat state includes the batch and its jobs: pending, running, failed, completed or awaiting an answer. Startup recovers previously sent questions missing their chat row, subject to current authority. New input cannot join an old cancelled batch. | Clarification and follow-up, legacy restart recovery, accept/ignore/failure states, cancellation during evaluation, a new message after cancellation, and withheld recovery after cancellation or actor revocation. |
| Weekly DST gap exhausts scheduling | Calendar search spans two weekly cycles plus a day, and backlog coalescing uses the same horizon. Startup repairs active weekly plans with a missing next occurrence to a future legal instant, preserving the plan and its authorization. | New York spring gap and fall fold, an entire missing date in Pacific/Apia, end-time bounds, multiple weekdays, offline backlog, persisted scheduling and legacy repair; paused and expired plans remain unchanged. |

The clarification projection and delivery receipt are committed together. Its identity comes from the existing outbox message, not a new model call. Legacy recovery checks the original context manifest and input authority and does not resend the external message.

Restore is intentionally conservative: it cannot infer whether an arbitrary MCP tool is read-only, and a failed transport does not prove that no write happened. The fix refuses unsafe restoration rather than trying to merge old and new execution histories or silently replay effects.

## Code and tests

- Restore: [backup.ts](../src/backup.ts), [backup tests](../tests/backup.spec.ts), [MCP integration tests](../tests/tool-connections.spec.ts).
- Merge: [merge.ts](../src/merge.ts), [merge tests](../tests/merge.spec.ts).
- Chat: [chat.ts](../src/chat.ts), [runtime delivery](../src/runtime.ts), [chat tests](../tests/chat.spec.ts).
- Schedules: [schedule-time.ts](../src/schedule-time.ts), [Router lifecycle](../src/router-proactive.ts), [calendar tests](../tests/schedule-time.spec.ts), [persistent schedule tests](../tests/router-proactive.spec.ts).

Reproduce the automated suite from the repository root:

```sh
npm run check
npx vitest run tests/backup.spec.ts tests/tool-connections.spec.ts tests/merge.spec.ts tests/chat.spec.ts tests/schedule-time.spec.ts tests/router-proactive.spec.ts --maxWorkers=2
```

## Verification and review

Final `npm run check` passed: host/frontend/view type checks, frontend build, and **75 test files / 1,123 tests**, with no skipped tests in the full suite. The final fixed-outcome reproducer also passed all five cases. `git diff --check`, document link checks and the pinned upstream hash comparison passed.

The first added regression set failed in 18 cases before implementation and passed after the fixes; a further 3 cases cover legacy schedule repair and revoked/cancelled chat recovery. One additional positive batch-flow case also passed on the original code. A final regression reproduced a fresh message joining a cancelled pending batch, and the batch collector now excludes those batches. The total addition is 23 tests.

The supplied reproducer was preserved. A private copy changed only expected outcomes to check the fixed behavior, using disposable state, in-process GitHub/model fixtures and the repository's local stdio MCP fixture. All five checks passed:

| Observation | Before | After |
| --- | --- | --- |
| Merge PUTs after source disable | 1 | 0 |
| State after an uncertain merge's lookup fails | `waiting` | `uncertain` |
| Merge PUTs across that failure and another tick | 2 | 1 |
| Clarification assistant messages / chat state | 0 / `queued` | 1 / `waiting`; follow-up accepted |
| Restore after a new MCP write | Allowed; receipt lost | Refused; receipt retained |
| Actual MCP writes with the same request ID | 2 | 1 |
| Next weekly occurrence after 2026-03-01, Sunday 02:30 New York | Missing | `2026-03-15T06:30:00Z` |

Manual review covered the write-before-receipt boundary, restore refusal without database replacement, source disable during awaits, preserved unknown merge outcomes, idempotent chat recovery, cancellation and authority rechecks, DST folds/gaps and future-only schedule repair. The 15 pinned DeepSeek domain-core files are not modified. No database schema change is introduced.

Local logs and the fixed-outcome reproducer are under `.local/review-five-*` and `.local/five-fixes-repro.mts`; they are not published as production evidence. A new revoked-actor test initially used an invalid empty local-operator configuration, then changed only the in-memory startup configuration that saved settings correctly superseded on restart. The final regression uses the real versioned settings update to retain a different valid operator while persistently revoking the original actor. Production validation was not weakened; the failed test logs are retained.

These checks do not establish real GitHub merge behavior, live model quality, external account acceptance, browser visual acceptance or cross-platform deployment. No real external write, model invocation, security scan, push or production restart was performed for this patch. Existing configuration and unrelated working-tree documents were preserved.

## Integration for release

The subsequent publish/deploy request found the running instance already at `b4f4b65cb9a0578cc06772d3c032e8139407e343`, including the GitHub repository provider and execution-backend plugins. Recovery commit `a1c58d4` was merged onto that deployed baseline in an isolated worktree, preserving those capabilities rather than replacing the instance with older mainline code.

The merge retains the provider-neutral repository contract, repository snapshot validation and the provider's final authorization callback. The source-enable checks and durable uncertainty handling apply through this contract; test fixtures use the provider methods rather than the older injected merge API.

The integrated `npm run check` passed **80 test files / 1,163 tests**, with host/frontend/view type checks and the frontend build. All five isolated scenarios also passed using the repository-provider fixture. This is separate from the earlier 75-file validation. Production readback and private backup evidence are recorded by the deployment procedure; test fixtures do not send real GitHub writes or model requests.
