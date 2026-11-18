# Connector management and diagnostic evidence

## Behavior and design

`#connectors` is a management view over the existing `SourceRegistry`, source settings, installed source-plugin manifests and MCP/tool connections. It does not register a second connection system. An installed plugin's static definition supplies setup fields; each existing source ID remains the user instance; `connector-diagnostic` records hold only diagnostic evidence. Missing/uninstalled platforms are not advertised as connected.

The built-in Feishu source supplies a setup descriptor. Installed Slack and Feishu packages supply the same descriptor in `manifest.setup`. The three-step form selects a registered app, collects actor IDs, explicit chat/channel IDs and credentials, then reviews a local validation plan. The server passes a host-only `{revision, source, credentials}` result directly to `Onboarding.sourcePlan`. Applying uses the existing `/api/plugin-market/connection/apply` path, private credential persistence, revision validation and controlled restart. New instances start **disabled**. Setup never grants Worker tools or starts a model, signs into a service, or sends a message. Existing configuration remains editable through established entry/settings screens.

Credential values are write-only form state and onboarding input. Environment-reference mode accepts a variable name instead. Snapshot responses expose only reference availability booleans, not environment names or values, raw source configuration, adapter identities, provider responses or exception strings. Probe exceptions become fixed codes. The diagnostic code does not log provider output. Existing plugin-process stderr remains discarded by the existing host; unrelated legacy runtime logging is unchanged.

The field extension uses optional `path`, `help`, `placeholder`, `input` (`text`/`tags`) and `setup.serviceUrl`. Old manifests remain accepted. Legacy field names retain camel-case path inference beneath the declared source options subtree. Setup can write a plugin-specific subtree only; host identity, actor policy, capabilities, workspace, sandbox and enabled-state fields are protected. Unsafe metadata is not offered as a setup form. New platform plugins extend this contract without adding a core platform switch.

## Diagnostic layers

| Layer | What it establishes | What it does not establish |
| --- | --- | --- |
| Configuration | Source schema plus plugin-specific validation | Service reachability, credentials, messaging |
| Reachability | HTTP HEAD response from the plugin's declared service URL, without a credential | Authentication or platform permission |
| Authentication | Existing source `identity()` returns `verified: true` | Receive/read/send or target-channel permission |
| Capabilities | Existing `members(scope)` succeeds for each current explicit scope, with at most 20 scopes | Message history, inbound events, posting or delivery rights |
| Real invocation | Not performed by this page | No live success is implied |

The capability row is named **Member directory read**. A separate row keeps message read, receive, send and target-channel rights unverified. Existing MCP connections are listed with current grants and a link to their management screen; listing does not invoke tools. Diagnostic records include `evidenceMode` (`configured-adapter` or `fixture`). Adapter evidence is limited to the configured implementation's response. Deterministic fixtures are labeled simulated; neither type proves a real message was delivered.

Every check has a source ID, request ID, settings revision, private source configuration fingerprint, start/end time and exact layer. The latest-attempt pointer and revision/fingerprint checks prevent older probes from replacing newer evidence. Changing unrelated settings also invalidates old evidence conservatively. Stale results remain visibly stale. Calls check current authorization before starting and between bounded directory reads. Disabling a connection updates existing source settings, aborts pending diagnostics and blocks new remote diagnostic calls. It does not claim to undo an existing external effect. Unknown sending outcomes require destination reconciliation before retry.

Read-only probes have a 20-second deadline and at most 16 concurrent requests. Late replies after timeout cannot become passed evidence. Request IDs deduplicate retries; reuse with different content fails. Persisted running probes display as interrupted after service reconstruction and are never automatically replayed. The operator can explicitly issue a new read-only check. No sending test endpoint exists.

## Host API contract

All routes belong behind existing operator authentication and same-origin controls. Mutations must read bounded JSON and recheck current operator authorization after the body is consumed.

- `GET /api/connectors` → `snapshot()`.
- `POST /api/connectors/validate` → `validate(body)`. Draft body: `{revision, kind, label, actors, fields, credentials, credentialMode}`; `fields`/`credentials` use setup field names; mode is `value` or `environment`. Only local validity is returned.
- `POST /api/connectors/plan` → `const p=plan(body); onboarding.sourcePlan(p.revision,p.source,p.credentials)`. Never send `p` itself to the browser.
- Existing `POST /api/plugin-market/connection/apply` applies the reviewed plan.
- `POST /api/connectors/probe` → `probe({sourceId,revision,level,requestId})`, with level `configuration`, `reachable`, `authentication` or `capabilities` and UUID requestId.
- `POST /api/connectors/control` → `control({sourceId,revision,enabled,requestId})`. This cannot disable the local operator or delegation source.

`ConnectorError` exposes only safe `code` and `status`. Return those fields, never original provider exceptions. `ConnectorManagement` receives a runtime getter so controlled restarts cannot retain a closed instance as authority.

## Persistence, migration and rollback

No database schema upgrade is needed. New evidence uses existing `records` kinds `connector-diagnostic`, `connector-diagnostic-head` and `connector-control`; operator controls also enter the existing audit stream. Settings and onboarding remain authoritative. Older builds ignore evidence records. UI returns at most 100 recent diagnostic records, while source layer pointers retain the latest per-layer result.

Optional manifest additions preserve old schema acceptance. Newly built package digests change because metadata changed; installed objects are immutable and never silently upgraded. Rebuild/install/activate updated packages with the existing reviewed plugin flow. For an older build whose strict manifest parser does not recognize new setup metadata, restore the prior package digest/version through that flow while the host is quiescent. Do not edit installed objects or roll back task/effect records. Existing source instances, actor policy, history and uncertain effects remain intact. Removing this view needs no deletion of connector evidence.

## References and originality

Read Octop documentation at baseline `bf134dbd379036ce7545c7df1a1da7e381ece9ff`:

- [Third-party channel behavior](https://github.com/TencentCloud/Octop/blob/bf134dbd379036ce7545c7df1a1da7e381ece9ff/docs/plugin-channels.md): plugin field schemas, registration conflicts, refresh behavior and preserving unavailable plugin records.
- [Connector catalog](https://github.com/TencentCloud/Octop/blob/bf134dbd379036ce7545c7df1a1da7e381ece9ff/docs/connectors.md): field help and distinct transport/auth metadata.
- [Configuration](https://github.com/TencentCloud/Octop/blob/bf134dbd379036ce7545c7df1a1da7e381ece9ff/docs/configuration.md): secret storage and environment lifecycle considerations.

These are documentation and described-behavior references, not evidence that Octop was deployed or its live services exercised. No Octop source, prompts, tests or translated implementation was copied. This original implementation uses Roppo's source registry, private onboarding, immutable plugin objects, settings revision and uncertainty fences. Timestamped independent diagnostic layers do not conflate directory permission with message delivery. No new dependency or SDK is used by this module.

## Recovery and verification

This module was restored into `agent-hub-recovery` from preserved write-command history after the earlier cloud workspace became unavailable. Service/metadata behavior follows the historical implementation; focused tests were reconstructed from the same tool history. Historical test results are not counted as new-environment verification.

Focused tests use deterministic adapters, a fake HEAD transport, a quiet model that rejects calls and private temporary SQLite stores. They cover plugin discovery; disabled onboarding recipes; secret non-disclosure; invalid and protected fields; builtin Feishu chat validation; separate reachability/auth/directory evidence; request deduplication; concurrent/latest-probe and revision fences; revoke-between-scopes; timeout/late responses; interrupted restart; and old manifest compatibility.

```sh
npx tsc --noEmit
npm run typecheck:chat
npx vitest run tests/connector-management.spec.ts tests/slack-plugin.spec.ts tests/source-plugins.spec.ts
```

New-environment checks and cloud-local screenshots are recorded by the integration coordinator after actual execution. No production credentials, paid calls, live Feishu/Slack messages or real external messaging tests are authorized. The earlier cloud's Bubblewrap `NETLINK_ROUTE socket: Operation not permitted` result is historical only; this recovery does not assume the same restriction or bypass isolation.

Fresh recovery checks completed successfully in `/workspace/scratch/f110c34c6b30/agent-hub-recovery`: host `npx tsc --noEmit`, `npm run typecheck:chat`, `git diff --check`, and the three-file Vitest command above (42 tests passed, including 19 connector-management tests). These results were executed in the recovery environment; they do not stand in for integrated UI screenshots or real IM acceptance.

Controlled-restart review also covers the interval after the old runtime closes and before the server swaps its runtime getter. Late replies and timeout callbacks return stale/interrupted evidence without reading a closed SQLite handle or raising an uncaught timer exception. Failure to persist diagnostic metadata cannot be reported as passed evidence. No task, grant or external-effect state is changed by this fallback.

The post-integration restart review added three focused regressions. The fresh connector-management run now passes 22 tests, including actual closure of the old Runtime/store before both a late adapter reply and a timeout callback, plus metadata-write failure. Host and chat typechecks and diff-check passed after this fix.

## Diagnostic evidence basis (O14/O18 partial)

Current checks now bind the selected source configuration, loaded adapter/declared package identity, diagnostic service/Runtime lifetime and, for authentication/member-directory checks, explicitly declared credential environment material. Credential comparison uses a random service-lifetime HMAC key. Values and comparison digests are never returned, logged, placed in task text or exposed in the public diagnostic history. Only declared credential references are inspected; no arbitrary environment scan, package reload or network request occurs on GET. GET does not update diagnostic records.

Rotating or deleting material behind the same environment reference invalidates authentication/directory evidence. Local configuration evidence additionally binds declared credential presence, so deletion invalidates an earlier configuration pass while replacing one present value with another does not. Credential-independent reachability evidence remains separate. Unrelated connections retain their evidence. Missing material, changed material, changed adapter and old service-lifetime evidence have fixed safe explanations. Historical checks remain historical, not current proof. Reusing an old request ID returns stale/unknown evidence rather than an obsolete pass, and never silently repeats the external check. An in-flight result rechecks the basis before publication.

A warm `ProcessSource` retains the environment supplied at process launch. It now keeps an instance-private keyed comparison of exactly that declared launch material and exposes only a read-only current/not-current check to diagnostics. If current host references no longer match the running process, even a new diagnostic request is refused with `adapter_restart_required`; the user must use the existing controlled configuration/reload flow. This page never restarts an adapter. A cold process may launch normally; after invocation both its launch basis and host evidence must still match. Ordinary source execution and its permissions are unchanged.

Native REST Feishu uses its existing credential-keyed token/identity refresh. Native adapters without a demonstrated refresh contract, and Feishu CLI profiles whose material is outside declared environment references, remain `credential_basis_unavailable`; a successful cached identity is not accepted as proof of new credential material. Test-only fixture evidence is explicitly marked `fixture` and is not real-platform evidence.

The existing explicit per-layer buttons remain the way to recheck supported adapters. No automatic probe, enable, send, secret edit or grant is introduced. These checks do not detect remote revocation without a new authorized provider check, monitor changes that occur and fully revert between observations, validate undeclared credential sources, or complete O14/O18. Tests cover local material changes, unrelated-source isolation, stale request replay, in-flight rotation, old lifecycle records, warm-process retained identities and UI recovery explanations; they are not real IM acceptance.

REST Feishu's token cache also fences asynchronous writeback: a token response for an earlier credential key cannot replace the newer key's token, and an earlier API failure cannot expire that token or clear the newer identity cache. Deterministic fake-fetch A/B response barriers cover both cases without a real Feishu call. This is credential-generation correctness, not expanded retries or permissions.

### Managed disabled connection repair

The connection page can repair an existing **managed, disabled** instance without creating a new source ID. Eligibility requires an existing managed overlay entry matching the current deployment, an onboarding deployment receipt for that ID, and writable declared setup fields. Startup-owned/unmanaged sources and enabled sources remain unsupported; the existing startup/managed deployment conflict check is not relaxed.

Repair reads return declared non-credential form fields and credential-availability booleans, never stored values or existing environment references. Empty credential fields retain the current reference. A replacement value gets a new random managed environment name, leaving old/shared credentials intact; an explicit environment reference is not overwritten. Only declared plugin setup paths are editable. Source identity, actors/bots, admission, listen scopes, workspace, sandbox, capabilities and tool grants are retained; the source remains disabled. No check, model request, adapter probe, enable or external send is performed.

The reviewed plan uses the existing private onboarding plan store, expiry, revision, managed-file journal, deployment receipt and controlled host rebuild. Applying rechecks the captured host, registry/declaration, revision, source and disabled state after waiting for quiescence, and replaces the same source in the overlay. Retrying an already committed plan returns its receipt. An uncommitted plan is no longer valid after a host replacement, including rollback rebuild: review a fresh plan instead. Older diagnostic evidence becomes stale; repair does not imply successful account or platform verification.

Rebuild failure restores prior settings, files, new environment additions and pause state when possible. File/database recovery failure is reported as `setup_recovery_required`, not as successful rollback, and the HTTP host blocks further ordinary work. No old credential is automatically deleted. Tests cover fresh reopening from the original startup configuration plus managed overlay, authority preservation, stale plan/definition/host fencing, rollback, interrupted requests and UI binding cancellation. Real service and browser visual acceptance remain separate.

Ownership is additionally fenced by immutable host-only startup source IDs captured **before** managed overlays load. Controlled rebuilds explicitly carry that provenance forward, rather than misclassifying the merged effective configuration as startup input. A source with the same ID in the original startup configuration is not repairable here even when its deployment currently matches the overlay. All supported apply aliases recheck the applying operator after the request body and again after quiescence; logout remains available during that wait with the same authentication/origin restrictions.
