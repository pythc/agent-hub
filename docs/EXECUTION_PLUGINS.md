# Execution backend plugins

Office/source plugins receive messages and expose office tools. Execution plugins run a model CLI. They share immutable package tooling, but have separate manifests, protocols and privileges. A source plugin cannot become an executor by adding a tool.

Existing `kind: "codex"` definitions and native session IDs remain compatible. The Codex implementation lives in `plugins/backend-codex/model.ts`; `src/codex.ts` is a compatibility export. The new `kind: "plugin"` path runs a packaged adapter in a separate OS-sandboxed process. It does not require a provider switch in core code.

## Author an adapter

Export a default object implementing `BackendPlugin` from `plugins/backend-sdk.ts`. `create(config, {dataDirectory})` returns a `Model` plus `probe()`. Bundle all dependencies; Node builtins are available. Do not import the host store, open the task database, or depend on the repository at runtime. The adapter's durable files belong in `dataDirectory`.

Required files in a built package are `manifest.json` and `plugin.mjs`. The manifest declares:

- `apiVersion: 1`, `type: "execution-backend"`, an ID, semver and `stateVersion`.
- JSON schemas for adapter configuration and provider parameters.
- Explicit capabilities, network access and permitted credential environment names.
- A SHA-256 of the bundle. The host pins a digest covering the normalized manifest and code hash.

Build and inspect a package without importing adapter code into the host:

```sh
npx tsx src/cli.ts backend-plugins pack plugins/backend-codex/index.ts plugins/backend-codex/manifest.json /absolute/new-package
npx tsx src/cli.ts backend-plugins inspect /absolute/new-package
```

Review code and permissions before trusting the digest. Hashes detect substitution; they do not establish publisher trust. There is no public registry, publisher-signature verification or automatic update service yet.

Configure an ID distinct from reserved `codex`:

```json
{
  "backendPlugins": [{"directory": "/absolute/new-package", "digest": "REVIEWED_SHA256"}],
  "backends": {
    "codex-plugin": {
      "kind": "plugin",
      "plugin": "codex-cli",
      "config": {"command": "/absolute/codex", "args": ["-c", "project_doc_max_bytes=0"]},
      "env": {"CODEX_HOME": "AGENTHUB_CODEX_PROFILE"},
      "readPaths": ["/absolute/cli-directory", "/absolute/dedicated-codex-profile"],
      "writePaths": ["/absolute/dedicated-codex-profile"]
    }
  },
  "execution": {"backend": "codex-plugin"},
  "work": {"sandboxDriver": "seatbelt"}
}
```

This fragment must be merged into a full AgentHub config with sources. Use `bubblewrap` on Linux. A disabled or unavailable sandbox fails closed. CLI executable/dependency paths must be explicitly readable. Network proxies, when required, must also be explicit environment references declared by the manifest. No ambient credentials are inherited; `HOME` is scratch space. Prefer a dedicated CLI profile with only the intended account and no unrelated integrations. Never commit credentials.

The macOS Codex reference configuration above disables Codex's automatic parent-directory AGENTS discovery: its nested filesystem sandbox helper cannot run inside Seatbelt. AgentHub supplies the managed instructions and authorized task context. Include required repository instructions in the host's instructions/context explicitly before using this configuration. This flag is an explicit operator choice, not an automatic fallback. Native legacy Codex behavior is unchanged. The current CLI also requires `default_permissions` alongside the host's named permission profile; the reference adapter supplies both. Native shell, unrelated MCP servers, apps, memory, plugins, browser and subagents remain disabled for managed turns.

## Protocol and role admission

The host worker uses JSON lines over stdio. `initialize` creates the adapter; fixed operations are `run`, `history`, `purge`, `expose`, `catalog`, `probe` and active-turn controls. Output is normalized into thread/turn, configuration, public output, context budget, progress and steering-read events. Do not emit provider reasoning or credentials. Ordinary `console.log` is redirected to stderr. Frames, IDs and response schemas are validated by the host.

`run` must call `onThread` with its native session ID, call `onTurn`, and return matching IDs and nonempty text. Existing requests must resume the exact native ID. The host exposes its own `plugin:<uuid>` ID and keeps the native mapping private. It checks workspace, configuration, state protocol and authenticated account identity on resume. A changed identity requires explicit migration or a new backend/session.

`probe` reports `available`, `authenticated` (`true`, `false`, or `"unknown"`), `remoteVerified: false`, optional CLI version, and a stable SHA-256 account identity. Never return credentials. Local sign-in detection is not proof of a successful model call. Managed turns require a confirmed account identity and all of `managed`, `tools`, `resume`, `history`, and `contextBudget`.

| Capability | Required behavior |
| --- | --- |
| resume/history | Persist native IDs and authoritative history; never replace a failed session silently. |
| tools/managed | Expose only host-supplied tools. Forward tool calls to `onTool`, with stable native call IDs and schema-valid arguments. Disable unrelated native tools. |
| contextBudget | Count actual model-visible history and new input; stop before exceeding the host budget. |
| steering | A successful send is not read acknowledgement. Invoke `onRead` only after input enters model history. |
| promptRefresh | Change current instructions without replacing the native session. |
| purge | Return verified local deletion only after verifying it; provider retention remains `not_managed`. |
| images/nativeTakeover/modelCatalog | Declare only implemented and tested behavior; unsupported operations fail explicitly. |

Provider parameters stay provider-specific. `parametersSchema` rejects unknown fields; report requested/sent/confirmed settings through `onConfiguration`. Do not map a generic effort name to another provider's highest setting without confirmation.

## Effects, failure and recovery

Adapters return typed error codes through `BackendAdapterError`: authentication, provider rejection, quota, rate limit, transient failure, cancellation, invalid output, unsupported capability, process failure, unknown outcome, invalid configuration or context-budget exhaustion. Arbitrary raw error text and stderr never become model-facing diagnostics. `transient` is the only code translated to `TransientModelError`.

The host validates tool names/arguments against the current request and records a durable receipt before invoking the callback. Replayed calls with the same native turn/call ID and arguments return their completed receipt. An incomplete receipt fences the session: restarting a process cannot justify repeating an unknown external write. Reconcile the actual effect before explicit recovery. A killed adapter does not prove a remote operation was cancelled.

The adapter never receives a goal-completion API. Router goals, immutable objectives, authorization, acceptance criteria, independent verification, repair and replanning stay in the host. A CLI exit code or self-reported success is not acceptance. Unsupported adapters cannot be used for managed Router/Worker/Subagent roles. The separate native `router` client command still uses Codex; execution plugins use host Router mode.

## Upgrade and rollback

```sh
npx tsx src/cli.ts backend-plugins stage current.json /absolute/package REVIEWED_SHA256 new-config.json
npx tsx src/cli.ts backend-plugins probe new-config.json codex-plugin
```

Staging writes a new config and an immutable package object; it does not activate code or restart a live host. Drain tasks and reconcile uncertain effects, then restart the owned host with the reviewed config. Startup rejects package changes while tasks, goals, deliveries, jobs or uncertain tool receipts remain. A changed `stateVersion` requires an explicit migration. Settings cannot hot-edit plugin code, credential references or filesystem grants.

Each session pins its creation digest. Updating the configured version affects new sessions; old sessions continue using their original installed package. Rollback stages the previous digest against the **latest** config and **current** task database. Never restore an old DB to roll back code. Retain old package objects and native CLI histories. An external CLI binary/profile is not included in the package hash: pin and test the CLI distribution separately.

## Reference adapters and validation boundaries

- **Codex:** full managed reference. Uses official app-server APIs, independent host tools and native persisted history. Both legacy and external package paths exist.
- **ZCode:** experimental single-prompt reference using the official `--prompt --json --mode plan` path. No managed role, tool forwarding, history, resume, budget, model/effort override or native takeover is advertised. Version probing reports authentication as unknown. Its CLI has no `--model` switch; settings belong to the official CLI profile. A desktop-hosted success does not prove independent CLI access. HTTP 405/business 3012 is `provider_rejected`, HTTP 429/business 1113 is `quota_exhausted`; neither is retried as a transient error.
- **Independent test adapter:** `tests/fixtures/execution-backend.ts` demonstrates adding a provider without editing core. It exercises actual sandboxed IPC with synthetic model output; this is not real-provider acceptance.

Run `tests/backend-plugins.spec.ts`, `tests/zcode-backend.spec.ts`, Codex and sandbox regressions. Real multi-stage acceptance can use `AGENTHUB_SMOKE_BACKEND_CONFIG=/absolute/config.json` with `examples/goal-verification-smoke.ts` or `examples/goal-replanning-smoke.ts`. Each uses a fresh isolated state/workspace and real models; the verification fixture deliberately injects incorrect output, requires independent rejection and repair, and restarts host processes. Credentials and raw histories remain private.
