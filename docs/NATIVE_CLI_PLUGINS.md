# Claude Code, Gemini CLI and OpenCode plugins

These are three execution packages using the existing backend SDK. They do not add
provider switches to the host. The real vendor CLI executes inference, persists its
native session and resumes it. Roppo continues to own authorization, tool receipts,
goals, independent verification and repair. See [the execution contract](EXECUTION_PLUGINS.md).

## Pinned distributions

| Package source | Plugin ID | Tested CLI version | Model selection |
| --- | --- | --- | --- |
| `plugins/backend-claude` | `claude-code` | `@anthropic-ai/claude-code@2.1.319` | Claude model ID or CLI alias |
| `plugins/backend-gemini` | `gemini-cli` | `@google/gemini-cli@0.67.0` | Gemini model ID |
| `plugins/backend-opencode` | `opencode-cli` | `opencode-ai@1.19.5` | `provider/model` |

Install official packages in a dedicated prefix; use Node 24.15 or later for this
reference setup. Supply an absolute command and the exact `cliVersion`. Startup
refuses version drift; an auto-updated CLI must be reviewed and tested as an adapter
upgrade. Plugin bundles do not include the vendor CLI distribution.

Each package advertises resume, host tools, managed roles, history, context budget
and local purge. Steering during a running turn, prompt refresh, images, native
desktop takeover and a model catalog are **not** advertised. Unsupported generic
output-token limits are rejected. Claude accepts native `parameters.effort` values
`low`, `medium`, `high`, `xhigh`, `max`; conflicting generic effort is rejected.
Gemini and OpenCode reject generic effort; OpenCode exposes its native `variant`.

## Package and configure

From the repository, for each selected adapter:

```sh
npx tsx src/cli.ts backend-plugins pack plugins/backend-claude/index.ts plugins/backend-claude/manifest.json /absolute/packages/claude-1.0.0
npx tsx src/cli.ts backend-plugins inspect /absolute/packages/claude-1.0.0
```

Use the returned digest, not a placeholder, in a full Roppo configuration:

```json
{
  "backendPlugins": [{"directory": "/absolute/packages/claude-1.0.0", "digest": "REVIEWED_SHA256"}],
  "backends": {
    "claude": {
      "kind": "plugin",
      "plugin": "claude-code",
      "label": "Claude Code",
      "config": {"command": "/absolute/cli-prefix/node_modules/.bin/claude", "cliVersion": "2.1.319", "model": "YOUR_CLAUDE_MODEL"},
      "env": {"ANTHROPIC_API_KEY": "ROPPO_ANTHROPIC_API_KEY"},
      "readPaths": ["/absolute/cli-prefix"]
    }
  },
  "execution": {"backend": "claude", "router": {"mode": "host"}},
  "work": {"sandboxDriver": "seatbelt"}
}
```

Use `bubblewrap` on Linux. No extra write grant is required: each native profile,
work directory and transcript belongs to the plugin's private data directory.
Gemini can use an absolute Node executable as `command`, with its installed
`bundle/gemini.js` path in `args`. Its key environment is `GEMINI_API_KEY` (or
`GOOGLE_API_KEY`). OpenCode accepts the selected provider's declared key or a
private native auth profile. Proxy variables must be explicit environment
references (`HTTP_PROXY`, `HTTPS_PROXY`, `ALL_PROXY`, `NO_PROXY`); no shell secrets
are inherited. Loopback MCP and inference relay connections bypass proxies.

An optional HTTPS `baseUrl` overrides the provider endpoint; loopback HTTP is
allowed for protocol tests. Credentials, query strings and fragments in this URL
are rejected. OpenCode has default endpoints for `anthropic`, `openai`, `google`
and `opencode`; other providers require an explicit compatible endpoint and native
auth configuration. The adapter does not implement their authentication protocols.

`authDirectory` optionally identifies a dedicated, read-granted native profile:
Claude `.credentials.json` (plus optional `.claude.json`), Gemini
`oauth_creds.json` (plus optional `google_accounts.json`), or OpenCode `auth.json`.
Only these auth files are copied; unrelated CLI settings are not inherited.
OAuth file support has not received real-account acceptance in this change.
Prefer an API key for managed deployment until the intended account's refresh and
parallel-session behavior is verified. The source profile is never overwritten.

OpenCode also has an explicit `authMode: "anonymous"` for its named free models
(`opencode/*-free` or `opencode/big-pickle`, official endpoint only). Its probe
truthfully returns `authenticated: "unknown"`, without inventing an account ID.
The existing host admission rules consequently **reject anonymous managed roles**.
This mode supports isolated, non-managed model/tool validation. Free availability
and quotas are provider controlled; there is no automatic paid fallback.

## Isolation, budgeting and recovery

Each activation starts a private loopback MCP endpoint with a random capability.
Only host-supplied tools are listed. Native shell, file operations, unrelated MCP
servers, plugins, hooks and workspace discovery are disabled. CLI work directories
are separate from the actual task directory; task operations go through Roppo's
authorized tools. The outer OS sandbox remains mandatory.

The adapter forwards native HTTP requests through a private relay to the configured
upstream. Before forwarding, it checks the complete request, including CLI-generated
system messages/history/tool schemas, against the host's byte budget. It also checks
tool calls and receipts. Unknown native tools, opaque remote history references,
compressed request bodies and provider redirects fail closed. Credentials remain
in transit to the configured provider; the relay never logs or persists them.
This is byte accounting of serialized protocol, not a tokenizer estimate.

Native CLI events and host tool receipts form a durable public journal. Native
reasoning is not exposed. On restart the CLI resumes the original native ID and
its private native history; the journal is not replayed as a new conversation.
OpenCode's pinned native database is read only to bind its session before its
first inference/tool call, because its JSON events may be emitted later.

MCP request retries within an activation reuse the same call ID and completed
receipt. An uncertain external effect is fenced by the host across restart;
starting another CLI turn cannot clear it. An interrupted journal is marked
incomplete. A schema-invalid final answer or a native error accompanying text
cannot be accepted as success.

An interrupted turn that invoked tools also requires reconciliation even if the
host saved their results: these CLI protocols cannot prove the native process
durably consumed the last MCP response. The adapter blocks that resume instead
of repeating an external operation with a new call ID. Completed turns and
interrupted turns without tool effects can resume normally. This conservative
boundary is material for crash recovery; it is not an automatic reconciliation
implementation.

Purge writes a durable deletion intent, removes the owned native profile and
journal, verifies absence, and tolerates a lost acknowledgement/retry. Original
login credentials outside the profile and provider-side histories are not deleted.

Upgrade/rollback uses the existing package drain checks, immutable digest pinning
and current database. Old sessions keep their original adapter digest and native
CLI version; no task database snapshot is restored to roll back code.

## Validation

`tests/cli-adapters.spec.ts` runs all three packaged adapters through real sandboxed
IPC with a deterministic CLI fixture. It checks durable tool receipts, native
resume after reopening the database, invalid output and repair, uncertain-effect
fences, complete-wire budget rejection, interrupted execution and package
upgrade/rollback. These synthetic cases do not prove provider availability.

Run the actual installed binaries against a deterministic local provider:

```sh
npx tsx tests/manual/cli-protocol.ts claude /absolute/cli-prefix --host
npx tsx tests/manual/cli-protocol.ts gemini /absolute/cli-prefix --host
npx tsx tests/manual/cli-protocol.ts opencode /absolute/cli-prefix --host
```

This checks native flags, upstream tool allowlists, MCP calls, complete prior
conversation in resumed requests, private native persistence and retry-safe purge.
It uses fixture responses, not real model inference.

For real-provider acceptance, save only the backend definition (`config`, `env`,
`readPaths`) in a private JSON file and run:

```sh
npx tsx tests/manual/cli-live.ts opencode /private/backend-definition.json
```

The harness creates a disposable workspace, runs a real model/tool task, injects
artifact corruption, independently rejects it, reopens the host database and asks
the same native session to repair against the unchanged criterion. Only a file
readback passes validation. This is CLI acceptance, not production Router/office
acceptance. Full host-goal checks remain available through the existing
`examples/goal-verification-smoke.ts` and `examples/goal-replanning-smoke.ts` with
an authenticated managed backend.

Protocol references: [Claude CLI](https://code.claude.com/docs/en/cli-reference),
[Gemini headless mode](https://geminicli.com/docs/cli/headless/),
[OpenCode CLI](https://opencode.ai/docs/cli/). Vendor docs may describe a newer CLI
than the pinned distributions above; installed help and actual binary tests decide
compatibility.
