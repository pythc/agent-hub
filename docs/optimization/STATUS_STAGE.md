# O07 status projection stage

Status: implementation, independent review, cloud-local actual-page acceptance and integrated CI recorded; a separate recovery decision and later workspace consumers remain open. No O07 completion or Issue closure claim. Branch `feat/optimization-status-20261116` starts at `4d107cbc53fb3b3d50f326a3f447193689881ecb` and leaves PR #10 container changes on their own line.

File ownership: execution_trace implements backend projection/current-evidence read-only chain and focused tests; worker_templates owns trace TSX/CSS; connectors independently reviews; root owns local deployment/browser fixtures, integration and records. ACP work line separately investigates CI in `agent-hub-ci`; one team slot remains free. User-authorized CI-only policy work must not touch this feature stage’s runtime sandbox settings.

The additive four facets distinguish execution, effects, current independent acceptance and host-recorded delivery. Existing task/recovery states stay authoritative. No new effect ledger or automatic retry is introduced. Current acceptance must not trust a historical passed round after evidence/input/permission changes; status inspection must not register binary versions, refresh memory or produce deliveries.

Reproducible actual-browser command: `python3 tests/browser/run-execution-status.py .local/<fresh-status-dir>`. It starts the actual app and browser in one cloud namespace. Deterministic model and held/uncertain receipt fixtures are explicitly synthetic. This is not real IM, ACP or container verification. Acceptance includes current-to-stale artifact refresh, cancellation retaining unknown effects, reload, light/dark/narrow/keyboard/reduced-motion/Chinese. The runner stops its own app after checks.

No real provider calls, paid effects, public deployment, main merge or user Mac are permitted. Related Issues are being created independently by the parent; do not duplicate or close them based on this stage’s partial evidence.


## Progress and independent review

- Tracking: [O07 #18](https://github.com/pythc/agent-hub/issues/18), [master #11](https://github.com/pythc/agent-hub/issues/11), draft staged [PR #61](https://github.com/pythc/agent-hub/pull/61). Issues remain open. Do not create duplicates.
- Implementation checkpoints: `b9d52e6` UI, `e4fb3f7` strict delivery view schema and 40 lasting tests, `842d957` backend/explicit read-only verification with 27 focused tests. Backend plus existing trace/goal/memory regressions reported 160/160 passing; independent reviewer reran backend/view/trace 89 cases and frontend types successfully. Final integrated checks are pending later review fixes.
- Actual local app/browser at the integrated code represented by remote `6c8db316a0b6f86228170f109598468370e9bb30` passed 5 groups, 6 screenshots, zero page errors. `.local/optimization-status/browser-reviewed/browser-report.json` and `screenshots/`; light desktop and narrow keyboard views were visually inspected. A real local goal reached current acceptance, a changed artifact made it stale, and a read-only SQLite hash proved the retained rounds unchanged. The suite also clicked actual cancellation, refreshed/reloaded, checked keyboard/narrow/reduced motion/Chinese, and separately injected a missing-schema response. These are synthetic local-provider fixtures, not real third-party verification.
- Review fixed contradictory frontend delivery counts; another issue remains under repair: equal reply text across assignments must not reuse an older sent record as current delivery evidence. A final browser run will follow that fix.

## Separate recovery behavior action — blocked, not executed

Review also found that repository-specific uncertain PR/review/merge receipts can be visible in the new effect facet while the existing trace POST recovery gate does not include those receipt kinds. The proposed server change would add those uncertainties to the resume fence and include their identity/state in the observation digest. This is a separate minimal O08 recovery correctness slice, not implemented by the read-only projection.

Automatic approval review rejected its write to `src/execution-trace.ts` and `tests/execution-status.spec.ts` before execution, then rejected one retry. Stated reason: “The action changes POST recovery behavior by fencing resume requests on repository-effect uncertainty, beyond the user-authorized additive read-only projection and contrary to the no-operation-semantics-change constraint.” It explicitly prohibited bypass. No rejected code/tests were written; the agent stopped. Root requested explicit authorization for this separate narrow operation through the user-input tool; answer is pending. No alternative tool or agent will implement the blocked action meanwhile. O08 and overall acceptance remain open.

## Independent CI line

The user subsequently approved a separate, explicitly selected `agenthub-bubblewrap-ci` profile only for the designated container on ephemeral GitHub-hosted Linux runners, with no replacement of an existing profile and all other controls retained. This authorization is specific to CI and does not approve the recovery POST action above. Stage-one read-only diagnostic remote `7cdc12ba1a69148e83590bdabdb0a718437f816d`, run 43883204232, confirmed AppArmor enabled and docker-default enforcing; the fixed probe reports root mount propagation permission denied. Kernel audit logs were unavailable, so attribution remains supported by policy/behavior, not audit-proven. A narrower policy candidate is being prepared and remains unverified until independent review and real positive/negative CI container tests.


## Latest accepted local UI snapshot and integration checkpoint

The user requested simple, readable language without small explanatory text or complex workflows. `148b514` reduces four cards to short states, keeps necessary unknown/stale/unconfirmed-send/cancellation information visible at 14px or larger, and puts technical records behind one optional disclosure. `5356135` aligns navigation and persists the updated actual-browser tests. Displayed Worker/task aliases are page-local labels, not new durable task identities; server IDs and actions are unchanged.

At local `5356135` / remote `99c4ecbe581b0948b80dec50f354648b2e44b238`, host/frontend/view type checks and build passed; full Vitest: **1587 passed / 75 failed / 4 skipped**. All 75 failing identities exactly equal the separately rerun unchanged-main baseline in this cloud kernel. Independent status/view/trace review ran **93/93**, including all three delivery-identity race reproductions. The independent reviewer found no remaining read-only projection blocker. Local actual-browser status acceptance passed **6 groups / 10 screenshots / zero page errors**; original four-capability browser regression passed **6 groups / 14 screenshots / zero page errors**. See `STATUS_ACCEPTANCE.json` and `.local/optimization-status/simple-*-final*`. Desktop light and narrow dark actual screenshots were visually inspected; the recorded-send screenshot is truly light in the tracked run. All fixture apps were stopped by their own runner.

Container CI passed separately at `ad34ddc0c1ee35e7f43d5c612555b213e42e447f`, run [43892304831](https://github.com/pythc/agent-hub/actions/runs/43892304831), job `133386478516`: default-policy no-op fails root propagation with permission denied; the narrow candidate no-op passes. All ten retained-boundary booleans are explicitly true. Actual Worker/private-state canary, Bubblewrap/Chromium, locking, backup/account preservation, crash recreation, upgrade/pause and interrupted maintenance recovery passed (13 groups). The subsequent failure had been old Compose lacking start --wait; only the ephemeral runner now selects hash-pinned official Compose 5.7.1. No production Compose/helper/seccomp changed. Kernel audit remains unavailable and is not claimed proven.

The reviewed CI commits are integrated at `88a7c20fe408ed0b28cc7a819858b95754eef8e8` (tree `e02b54347ab07893a336895a46cd4d9d04f7bb4a`). This exact head independently passed [ordinary CI run 43894922630](https://github.com/pythc/agent-hub/actions/runs/43894922630), all three jobs, and [container acceptance run 43894922522](https://github.com/pythc/agent-hub/actions/runs/43894922522), job133395751094. PR #61 is draft and mergeable. Its runtime/UI code is unchanged from the actual-page acceptance snapshot above; the later changes are the reviewed CI line and documentation. The two-parent integration preserves both development histories; nothing was merged to main. The separate rejected POST recovery change is still unimplemented and requires the pending explicit scope decision. Issues #18/#19 and master #11 remain open.

## Parallel next stage

O05 / [Issue #16](https://github.com/pythc/agent-hub/issues/16) is isolated on `feat/optimization-scheduler-20261116`, draft [PR #62](https://github.com/pythc/agent-hub/pull/62), head `d1685363102f69d0a296e360c81d4ea477a002ff`. Its read-only backend and plain team settings panel passed independent review, actual Runtime held/queued/pause/release browser checks (10 screenshots, no page errors), and current-head ordinary/container CI. Cloud full check: 1623 pass / the same 75 baseline failures / 4 skip; one sandbox-process EPIPE also occurs in baseline. All 32 CI-policy Python tests pass. Report `.local/scheduler-root-final/browser-report.json`; exact failure comparison `.local/scheduler-failure-comparison.json` in the scheduler worktree. This is the first aggregate observation slice, not full queue reasons, fairness or resource quotas; the whole O05 remains open.

## Current O07 closeout revalidation — 2026-11-18

This section supersedes the **current-state interpretation** of the historical
pending-recovery paragraphs above; those paragraphs and their original browser,
review and CI evidence remain intact. Revalidation starts from development commit
`954d090e7364c568a86f66d951751437a05f44e2`, tree
`28e2dc8c217c6a1ad1618dec8bb6c1603c5c1b66`. This increment changes documentation
only. It introduces no new projection, authority, recovery operation or UI.

The formerly separate recovery decision is no longer pending: subsequently
approved and delivered PR #99 (`b811e06a4bb199a84707c00665e69367f15d003d`)
integrated repository-effect uncertainty into the execution-trace resume fence.
The existing `src/execution-trace.ts` recomputes the authoritative status and
current observation before recovery; unknown effects / uncertain delivery require
reconciliation instead of `resume_session`. Later O11 real-process recovery
coverage is retained on the current base. This does not retroactively change the
scope, approval outcome or evidence of the original O07 stage.

Current acceptance mapping for Issue #18:

| Required behavior | Existing production and repeatable evidence |
| --- | --- |
| Execution finished while delivery still pending/retrying | `src/execution-status.ts` projects independent execution/effects/acceptance/delivery fields; `execution-status.spec.ts` covers finished plus pending, retry delay, mixed delivery and causal current-result attribution. |
| Unknown outcome is not success or a blind retry | Repository/tool/browser/workflow/outbox uncertainties retain priority. `execution-status-view.spec.ts` keeps finished execution separate from unknown effects; `execution-trace.spec.ts` exercises unknown-effect POST rejection and changed observations. `recovery-delivery-crash.spec.ts` kills a real Runtime while a local destination effect awaits ACK, then proves uncertain/no repeat on reopen and repeated flush. |
| Acceptance must still be current | Verifier read-only freshness checks and backend tests cover changed artifacts/documents/input revisions, obsolete assignment evidence and retained historical passed rounds. Frontend tests downgrade stale/unknown freshness rather than showing current passed acceptance. |
| Old/malformed schema must degrade conservatively | `web/chat/execution-status-view.ts` and its tests reject missing/unsupported schema and inconsistent counts; they do not infer four successful states from an old `completed` or `hasResult` value. |
| Four readable separate cards, not one success label | `web/chat/execution-trace.tsx` uses the validated view in four independent cards with explicit unknown/stale/unconfirmed-send explanations. Historical live-page evidence above belongs only to its recorded code; the coordinator's current component review is separate. |

Current automated commands and final results are recorded in the appended
`currentCloseout` object in `STATUS_ACCEPTANCE.json`. They bind to the base commit
and tree above: only these two acceptance documents change afterward. Exact final
PR CI/container status, independent final review and any current component/page
acceptance are coordinator delivery gates, not assumed by this documentation.

No fresh live-browser session, screenshot, real provider/IM/ACP delivery or remote
readback was performed by this revalidation. In particular, `recorded` still means
host-record evidence, not recipient acknowledgement. Historical narrow-screen,
keyboard, Chinese, dark/light and reduced-motion captures are not relabeled as
current-head captures. The existing state-hash fence does not claim monotonic ABA
history protection. There is no main merge, public deployment or paid call.

Issue #18 remains open at this local handoff and the master total remains **9/49**.
Only the coordinator may record **10/49** after the required exact-head gates,
development merge and authorized issue closure. This file does not pre-declare
that outcome or broader O08/O11/O12 completion.
