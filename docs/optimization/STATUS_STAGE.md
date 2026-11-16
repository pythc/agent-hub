# O07 status projection stage

Status: implementing; no O07 completion claim. Branch `feat/optimization-status-20261116` starts at `4d107cbc53fb3b3d50f326a3f447193689881ecb` and leaves PR #10 container changes on their own line.

File ownership: execution_trace implements backend projection/current-evidence read-only chain and focused tests; worker_templates owns trace TSX/CSS; connectors independently reviews; root owns local deployment/browser fixtures, integration and records. ACP work line separately investigates CI in `agent-hub-ci`; one team slot remains free. User-authorized CI-only policy work must not touch this feature stage’s runtime sandbox settings.

The additive four facets distinguish execution, effects, current independent acceptance and host-recorded delivery. Existing task/recovery states stay authoritative. No new effect ledger or automatic retry is introduced. Current acceptance must not trust a historical passed round after evidence/input/permission changes; status inspection must not register binary versions, refresh memory or produce deliveries.

Focused actual-browser command (pending implementation/build/review): `python3 tests/browser/run-execution-status.py .local/<fresh-status-dir>`. It starts the actual app and browser in one cloud namespace. Deterministic model and held/uncertain receipt fixtures are explicitly synthetic. This is not real IM, ACP or container verification. Acceptance includes current-to-stale artifact refresh, cancellation retaining unknown effects, reload, light/dark/narrow/keyboard/reduced-motion/Chinese. The runner stops its own app after checks.

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
