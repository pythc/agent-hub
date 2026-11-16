# Recovery handoff after cloud environment loss

## Preserve before changing anything

Environment `ccarenv_b64_Y2NhcmVudl82YWJiZjU5NjA2MTg4MTkxOTNiN2U4YzZmNjI4YWI1OA` is explicitly unavailable. Do not assume any late tool call executed. Restore access to the existing checkout if possible, then inspect git status and log before edits, commits, or retries. Worktree: `/workspace/scratch/f110c34c6b30/agent-hub-increments`; local branch `feat/worker-connector-acp-trace-20261116`. Last confirmed local head is connector commit `e9be1d9c1a97f0ae125b15c3524e0743bfe6d2b6`; the trace agent's last edit/test command has an uncertain outcome. Keep all working changes.

## Confirmed local commits

- `fcb44a0`: initial progress before implementation.
- `107b21b`: shared ownership/API/persistence contract.
- `d53fbd2c4aecc42c081ceb193f2ffd794f7c6d00`: immutable Worker templates and UI.
- `52a9093`: ACP outbound adapter/protocol/fixtures/acceptance.
- `936c67796c720c391b4ca1fc9369974a5d862a87`: stable template create retry across revision/reload; scan decoded JSON for recognizable credentials.
- `e9be1d9c1a97f0ae125b15c3524e0743bfe6d2b6`: existing-plugin connector management, layered diagnostics and forms.

These objects are LOCAL ONLY. The initial CLI HTTPS push failed because no CLI credentials were installed. The connected GitHub Git-data API created the remote branch with initial progress commit `7ec4e5a5c53eb0fd34087a4004d3f92c2a84c325`. Remote documentation was subsequently updated after the interruption. Do not falsely report module commits as pushed.

## Files needing inspection and commit

Trace ownership: `src/execution-trace.ts`, `web/chat/execution-trace.tsx`, `web/chat/execution-trace.css`, `tests/execution-trace.spec.ts`, `docs/increments/TRACE.md`. 21 tests and host/frontend tsc passed; a final attempted 22nd observation-digest test/update has unknown result.

Coordinator changes: `src/server.ts`, `src/ui/control-center.js`, `web/chat/main.tsx`, `web/chat/navigation.tsx`, `web/chat/configuration.tsx`, `examples/capability-increments-acceptance.ts`, `tests/capability-increments.spec.ts`, `tests/browser/capability-increments.py`, `docs/increments/DESIGN_AND_ACCEPTANCE.md`, local PROGRESS.md and both READMEs. Check exact status after recovery. The shared contract is already locally committed.

## Known review items still to fix

1. Generic backend-probe UI caches results in `connectionStudio.backendProbes` by backend ID. Show them only when result.revision equals current settings revision AND workspace identity still matches; clear this cache in connectionStudioReset or on workspace switch. Otherwise stale reachability/auth evidence can remain visible. Service endpoint already rechecks operator/revision before and after probe, caps deadline at 20 seconds, and returns only bounded fields.
2. The standalone UI fixture currently uses work.sandboxDriver disabled. Change to bubblewrap for the actual execution-plugin ACP UI probe; ACP manifest network true uses the existing share-net sandbox path, already verified by the ACP module smoke. Keep work.network false and disabled Feishu. The fake model prevents paid inference.
3. Browser runner currently hardcodes /usr/bin/chromium. Make it optionally read CHROMIUM_EXECUTABLE and pass the downloaded official `.local/browsers/chrome-headless-shell-linux64/chrome-headless-shell`. A combined command intended these two changes failed to create its exec process, so they are NOT confirmed applied.
4. Complete actual browser screenshots and failure recovery; current UI script is written but never reached a page. Check its exact accessible labels against the actual page, including install/create/check button labels. Do not count script authoring as UI acceptance.

## Existing host/service contracts

All feature routes are after operator authentication and use operatorBody for mutations. WorkerTemplates(()=>runtime): GET /api/worker-templates; POST preview/install/export/remove/create. ConnectorManagement(()=>runtime): GET /api/connectors; POST validate/plan/probe/control. Plan hands host-only source+credentials directly to existing onboarding.sourcePlan; apply remains existing /api/plugin-market/connection/apply. ExecutionTrace(()=>runtime): GET /api/execution-trace, GET /events, POST /recover. Generic /api/execution-backends/probe accepts plugin backend ID + settings revision and performs read-only protocol probing, never model inference. No managed gate is relaxed.

Trace recovery delegates to existing Runtime.retry/stop and backend history. Content-free SQLite triggers append projections to existing audit, with stable audit seq cursors; records/jobs/outbox remain authoritative. Offline code rollback should call uninstallExecutionTrace(store) to remove observation triggers while keeping evidence/receipts and current task database.

## Evidence already obtained

- `.local/increments/baseline-check.log`: initial required check, 94 files/1435 tests pass, 9 files/76 tests fail, 4 skipped; kernel NETLINK_ROUTE restriction plus one concurrency timeout.
- `.local/increments/native-cli-regression.log`: 4 existing simulated native-Codex tests pass.
- `.local/increments/integration-tests.log`: 3 real-host HTTP integration tests pass. Covers auth/same-origin, recipe install/no grants/paused Worker, existing Feishu onboarding initial disabled, diagnostic layers, explicit Worker activation and deterministic execution, trace cursor refresh, retained Worker/history after recipe removal, unknown-effects/stale-revision recovery fences.
- An integrated npm run typecheck and npm run build:chat passed before the final module fixes. ACP agent later confirmed full host tsc passed. Must rerun all at final integrated HEAD.
- `.local/acp-outbound-final-20261116/evidence.json`: real packaged ProcessBackend + bubblewrap + local synthetic ACP peer; probe available/auth unknown, two turns same session, default permission rejection, reasoning hidden, managed admission rejected.
- ACP final package digest: `0bc686e833fe99daa66f691eccd322c9a09506aaeeeb92bd56750b8f32f76d76`.
- `.local/increments/acceptance-host.log` records the actual app startup at loopback port 35263. Private synthetic credentials are in the ignored browser.json; never publish them.
- Official Chrome for Testing headless shell 157.0.8103.78 downloaded/extracted to ignored `.local/browsers/`; its use has NOT been tested. The default Playwright CDN download failed with a truncated ZIP. CUA cloud browser could not reach this checkout's loopback namespace.

## Resume commands and final publication

Run from the checkout after inspecting any unknown outcomes:

```sh
npm run typecheck
npm run build:chat
npx vitest run tests/worker-templates.spec.ts tests/connector-management.spec.ts tests/acp-outbound.spec.ts tests/execution-trace.spec.ts tests/capability-increments.spec.ts
node --import tsx examples/capability-increments-acceptance.ts .local/increments/recovered-acceptance
CHROMIUM_EXECUTABLE="$PWD/.local/browsers/chrome-headless-shell-linux64/chrome-headless-shell" python3 tests/browser/capability-increments.py .local/increments/recovered-acceptance
node --import tsx examples/acp-outbound-acceptance.ts .local/increments/recovered-acp
npm run check
git diff --check
```

Use a fresh acceptance directory: account setup expects fresh state. Final browser script must cover actual light/dark/narrow/reduced-motion pages, console errors, connector reviewed apply, ACP protocol probe with explicit managed ineligibility, explicit Worker activation/task completion and timeline reload/failed-refresh recovery. Add or seed a deterministic unknown-effect task for its UI recovery state if needed. No real IM/ACP credentials or paid calls.

Commit trace/coordinator work after fixes and verification. If CLI push remains unauthenticated, publish changed Git trees with the authorized GitHub Git-data tools on this independent branch. Verify complete local/remote tree equality and remote HEAD; then bind final test evidence to that tree/commit. Initial remote progress commit has different metadata from local progress commits, so avoid an unsafe force push. Draft PR is authorized after code is reviewable, but never merge main or deploy publicly. Report actual failures/unverified live services and screenshot paths accurately.
