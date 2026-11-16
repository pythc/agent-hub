# Four capability increments — completed implementation and acceptance

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
| Integration/acceptance | complete; full suite retains proven environment failures | 4 new HTTP tests including slow-body operator revocation; final host/frontend types/build pass; actual browser 6 workflow groups/14 screenshots/zero page errors; same-environment unchanged-main comparison |

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
