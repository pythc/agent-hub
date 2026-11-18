# Four capability increments: design, acceptance and rollback

The implementation was recovered from retained original tool-write records after the first cloud filesystem disappeared. It was rebuilt and tested in `/workspace/scratch/f110c34c6b30/agent-hub-recovery`; earlier results in RECOVERY_HANDOFF.md are historical. Main was rechecked at `cfa1c8e49c978e6b1f8b141764dae7d0bbce1ed7`. The existing remote branch/history was preserved.

## Architecture and product behavior

| Capability | Behavior | Existing authority retained |
| --- | --- | --- |
| Worker templates | Immutable ID/version/digest JSON recipes, preview/install/export/remove and paused Worker creation | WorkerManager and current settings; separate library revision; stable receipts; no scripts, files, credentials, memories or automatic grants |
| Connectors | Plugin-defined setup help, reviewed existing onboarding and separate diagnostic layers | SourceRegistry, installed source plugins and existing MCP connections; new instances disabled; revision/config/attempt fences |
| ACP outbound | Fixed ACP v1 stdio execution adapter with initialize/probe, authentication status, native session mapping, prompt/update, scoped permission, cancel/close and unknown-effect fencing | Immutable Execution Backend package/process path; native Codex unchanged; managed/tools/resume/history/contextBudget gate unchanged |
| Trace/recovery | Content-free durable audit projection and cursor catch-up, evidence and current-state recovery | Existing records/jobs/audit/outbox and Runtime/Engine; no competing execution state; unknown effects cannot be replayed and cancellation cannot revive work |

Templates are recipes rather than instances. Their declared tools/capabilities are requirements, not permissions. Strict bounded JSON-only import rejects archive/file/link/script shapes, duplicate fields, nesting bombs and recognizable credentials; it has no extraction or path-writing interface. Same ID/version cannot identify different content. Installing another version or removing a recipe never rewrites existing Workers or task history. Creation is paused with empty tool/MCP grants and records immutable origin/acceptance metadata. Ambiguous creation retains its original request and can complete after reload.

IM setup extends optional metadata in the current source-plugin manifest/registry. Feishu is bundled; Slack setup appears when its plugin is installed. More platforms enter through the plugin extension point, never a parallel connector runtime. Configuration, service reachability, verified identity and selected member-directory reads have separate timed evidence. Receiving, reading, sending and target-channel permissions remain explicitly unverified without a separately authorized real invocation. There is no message-sending diagnostic. Revocation blocks new calls; it does not claim to undo old external effects. Evidence is fenced across changed revisions, newer probes, timeouts and closed-runtime rebuilds. Secrets/provider responses/stderr never enter diagnostic UI or safe error codes.

Standard ACP v1 does not prove host-only tools, authoritative history or context-budget enforcement. The adapter reports these capabilities false and is visibly ineligible for managed Workers. An initialization handshake is not authentication or successful inference. Only explicit environment names are passed. Permission decisions bind session/turn/request/expiry and default to deny; arbitrary file/terminal callbacks are rejected. Unknown prompts/effects are durably fenced and not retried into a new session. The protocol/SDK/license decision is documented in ACP.md and PROTOCOL.md; no official SDK dependency is added.

Trace hooks append whitelisted state metadata to the existing audit ledger atomically with authoritative mutations. Audit seq is the stable cursor; initial snapshots are labeled as such. Cleanup visibility changes invalidate mounted UI caches. Recovery delegates to existing history/retry/stop, checks current task/effect digest, authorization, settings revision and receipts, and preserves the original session. Commit, test and deployment evidence remain distinct; a completed tool call or returned result does not establish acceptance or deployment. Raw prompts, results, tool parameters, internal reasoning and provider exceptions are not projected.

The shared shell/theme remains in use. New pages have semantic controls, keyboard focus, responsive layouts, restrained state motion and reduced-motion support. Generic backend probe UI caches are valid only for the current settings revision and workspace. Reused onboarding apply now rechecks the operator after reading the request body; a regression verifies revocation during a slow upload prevents activation.

## References and originality

Octop was a documentation/behavior reference at immutable baseline `bf134dbd379036ce7545c7df1a1da7e381ece9ff`:

- [ACP](https://github.com/TencentCloud/Octop/blob/bf134dbd379036ce7545c7df1a1da7e381ece9ff/docs/acp.md): initialization/permission workflow context. This implementation uses Agent Hub's existing execution plugin and stricter admission.
- [Connectors](https://github.com/TencentCloud/Octop/blob/bf134dbd379036ce7545c7df1a1da7e381ece9ff/docs/connectors.md): metadata-driven field guidance. This implementation extends the existing registry/onboarding.
- [Plugin channels](https://github.com/TencentCloud/Octop/blob/bf134dbd379036ce7545c7df1a1da7e381ece9ff/docs/plugin-channels.md): plugin-owned channel forms and retained configuration. Evidence here is separately revision-bound.
- [Delegation](https://github.com/TencentCloud/Octop/blob/bf134dbd379036ce7545c7df1a1da7e381ece9ff/docs/agent-delegation.md): background handoff/recovery context. This implementation retains Agent Hub's durable ledger.

No Octop implementation, prompt, test or translated implementation was incorporated. Templates, adapter, fixtures, tests and UI are original Apache-2.0 contributions. External Octop runners were not executed as part of this acceptance.

## Fresh verification

At frozen implementation commit `b749a62266b3ba31dbe9784877da5c7a77a54e04`, host/frontend typecheck and chat build pass. The complete required `npm run check` ran: **1516 passed, 75 failed, 4 skipped** (1595 tests; 100 files passed/8 failed), plus one sandbox-process EPIPE. A separate detached unchanged-main checkout in this same new environment ran the same check: **1436 passed, the exact same 75 cases failed, 4 skipped** (1515 tests; 95 files passed/8 failed), with two process errors. The failing case sets are exactly equal; there are no additional failing cases. Network-isolated bubblewrap is rejected by this kernel with `NETLINK_ROUTE socket: Operation not permitted`. Requirements were not weakened to hide these failures. Logs and machine comparison are under ignored `.local/recovery/`.

All 80 new tests pass: templates 11, connector management 22, ACP 21, trace/recovery 22, HTTP integration 4. The HTTP tests include same-origin/operator checks, paused/no-grant creation, existing IM onboarding, explicit Worker activation and actual deterministic execution, retained trace after recipe deletion, unknown-effect/stale-revision recovery, and the slow-body operator-revocation regression.

The ACP acceptance exercises actual `ProcessBackend → immutable package → bubblewrap → local synthetic ACP peer`, initialization/auth-unknown, two turns on the same host/native session, default permission rejection, reasoning filtering and unchanged managed rejection. Fresh report: `.local/acp-recovery-acceptance-20261116/evidence.json`. Package digest: `0bc686e833fe99daa66f691eccd322c9a09506aaeeeb92bd56750b8f32f76d76`.

The final actual-browser run passed all six workflow groups with zero page errors and 14 screenshots: `.local/recovery/browser-final/browser-report.json` and `screenshots/`. It covers reviewed recipe install/create/export/reload; Feishu help/local check/reviewed existing apply/disabled initial state; actual sandboxed ACP protocol probe with auth unknown/managed unavailable; explicit Worker activation and scheduler execution; separate commit/test/deployment evidence; reload and failed-refresh recovery; actual typed unknown-effect failure and cancel persistence; light/dark/narrow/reduced-motion, Escape/focus restoration and Chinese translation. Screenshots are actual rendered pages, not concepts. The model and ACP peer are deterministic fixtures; IM instances are disabled. This is not real-service, real-authentication, paid inference or live message-delivery acceptance.

## Reproduce in the cloud

```sh
npm ci
npm run typecheck
npm run build:chat
python3 tests/browser/run-capability-increments.py .local/my-browser-acceptance
node --import tsx examples/acp-outbound-acceptance.ts .local/my-acp-acceptance
npm run check
git diff --check
```

Install Python Playwright and Chromium first; `CHROMIUM_EXECUTABLE` selects a suitable browser. In this environment the official Chrome for Testing headless shell is under ignored `.local/browsers/`; system Chromium cannot create its Unix singleton socket. The browser runner starts app and browser in the same cloud-local execution namespace, propagates test failure, and stops its own fixture after evidence capture. Separate sandboxed command calls do not share loopback listeners. To keep a fresh review instance running:

```sh
node --import tsx examples/capability-increments-acceptance.ts .local/my-review-instance
```

The process prints its loopback URL. Its ignored private browser.json holds a synthetic login session; never publish it. Use a new state directory for each acceptance run. No Mac, public deployment, main merge, paid call or real external message is required or performed.

## Migration and rollback

Changes are additive and module state uses namespaced existing records. Optional source setup fields preserve old manifest validity. Template versions never migrate existing Workers. ACP is an explicit immutable execution package and cannot silently replace native Codex or bound session identities. Trace triggers observe state only.

Drain work, reconcile unknown effects and make the normal private-state backup before downgrade. Keep execution packages required by historical sessions. Stop the instance and call `uninstallExecutionTrace(store)` from the current checkout to remove only `execution_trace_v1_*` observation hooks; retain audit evidence, receipts and the current task database. Do not restore an older task database to roll back code. Each module document records interrupted operations and rollback details: [templates](WORKER_TEMPLATES.md), [connectors](CONNECTORS.md), [ACP](ACP.md), [trace](TRACE.md).
