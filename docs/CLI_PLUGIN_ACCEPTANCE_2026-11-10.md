# Native CLI plugin acceptance — 2026-11-10

Status: implementation and isolated protocol validation complete; real-provider
task acceptance is blocked. These plugins have not been deployed to the running
Roppo instance.

## Evidence levels

| Check | Claude Code 2.1.319 | Gemini CLI 0.67.0 | OpenCode 1.19.5 |
| --- | --- | --- | --- |
| Official distribution installed; version readback | Pass | Pass | Pass |
| Native binary inside the Roppo plugin sandbox | Pass | Pass | Pass |
| Native MCP invokes authorized host tools | Pass | Pass | Pass |
| Database reopened; original native context retained in outgoing request | Pass | Pass | Pass |
| Adapter upgrade and rollback retain per-session package digest | Pass | Pass | Pass |
| Local purge and repeated cleanup | Pass | Pass | Pass |
| Real provider/model task | Not run: login incomplete | Not run: login incomplete | Blocked: provider quota exhausted |
| Real-model repair after host restart | Not run | Not run | Not reached |
| Production Router/office acceptance | Not run | Not run | Not run |

The first six rows use **actual vendor binaries with deterministic local provider
responses**. They are not real model results. Each CLI completed four tool turns
across original/upgraded/rolled-back configurations. Claude and Gemini each issued
eight local provider requests; OpenCode issued ten including title generation.
The last resumed payload contained both the original input and resumed input.
No source changes to the host were needed to load these packages.

## Automated validation

Final validation: typechecks passed; **86 test files and 1300 tests passed**.
The adapter-specific suite accounts for 33 of these tests.

The new adapter suite covers all three packaged drivers through sandboxed IPC:
duplicate MCP receipt reuse, malformed tool arguments, account binding, full-wire
budget rejection, forbidden native tools, opaque provider history rejection,
invalid output and repair, crashes, native ID replacement, upgrade/rollback,
quota classification and lost native acknowledgements after completed effects.

The complete typecheck and test run is recorded in the local task log
`/tmp/roppo-cli-reviewedcheck.log`. Manual native-binary receipts are in
`/tmp/roppo-reviewed-{claude,gemini,opencode}.log`. The reproducible harnesses are
`tests/manual/cli-protocol.ts` and `tests/manual/cli-live.ts`; no credential is
embedded in these scripts or committed to the repository.

## Self-review corrections

- Gemini ignores non-root-owned system settings. Managed settings now use the
  private user profile, with an explicit native policy and empty native tool set.
- Native OpenCode can invoke MCP before printing its session event. Its pinned,
  per-session SQLite database is read to establish the actual session ID before
  forwarding inference or permitting effects.
- CLI working-directory environment and temporary paths are isolated explicitly;
  the task repository is accessed through host tools.
- Full request accounting includes native-generated context; a transcript-only
  estimate is insufficient. Requests exposing other native tools are rejected.
- Lost cleanup acknowledgements are retry-safe. Interrupted tool turns are fenced
  even when the host receipt is complete, because the CLI may not have durably
  consumed that result. No automatic effect reconciliation is claimed.
- Provider HTTP failures are classified immediately. In the real OpenCode
  attempt, the free provider reported `Free usage limit reached`; the native CLI
  originally waited until the host timeout. The reviewed adapter now returns
  `quota_exhausted`, without presenting that as task-quality failure.

## External blockers

Claude and Gemini official OAuth flows were started. The browser-control extension
timed out repeatedly, the fallback browser also timed out, and native window
access did not expose a usable authorization form after navigation. No completed
OAuth credential was found in either dedicated profile. This is a login automation
blocker, not evidence of a vendor account denial.

OpenCode's installed CLI listed the official free models. A real request using
`opencode/glm-5.3-flash-free` reached the provider and was rejected for free usage
limits. The final isolated attempt returned `quota_exhausted`; no artifact
creation/independent acceptance/repair stage completed. No paid plan was purchased.
Anonymous execution remains ineligible for managed roles under the unchanged
host account-identity requirement.

## Built packages

The reviewed immutable packages are under the local workspace directory
`work/roppo-cli-packages-20261110/reviewed`:

| Adapter | Package digest |
| --- | --- |
| Claude Code | `a943b096350df8679bf7c89799a0ddd3d9144444bfc73a530577607803814551` |
| Gemini CLI | `553c54324700bef3c295a9ffc13c5ef1a5b77d3e0fe05300f1fd375474f77e9d` |
| OpenCode | `8ee56d29aa35ed80728d3bd47fb3483e1ded9f336a1989d845643f1988353428` |

For setup and unsupported capabilities, see [the integration guide](NATIVE_CLI_PLUGINS.md).
