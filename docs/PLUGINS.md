# Source plugins v2

For UI extensions, see [Workspace view plugins](WORKSPACE_VIEWS.md). They share the package CLI but have a separate manifest, capability and browser sandbox contract.

AgentHub now loads operator-installed source packages without adding source-kind branches to the core. Feishu, Slack and [Linear](LINEAR_PLUGIN.md) are reference packages; `examples/plugins/checkpoint-source.ts` is a third-party-shaped example used by the real-model acceptance run. This is a local developer interface, not a hosted marketplace or a signed publisher registry.

The Router retains task authority, goals, dependencies, re-planning, acceptance and reply ownership. Plugins transport verified messages, read authorized resources and deliver host outbox messages. They cannot directly create/complete tasks or change authorization and acceptance criteria. Native Worker tools are resource reads through existing reached-trigger, assignment and scope checks; writes remain Router-owned outbox actions.

## Package and connection

A package contains only `manifest.json` and a self-contained `plugin.mjs`. `plugins pack` bundles TypeScript and its dependencies. The generated manifest pins `codeSha256`; its normalized full digest pins the reviewed package. Install copies the verified bytes under `stateDir/plugins/objects/<digest>` and rechecks them before process launch. The digest is an integrity binding, not a publisher signature.

The manifest declares:

- `id`, `kind`, `version`, `stateVersion` and `apiVersion: 2`.
- Connection `configSchema`, explicit `scopesPath`, optional `commandPath`, setup field descriptions and credential environment-variable pointers.
- Supported methods, permitted metadata kinds, bounded private state, resource tool schemas and whether network access is needed.
- Replay cursor scope and encoding. A cursor proves message-window progress; it does not prove that upstream retained every lifecycle event.

Build and inspect the reference packages:

```sh
node --import tsx src/cli.ts plugins pack plugins/feishu/package.ts plugins/feishu/manifest.json /absolute/new/feishu-package
node --import tsx src/cli.ts plugins pack plugins/slack/index.ts plugins/slack/manifest.json /absolute/new/slack-package
node --import tsx src/cli.ts plugins inspect /absolute/new/slack-package
```

Record the emitted digest in the existing host configuration. Example fragment:

```json
{
  "sourcePlugins": [
    {"directory": "/absolute/new/slack-package", "digest": "REVIEWED_DIGEST", "readPaths": []}
  ],
  "sources": [{
    "id": "office-slack",
    "kind": "slack",
    "cwd": "/absolute/task-workspace",
    "allowedActors": ["U_ALLOWED_PERSON"],
    "options": {
      "channels": ["C_ALLOWED_CHANNEL"],
      "teamId": "T_EXPECTED_WORKSPACE",
      "tokenEnv": "AGENTHUB_SLACK_BOT_TOKEN",
      "appTokenEnv": "AGENTHUB_SLACK_APP_TOKEN",
      "command": "/agent"
    }
  }],
  "toolConnections": {
    "slack-docs": {
      "transport": {"kind": "plugin", "sourceId": "office-slack"},
      "allowedTools": ["message_read", "thread_read"]
    }
  }
}
```

These are placeholders, not valid platform IDs. Set the corresponding credentials through the host environment or its existing private environment-file mechanism; do not put secret values in manifests or configuration. Grant `slack-docs` only to Workers that need it through their existing `toolConnections` list. Installing a package does not grant a Worker every declared tool.

```sh
node --import tsx src/cli.ts plugins probe /absolute/config.json office-slack
```

`probe` checks the selected account and platform choices. Existing scope/entry binding and actor admission remain required. The integration catalog exposes the package's schema, setup description, methods and tools. A generic graphical plugin marketplace/settings editor is not included in this iteration.

## Developer API

Import the local `plugins/sdk.ts` when building a plugin, then export `{create(config)}`. Bundling includes the SDK; the running package does not import host modules. The SDK is not yet published as an npm package.

A source may implement `identity`, `probe`, `members`, `start`, `poll`, `read`, `context`, `deliver` and `close`, and must declare each exposed method. `identity` returns a stable verified platform account; the host checks it against the saved connection principal. Implementations must also bind each read/write to the actual platform conversation, including a reply's original message/root.

`SourceContext` in a v2 process exposes:

- `receive(trigger)` and `change(verifiedLifecycleEvent)`. Actor, source, scope, channel and schemas are validated again by the host. Lifecycle state fences late copies of edited/deleted messages.
- `store.get/list/put`: a local control-state cache and permitted writes. It is **not a complete historical database view**. Private `plugin-state` is namespaced per connection and bounded to 2 MB. Metadata writes need declared kinds and source-qualified IDs.
- `records(kind, query)`: source-filtered pages of up to 200 records / 1 MB, with an opaque `next` record ID. Supported selectors are `ids`, `cursor`, `limit`, `sourceId`, `scope`, `messageIds` and `subscribed`. Foreign source/scope queries fail. History is read on demand rather than copied into every call. Use SDK `record`, `records` and `recordPages` helpers when supporting legacy mode as well.
- `checkpoint()`: resolves after queued operations are durably committed by the host. Await it before acknowledging a platform delivery or moving a recoverable page cursor.

`bind/closed` are unavailable in v2. No database handle, task API or ambient host credentials are passed to the child. Keep state small; use historical record queries for source data. Pages are live reads, not a multi-page database transaction. A live write newer than the response watermark is retained; plugins still need platform message/version IDs and stable event idempotency.

Each connection runs in its own sandboxed process with a private scratch HOME/TMPDIR, explicitly selected credential environment variables and operator-specified read paths. Use Seatbelt on macOS or the configured supported sandbox. No unsandboxed fallback is provided. `network: true` is broad network permission; it is not a domain firewall. This model assumes reviewed, operator-installed code with its declared platform privileges. It is not a claim that arbitrary malicious marketplace code is safe.

The host serializes calls, fences stale child responses and terminates failed child process groups. All event batches, including writes produced during a method, use the same persistence acknowledgement. Small batches bound IPC size. Request snapshots carry the last committed event sequence so simultaneous live callbacks cannot restore an older local write.

## Reference capabilities

| Capability | Feishu package | Slack package |
|---|---|---|
| Identity and membership | App bot / fixed chats | Expected workspace and account / selected channels |
| Ingress | REST polling | REST backfill and optional Socket Mode |
| History | Anchored message and thread | Anchored message and thread |
| Outbound | Bot thread reply | Bot thread reply |
| Recovery | Fixed window plus durable next-page state | Fixed window plus durable next-page state |
| Changes | Known-message readback checks | Socket edit/delete/membership/channel events; observed edits during polling |

The Feishu v2 manifest deliberately requires explicit chats, app credentials, `liveEvents: false`, `otherChats: ignore` and `directMessages: false`. Legacy Feishu CLI/live events remain available through the compatibility adapter; extracting the implementation does not silently change an existing deployment's transport. REST polling cannot promise complete recovery of unretained membership/permission events.

For Slack, `plugins/slack/slack-app-manifest.json` is an app setup template. Install a bot in the expected workspace, give it the listed scopes and invite it to selected channels. Socket Mode additionally needs an app-level token with `connections:write`. This token and the bot token are separate credentials. Socket events are acknowledged only after host commit. Polling alone cannot observe every reply in an old, unsubscribed thread, nor every deleted message. Upstream retention, API permissions, rate limits and cursor validity still apply. Official references: [app manifests](https://docs.slack.dev/app-manifests/), [Socket Mode](https://docs.slack.dev/apis/events-api/using-socket-mode/), [thread API](https://docs.slack.dev/reference/methods/conversations.replies/).

Both adapters retain an unfinished pagination window and process at most five pages per conversation in a poll. A timeout or restart retains the next page; the source's overall cursor advances only when that fixed window is complete. Repeated page contents are deduplicated by stable event identity. A platform that invalidates its own cursor needs reconciliation; no local mechanism can recreate events the platform no longer exposes.

Outbound transport failure is `uncertain`, not success. Slack `client_msg_id` aids reconciliation and is not an exactly-once guarantee. The host does not blindly replay an ambiguous external effect after restart. Native read failures are retained as failed read results; they do not invent an uncertain external write.

## Upgrade and rollback

1. Build and review the new package; inspect its exact digest and keep the previous package bytes.
2. Stage against the **latest** configuration:

   ```sh
   node --import tsx src/cli.ts plugins stage config.json /absolute/new/package REVIEWED_DIGEST upgrade.json
   ```

   Staging installs bytes and writes a new private config. It does not restart the live host. Existing explicit `readPaths` are retained. Built-in replacement, including packaged Feishu, is explicit in configuration.
3. Drain the host before activating a different digest: no open tasks, unfinished goals, pending/running jobs, pending/sending/held/uncertain deliveries or running/uncertain tool effects. This is intentionally a whole-host gate because tasks can depend on another connection's tools. A paused/held long task is still unfinished.
4. Stop and restart with the staged config through the normal deployment procedure. Settings and package activation are transactional; a refused activation leaves their previous durable revision intact.
5. To roll back code, stage the prior reviewed digest against the latest config and restart again. Keep the current database, goal contracts, task IDs, acceptance evidence, authorization and effect receipts. **Do not restore an old task database to roll back plugin code.**

Changing `pluginId` or `stateVersion` requires an explicit migration; this version refuses it. A declared unchanged state version is the developer's backward-compatibility promise, not an automatic proof. Removal requires disabling the existing source; an installed v2 source cannot silently revert to legacy. Standard host backups do not bundle external plugin code, so retain the referenced immutable package objects separately. Existing host database schema migration rules also apply.

There is no automatic hot upgrade, marketplace signing, plugin data migration language or arbitrary native Worker write-tool API in this iteration. These require their own review and acceptance before expansion.

## Validation commands

```sh
npm run typecheck
npm test -- --maxWorkers=2 --testTimeout=15000 --hookTimeout=15000
AGENTHUB_SMOKE_DIR=/absolute/fresh/evidence node --import tsx examples/plugin-goal-smoke.ts
node --import tsx examples/plugin-lifecycle-smoke.ts /absolute/fresh/evidence
```

The model example uses a real Router and two real Workers, a third-party-shaped checkpoint package, four dependent tasks, controlled bad output, independent rejection, repair and two host restarts. It preserves an offline unfinished checkpoint for the activation refusal test; the lifecycle example upgrades and rolls back only after the real goal drains.

`examples/plugin-live-feishu.ts` additionally requires explicit `AGENTHUB_TEST_FEISHU_CHATS`, `AGENTHUB_TEST_FEISHU_BOT_ID`, the two credential environment variables and opt-in `AGENTHUB_LIVE_SEND=1`. It writes marked bot test messages, reads them back independently and restarts the plugin process. Existing `sending` receipts must be reconciled; rerunning does not blindly resend them. Never point live examples at conversations without permission. Local protocol tests, real-model execution, real-platform I/O and production deployment are separate evidence categories.

`examples/plugin-live-slack.ts` is a two-process live acceptance harness. It requires `AGENTHUB_LIVE_SEND=1`, an explicitly authorized `AGENTHUB_TEST_SLACK_CHANNEL` / `AGENTHUB_TEST_SLACK_TEAM`, and the `AGENTHUB_SLACK_BOT_TOKEN` / `AGENTHUB_SLACK_APP_TOKEN` credentials in the environment. The bot must already be installed and invited to that channel. Keep the evidence directory and credentials private.

1. Run `node --import tsx examples/plugin-live-slack.ts listen /absolute/fresh/slack-evidence`. After `ready.json` appears, post its exact `liveMarker` through another authorized Slack identity. The harness accepts the Slack connector's visible `发送工具` attribution suffix, but still verifies the full original message text. It waits for a real Socket Mode event, reads its message through the isolated plugin, replies as the bot and independently reads back that reply. A started directory cannot be reused for `listen`; preserve an incomplete run and use a fresh directory.
2. Wait for that process to exit and `restart-ready.json` to appear. Post its exact `offlineMarker` in the same Slack thread while the harness is stopped. Do not post it during step 1.
3. Run `node --import tsx examples/plugin-live-slack.ts resume /absolute/fresh/slack-evidence` with the same environment. It checks persisted identity, event, cursor and delivery receipt, recovers the offline reply through REST before reopening Socket Mode, then checks repeat-poll deduplication and reply readback.

Only `evidence.json` with `ok: true` establishes completion. A `ready.json` file proves readiness only. A failed/uncertain send requires reconciliation; the harness does not blindly retry it. These phases verify real transport and process recovery, not a production Router deployment or a new real-model task run.

## Marketplace distribution

Install and manage released packages from the built-in [plugin marketplace](PLUGIN-MARKETPLACE.md). GitHub catalogs describe compatible immutable versions; source-only directories are not installable. The market keeps downloaded, configured and active states separate and preserves the controlled-restart and task-state boundaries described here.
