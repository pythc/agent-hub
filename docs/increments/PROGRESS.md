# Capability increments — interrupted cloud implementation

Branch: `feat/worker-connector-acp-trace-20261116`
Baseline: latest main verified 2026-11-16: `cfa1c8e49c978e6b1f8b141764dae7d0bbce1ed7`.
Cloud checkout: `/workspace/scratch/f110c34c6b30/agent-hub-increments`.

## Current blocker
The platform marked the selected execution environment unavailable. exec-server disconnected; automatic recovery timed out after 45 seconds. No further commands were started after the unavailable signal. This remote branch contains progress/handoff documentation only: implementation commits and uncommitted files remain in the unavailable cloud checkout and have NOT been published. No draft PR is ready.

## Work lines
| Line | State | Evidence |
| --- | --- | --- |
| Worker templates | implemented locally, committed; final browser acceptance pending | `d53fbd2c4aecc42c081ceb193f2ffd794f7c6d00`, follow-up `936c67796c720c391b4ca1fc9369974a5d862a87`; 11 template tests, 14 template+HTTP tests pass |
| Connector management | implemented locally, committed; final browser acceptance pending | `e9be1d9c1a97f0ae125b15c3524e0743bfe6d2b6`; 19 focused tests, 42 combined connector/Slack/registry tests pass |
| ACP outbound | implemented locally, committed; real service unverified | `52a9093`; 21 focused tests pass; actual ProcessBackend/package/bubblewrap/local ACP peer probe, two-turn resume, permission denial, reasoning filtering and managed rejection pass |
| Execution trace/recovery | implemented locally, uncommitted | Five module files written; 21 tests plus host/frontend tsc confirmed. Final attempted 22nd test/digest update has unknown outcome after environment loss |
| Integration | implemented locally, uncommitted; incomplete acceptance | Authenticated routes, three existing-shell workspaces, generic plugin probe, deterministic acceptance host, HTTP and browser tests, README/design docs; 3 HTTP integration tests passed; one integrated typecheck+build passed before final module refinements |

## Baseline and limits
Initial npm ci installed 382 pinned dependencies. Before integration: npm run check typecheck passed; Vitest 94 files passed/9 failed, 1435 tests passed/76 failed/4 skipped, one unhandled error. Network-isolated bubblewrap operations fail in this kernel with NETLINK_ROUTE Operation not permitted; native CLI timeout passed its independent 4-test rerun. The network-enabled ACP package sandbox path separately passed. No isolation requirements were weakened.

The actual local app started at `http://127.0.0.1:35263`, using a synthetic model, disabled Feishu source and local ACP peer. Environment availability is now lost; this address is not claimed reachable. Browser testing did not reach a rendered page: system Chromium cannot create its Unix singleton socket, cloud-browser localhost is a separate namespace, and the official headless-shell fallback was downloaded just before environment loss. No UI screenshot acceptance is complete and no screenshots are claimed.

## Restrictions retained
Cloud only. No main merge, public deployment, paid calls, real IM messages or real ACP inference. Template requirements do not grant permissions. Existing plugin onboarding and managed admission remain authoritative. Standard ACP is explicitly ineligible for managed Worker use. Unknown external effects are not replayed. Octop was documentation/behavior reference only; no copied code/prompts/tests or translation.

See [RECOVERY_HANDOFF.md](RECOVERY_HANDOFF.md) for exact pending actions and known review issues.
