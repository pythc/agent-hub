# Outbound ACP execution adapter

The acp-outbound execution package adds an external ACP v1 Agent through Agent Hub's existing immutable execution plugin mechanism. Native Codex, Router/Worker delegation, source plugins and host task state remain authoritative. There is no inbound ACP server, parallel runner store or second delegation tool.

**Standard ACP cannot currently serve as a managed Worker.** The package declares managed, tools, history and contextBudget false. Existing host admission still requires all five of managed/tools/resume/history/contextBudget, plus a confirmed account identity. ACP session loading alone does not establish host-only tool mediation, authoritative history or accurate budgets. The host rejects managed turns before launching this adapter. Future support must implement and verify those contracts in an execution plugin, not merely change manifest booleans.

The intended task architecture remains Router → Worker → execution backend → ACP adapter → external Agent. This standard adapter stops at the existing managed gate; no complete managed Router-to-ACP-Worker execution is claimed. The separately testable path is BackendRegistry → ProcessBackend → immutable package → existing OS sandbox → external synthetic ACP subprocess.

## Behavior and boundaries

Protocol version is fixed at 1, adapter version 0.1.0, state version 1. See [the protocol pin](../../plugins/backend-acp/PROTOCOL.md). No ACP SDK or additional dependency is added. Initialization, explicit agent-type authentication, new/load session, public text updates, scoped permissions, cancellation and advertised close are implemented. Resume keeps the exact native ID; missing loadSession support, changed workspace/endpoint/credential fingerprint or closed/uncertain state fail explicitly. No native history, purge, model override, host tool forwarding, image, steering, prompt refresh or context-budget capability is advertised.

Probe performs initialization only, never login, session creation or inference. Success reports available true, authenticated unknown, remoteVerified false and a fixed adapter/protocol version. Agent-authentication methods must be explicitly configured and advertised as agent-type; terminal/URL/browser authentication and agent-provided launch environments are never executed. Even successful authenticate does not prove the managed account identity. Raw peer metadata, stderr and error text never enter public diagnostics.

Permission without a callback selects reject_once or returns cancellation. A human callback can select only a once option and must echo the exact session ID, live turn ID, generated request ID and expiry. Duplicate/ambiguous option IDs, cross-session/turn responses, expired/late responses and cancellation fail closed; allow_always is never selectable. Titles, raw arguments/results and reasoning are excluded. A caller must independently review the operation before explicitly approving a live request. Standard ACP Agents execute their own tools; these callbacks do not prove native tool isolation, another reason managed use stays blocked.

The command must be absolute and receives an argument array without a shell. No process.env spread is used. Only host-owned scratch HOME/PATH/TMPDIR plus explicitly selected, manifest-declared ACP_TOKEN, ACP_API_KEY, HTTP_PROXY, HTTPS_PROXY and NO_PROXY references reach the peer. Existing backend env authorization and filesystem grants still apply. Unrelated credentials and runtime injection variables are excluded. Dedicated CLI distributions/profiles must be reviewed separately from the adapter digest.

The adapter journal lives inside the existing backend dataDirectory and contains IDs, lifecycle and endpoint fingerprint, never prompts, answers, tools or thoughts. It does not import the host Store or create a competing jobs/audit/outbox authority. Hash-named files, no-follow bounded reads, exclusive session locks and collision-safe creation protect identities. Before sending a prompt, atomic file and directory fsync persist prompt_pending. Only a confirmed outcome clears the fence. Crash, timeout, transport failure or unconfirmed cancellation after submission becomes outcome_unknown; process recreation refuses pending/uncertain sessions before launching or replaying anything. Never delete a lock or journal to force retry. The operator must first inspect the actual external outcome through existing recovery procedures; no automatic fence-clearing API is provided.

Cancellation sends session/cancel, cancels outstanding approval and waits for a cancelled response. A deadline or normal answer after cancellation remains uncertain. Confirmed completion can release the live session via advertised session/close. Explicit close is locally idempotent, blocks resume and reports previousEffects:not_reverted. It neither undoes effects nor deletes history.

## Package and validate

```sh
node --import tsx src/cli.ts backend-plugins pack \
  plugins/backend-acp/index.ts plugins/backend-acp/manifest.json /absolute/new-acp-package
node --import tsx src/cli.ts backend-plugins inspect /absolute/new-acp-package
npx vitest run tests/acp-outbound.spec.ts
node --import tsx examples/acp-outbound-acceptance.ts .local/acp-new-acceptance
```

Use a fresh acceptance directory. The original deterministic peer is [fixtures/agent.mjs](../../plugins/backend-acp/fixtures/agent.mjs); args are its absolute private state directory and optional normal/permission/wait/crash mode. The actual packaged acceptance probes, runs two original-session turns across Store reopening, verifies default permission rejection and hidden thoughts, and asserts managed admission still rejects. It writes private config.json and evidence.json, with no model, credential, paid call or external message.

The package declares network true for real Agent connectivity. On the prior cloud host, network-isolated bubblewrap failed NETLINK_ROUTE policy while the existing network-enabled --share-net path worked; restored acceptance must recheck current behavior. No unrestricted fallback is allowed. Node's --import tsx loader avoids the CLI's restricted Unix IPC listener.

Configuration fragment (merge into a complete config and keep it unassigned to managed roles):

```json
{
  "backendPlugins":[{"directory":"/absolute/new-acp-package","digest":"REVIEWED_SHA256"}],
  "backends":{"external-acp":{
    "kind":"plugin","plugin":"acp-outbound",
    "config":{"command":"/absolute/agent-cli","args":["acp"],"environment":[]},
    "env":{},"readPaths":["/absolute/reviewed-cli-directory"],
    "writePaths":["/absolute/dedicated-cli-profile"]
  }},
  "work":{"sandboxDriver":"bubblewrap"}
}
```

## Migration, rollback and provenance

This additive plugin changes no host DB schema or existing settings. Existing native Codex sessions remain compatible. Journal format mismatches and identity changes require explicit handling, never silent reinterpretation. Use existing backend staging/probe, drain tasks and reconcile unknown effects before activation. Host session pinning retains the creation digest. Rollback stages the previous code digest against the latest config and current DB, retaining old package objects, native profiles and journals. Never restore an old task DB or remove packages needed by existing mappings.

The pinned [Octop ACP documentation at bf134db](https://github.com/TencentCloud/Octop/blob/bf134dbd379036ce7545c7df1a1da7e381ece9ff/docs/acp.md) informed the documented setup/probe, continuation, permission and close experience. No Octop implementation, prompts, fixtures, tests or translated code were used. Agent Hub's existing execution package, conservative managed gate, explicit install/auth, live one-request permissions and durable unknown-outcome fences are independent design choices. The official ACP v1 specification determines wire behavior.

## Workspace recovery provenance

The old cloud checkout and original commit object 52a9093 were lost. Implementation files were restored from this agent's retained tool-call arguments and final recorded patches: strict launch validation, empty-parameter compatibility, duplicate permission IDs, ID collisions, durable directory fsync, cancellation uncertainty and original-session identity fences. Comments were shortened; byte-identical commit reproduction is not asserted. The deterministic peer and acceptance command were restored from the same tool records. This documentation was reconstructed and condensed from its recorded prose. Focused tests are restored from recorded test definitions, then rerun in the new checkout; historical 21-test results and prior artifact digest are not fresh evidence.

Real external Agent distributions/accounts, paid inference, native tools, real effects, managed Worker execution, authoritative history, context budgets, inbound ACP and Windows transport remain unverified. No fixture or screenshot establishes those claims.

### Fresh recovery verification

The new checkout `/workspace/scratch/f110c34c6b30/agent-hub-recovery` restored implementation commit `44c3ad3` and test commit `fe6733d`. Fresh execution of `node node_modules/vitest/vitest.mjs run tests/acp-outbound.spec.ts` passed **21/21 tests** on 2026-11-16. This includes a real immutable-package/ProcessBackend/bubblewrap/synthetic-peer chain; no real provider was contacted.

A separately rerun `node --import tsx examples/acp-outbound-acceptance.ts .local/acp-recovery-acceptance-20261116` exited zero. New evidence is `.local/acp-recovery-acceptance-20261116/evidence.json`. Probe reports available true, authentication unknown and remoteVerified false; two turns retain the same host/native session across reopening Store; permission defaults to rejection; internal thoughts are hidden; managed admission remains unsupported. The newly built package digest is `0bc686e833fe99daa66f691eccd322c9a09506aaeeeb92bd56750b8f32f76d76`, matching the previously recorded final artifact digest. The fresh build therefore recovers the same normalized manifest and bundled runtime artifact even though source comments and documentation were reconstructed. Historical tests were not substituted for this rerun.
