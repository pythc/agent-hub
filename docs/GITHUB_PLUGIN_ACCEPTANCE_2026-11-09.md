# GitHub source plugin acceptance — 2026-11-09

Implementation commit: `9d87417` on `codex/github-plugin-20261109`, based on `93202e6cdb02c4a560ab364bf53cd400796b1bf7`.

## Implementation and review

- Delegated work subscribes to its original native Issue for context, including startup reconstruction. It retains the internal Worker reply channel and original authorization.
- CI polls include current-head Check Runs and latest Commit Status per context. Native thread validation prevents internal IDs becoming `issues/NaN`; successful polling retains a two-minute overlap. This bounded overlap does not promise recovery of arbitrary upstream retention or visibility delays.
- Allowed CI on an owned PR is admitted as a continuation of the existing authorized task. It cannot create duplicate work, replace the human requester, change the goal or weaken acceptance.
- GitHub transport is packaged under `plugins/github`. Core publication/review/merge depends on a repository capability contract; the legacy adapter remains a compatibility import. A differently named package kind is exercised without adding a source-kind branch to core.
- Publication and queued merge writes recheck current authority. Incomplete merge snapshots fail closed. Exact-head comparison, separate merge identity and existing human-review/check gates remain in place.
- Host-owned PR receipts are included in immutable acceptance evidence. Unknown publication/merge/review effects block verification, automatic repair and package changes. Unknown PR creation is not blindly retried.
- Code upgrade/rollback preserves the current database and requires drained work plus a compatible state protocol. Active goals or unresolved effects are refused.

Review specifically covered revoked actors, unrelated PRs, requester/manager permissions, duplicate task creation, native-thread recovery, cursor failure, unknown writes, stale merge grants, changed policy, new input during a queued mutation and rollback state retention.

## Automated checks

`npm run check` passed: TypeScript and chat type checking, chat production build, **72 test files / 1,062 tests**. Additional harness-only edits were type checked. `git diff --check` passed. The staged implementation contained no matches for the checked GitHub, Slack or API credential token patterns; this is a bounded pattern check, not a claim of exhaustive secret scanning.

## Real task

The dedicated private repository is `pythc/agenthub-github-validation`. The retained run uses [Issue #7](https://github.com/pythc/agenthub-github-validation/issues/7) and [draft PR #8](https://github.com/pythc/agenthub-github-validation/pull/8), with a real Router (`gpt-6.1-terra`, medium), Worker (`gpt-6.1-sol`, high) and fresh independent verifier conversations through the existing native Codex backend. The GitHub source itself runs as the sandboxed v2 package.

The task implements a currency CSV summary against frozen normal, header-only and empty-input assertions. It deliberately injects (1) a failing initial implementation, then (2) a false ready proposal with cents=999 instead of 660. These injections never change the original acceptance criteria. The host is stopped after initial publication; a real unaddressed Issue comment and real failing GitHub Commit Status are written while it is offline. Frozen tests execute locally before the controller posts their results to GitHub. This is actual platform I/O, not a hosted GitHub Actions run.

**Passed:** all 21 checks in [the sanitized evidence artifact](evidence/github-plugin-2026-11-09.json) are true. One goal and one task were retained across four separate host processes. Offline comments and failing CI were recovered; CI attached to the original task; one false ready report was rejected and one automatic verification repair completed. Both node and overall independent verification passed before release. The frozen tests, original mandate and acceptance criteria remained unchanged.

The source package moved through `1.0.0 / revision 1 → 1.1.0 / revision 2 → 1.0.0 / revision 3`; v2 executed a distinct probe canary. Identity, history and completed goal evidence survived rollback without restoring a database. The draft PR was closed only after independent overall acceptance, allowing the existing owned-PR task semantics to drain; it was never merged. The implementation file hashes match commit `9d87417` in every phase.

The controller's final read-only aggregation initially hit a GitHub EOF after all lifecycle phases had finished. Re-running only aggregation (`AGENTHUB_GITHUB_REPORT_ONLY=1`) succeeded without repeating model work or external writes. Full private phase snapshots and their hashes are retained locally; the repository contains only the sanitized result.

## Retained failed attempts and limits

Earlier runs are retained privately and are not counted as acceptance. The first exposed missing PR result evidence in the verifier ledger; the verifier correctly withheld acceptance, and this was fixed. A subsequent run missed a newly created Issue despite a successful poll and later single-item readback; the exact upstream cause was not captured, so list visibility delay remains an inference. The bounded overlap recovery has a deterministic regression test.

Two external CLI-plugin attempts encountered `process_failed` / `outcome_unknown` during execution/publication. Their uncertain states were retained, not converted into success. One dedicated branch was subsequently reconciled by an explicit operator push and readback; that attempt is excluded from passing evidence. This report does **not** establish successful end-to-end operation through the external CLI execution plugin. The verified passing path is the native Codex backend plus the GitHub source plugin.

This work does not deploy or restart the existing Roppo service, enable production GitHub admission, perform a real merge, or certify an arbitrary third-party publisher. Plugin code is operator-reviewed code with declared credentials/network access. Upgrade is quiescent, not a hot upgrade during active tasks. Unknown external effects may still require operator reconciliation.
