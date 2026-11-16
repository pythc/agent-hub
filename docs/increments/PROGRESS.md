# Four capability increments — implementation and acceptance evidence

Branch: `feat/worker-connector-acp-trace-20261116`.
Main baseline rechecked: `cfa1c8e49c978e6b1f8b141764dae7d0bbce1ed7`.
Current cloud checkout: `/workspace/scratch/f110c34c6b30/agent-hub-recovery`.
Frozen implementation tested: local `b749a62266b3ba31dbe9784877da5c7a77a54e04`.

## Current state

| Work line | State | Fresh evidence |
| --- | --- | --- |
| Worker templates | implemented, committed, remotely preserved, locally accepted | 11 new tests; existing Worker regressions included; reviewed install/create/export/reload browser flow; no grants, paused creation |
| Connector management | implemented, committed, remotely preserved, locally accepted | 22 new tests; existing Slack/registry regressions; real Feishu wizard through existing onboarding; disabled initial state, scoped diagnostics, restart/revocation fences |
| ACP outbound | implemented, committed, remotely preserved, locally accepted using synthetic peer | 21 new tests; actual immutable package + ProcessBackend + bubblewrap + fake ACP probe/run/same-session resume/permission denial; managed gate remains closed for standard ACP |
| Execution trace/recovery | implemented, committed, remotely preserved, locally accepted | 22 new tests; durable audit cursor/SQLite restart/visibility/recovery; actual scheduler result, failed refresh, unknown-effect fence and cancellation persistence in browser |
| Integration/acceptance | local evidence recorded; container CI blocked, latest-head acceptance pending | 4 new HTTP tests including slow-body operator revocation; final host/frontend types/build pass; actual browser 6 workflow groups/14 screenshots/zero page errors; same-environment unchanged-main comparison |

## Fresh required checks

- Final implementation `npm run check`: typecheck and chat build pass; Vitest 1516 passed / 75 failed / 4 skipped, 100 files passed / 8 failed, one sandbox-process EPIPE.
- Separate unchanged-main checkout in this same new environment: 1436 passed / the exact same 75 cases failed / 4 skipped, 95 files passed / 8 failed, two sandbox-process errors.
- Exact failing-case set comparison is equal; no new failing cases. Network-isolated bubblewrap operations are refused by this kernel (`NETLINK_ROUTE socket: Operation not permitted`). Isolation/admission requirements were not weakened.
- All 80 newly added tests pass. Final actual-browser run passed after the last source fixes; `.local/recovery/browser-final/browser-report.json`, with 14 actual-page screenshots under its `screenshots/` directory.
- ACP fresh packaged smoke: `.local/acp-recovery-acceptance-20261116/evidence.json`; digest `0bc686e833fe99daa66f691eccd322c9a09506aaeeeb92bd56750b8f32f76d76`.
- Logs: `.local/recovery/final-check.log`, `baseline-check.log`, `failure-comparison.json`, `final-build.log`, `integration-tests-final.log`.

## Local review instance

Started using `node --import tsx examples/capability-increments-acceptance.ts .local/recovery/review-instance`.
Observed URL: `http://127.0.0.1:37169/configure#worker-templates` (within that cloud execution session's loopback namespace).
The ignored private `browser.json` contains a synthetic review login/session. Never publish it. Separate sandboxed commands and the cloud browser do not share this listener; use the same-session browser runner for automated acceptance. The runner stops its own acceptance process; the separately started review instance is retained while its cloud session lives.

## Recovery and publication record

The first cloud filesystem vanished. Its implementation commits were not available on disk or remote, but all four agents retained complete tool-write records. Source was restored from those records into a fresh checkout based on existing remote handoff `0f626fd51a26c30714b1ad0f31636c0785ca20b0`, rather than falsely claiming disk/commit recovery. The initial checkout was backed up to `.local/recovery/remote-handoff.bundle`. Old test results in RECOVERY_HANDOFF.md are historical only; the evidence above is newly executed.

Modules and integration were saved remotely as soon as committed through the connected GitHub Git-data API; CLI push has no installed credentials. Remote branch updates used expected-head leases and preserved prior history. Key local commits: `0f1d388` integration; `44c3ad3` ACP; `7837b45` templates; `5c6297d` connectors; `989a5ac` trace; `67dcf56` integrated fixtures; `c8e265d` revoked-operator apply fence; `64fa8a0` closed-runtime diagnostic fence; `b749a62` plugin-switch draft reset. The corresponding remote checkpoint history contains the complete source. Final publication must verify local/remote tree equality and remote HEAD; no main merge.

## Scope and remaining unverified items

No user Mac, public deployment, main merge, paid model call or real external message was used. IM diagnostics do not establish receiving/sending/target-channel rights. ACP handshakes report authentication unknown, and standard ACP is explicitly ineligible for managed Workers. Real Feishu/Slack/ACP services and credentialed inference remain unverified. Full-suite green status requires an environment supporting the existing network-isolated sandbox; the same 75 cases fail on unchanged main here.

Design, provenance, reproducible tests and migration/rollback: [DESIGN_AND_ACCEPTANCE.md](DESIGN_AND_ACCEPTANCE.md). Machine-readable summary: [ACCEPTANCE.json](ACCEPTANCE.json). Earlier interruption details remain in [RECOVERY_HANDOFF.md](RECOVERY_HANDOFF.md) for historical recovery context.


## CI follow-up and optimization backlog — 2026-11-16

- Unified backlog: [`../optimization/MASTER_TODO.md`](../optimization/MASTER_TODO.md), all 49 suggestions plus the four feature mappings, dependencies and eleven end-to-end acceptance scenarios. Nothing unaccepted is marked complete. Published remotely at `7da952133cf91a70d31c49b6c6a105ab0fbc53eb`.
- Local `bec3d19636cdb76a8b60f80490c6d3c5e9c7699c` initially added bounded/redacted pre-cleanup container diagnostics; independent review found heuristic redaction insufficient, so follow-up replaced raw logs with fixed probe classifications and typed allow-listed state metadata only. Local `57b29ce95c153ab1f0b4de8b94afc301eca5634a` fixes a real cursor-test race and adds a fixed no-op sandbox probe. Corresponding source remote head: `ca6cbcfe699d3d0ec28116da039e5bebef6b752d`.
- At that source head, regular CI run [43876934064](https://github.com/pythc/agent-hub/actions/runs/43876934064) **passed all three jobs**: Ubuntu 22.04/Node 22.19, Ubuntu 22.04/Node 24, GitHub-hosted macOS/Node 24. No user Mac was used. Four focused HTTP tests also passed locally; log `.local/ci-fix/cursor-regression.log`.
- Container acceptance run [43876933980](https://github.com/pythc/agent-hub/actions/runs/43876933980), job `133332311390`, **failed** before listening: bubblewrap reports `Failed to make / slave: Permission denied`. This is an independent Docker/AppArmor startup failure, distinct from the cloud kernel's 75 baseline cases. A production-layout bootstrap mirror passed local init/runtime/HTTP health without bypassing production CI checks; it is not container acceptance.
- A fixed-name opt-in AppArmor policy was proposed, independently reviewed at the design level, and **rejected by automatic approval review before any file was created**. Broad mount/unmount/pivot_root permissions would apply to all container processes. No policy was written, loaded, or installed, and the rejection has not been bypassed. Exact permission scope and required negative tests are recorded in [CONTAINER_CI_BLOCKER.md](CONTAINER_CI_BLOCKER.md). Explicit approval for that security-boundary change is pending; container CI stays blocked.
- Backups: `.local/ci-fix/pre-fix.bundle`, `.local/ci-fix/pre-fix.diff`; feature changes were preserved remotely before the policy proposal. Real IM/ACP authentication, external sends, paid inference, public deployment and main merge remain unperformed.

- Post-CI-fix actual-browser rerun at local `d302e4b6dd3803a16adc4743683e11a2a14b0a56` (remote tree-identical `7c117d3390bd05d34debf494b374af18fb32a8e4`) passed all 6 workflow groups with 14 screenshots and zero page errors. Command: `python3 tests/browser/run-capability-increments.py .local/ci-fix/browser-after-ci-race`. Evidence: `.local/ci-fix/browser-after-ci-race/browser-report.json`, actual pages in `screenshots/`; mobile reduced-motion connector and desktop unknown-effect trace images were also visually inspected. This uses an actual local app and browser with deterministic synthetic services; real IM and real credentialed ACP remain unverified. The runner stopped its own app after checks.

- Independent review found partial-redaction risks in the new diagnostic app/health log printing. Follow-up removes raw app/health/error strings entirely from the new diagnostics and records only a fixed probe classification, exit status and typed allow-listed state metadata. Two synthetic diagnostic-path regressions passed, including quoted secrets, raw health logs and exception contents; Python compilation and diff checks passed. An independent reviewer reran both tests and confirmed the raw-output removal and corrected rollback procedure. No AppArmor change is included.

- Remote diagnostic hardening checkpoint `1880962553105a3eab4633033c88254e34e738ee` was read back successfully. Its container run [43880391480](https://github.com/pythc/agent-hub/actions/runs/43880391480), job `133344411701`, passed both new diagnostic regressions and image build, then failed the real acceptance probe with the fixed classification `root_mount_propagation_permission_denied`. The new output contains only typed state metadata. AppArmor implementation remains uncreated/pending explicit approval. The matching regular CI run [43880391485](https://github.com/pythc/agent-hub/actions/runs/43880391485) was still running when recorded; prior three-job green evidence remains tied to `ca6cbcfe…`, not inherited across head SHAs.

- Optimization master backlog independently checked against all 1,467 original-plan lines: all 49 numbered titles and priorities preserved. Review issues about dependency cycles and real-IM global gating were corrected and independently rechecked; conditional event references were clarified to match the unfrozen shared-contract proposal. `docs/optimization/SHARED_CONTRACT_PROPOSAL.md` preserves the next C1–C9 slices and semantic migration risks; it implements no feature, and no Oxx item has been marked complete.


## O07 independent next stage

O07 / Issue #18 proceeds on `feat/optimization-status-20261116`, draft PR #61, without pausing all work for CI. See [`../optimization/STATUS_STAGE.md`](../optimization/STATUS_STAGE.md) for exact module/review/browser evidence and the separately blocked recovery POST change. No Oxx issue has been closed. Container policy work is isolated in `agent-hub-ci` and limited to the newly user-approved CI-only profile; no production security setting has changed.


## Latest cloud acceptance / parallel work

- O07 source/UI frozen local5356135 / remote99c4ecbe: full check1587pass/75fail/4skip; all75 exact same failure identities as unchanged main. New readable UI actual browser6groups/10screens/0errors; four-capability regression6groups/14screens/0errors. Tests/screens and independent93focused review are documented in STATUS_STAGE/STATUS_ACCEPTANCE. No real IM/ACP claim.
- Container CI original blocker resolved at remotead34ddc0, run43892304831/job133386478516. Explicit10 retained-boundary booleans and all13 original acceptance groups pass. Ordinary CI queued at check time. CI-only changes are now integrated in the O07 checkout and will be published as one checkpoint for a fresh combined-head run. No production security settings changed.
- O05 backend remote8a26ea17 independently reviewed;42author/19independent tests pass. Simple existing-team-page frontend is in progress in agent-hub-scheduler. Issue16 open.
- Rejected repository-unknown POST recovery guard remains unimplemented and pending explicit scope approval; no retry/bypass. All Issues remain open; latest user simple/readable/no-small-print requirement applies to ongoing UI work.
