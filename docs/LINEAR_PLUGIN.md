# Linear source plugin

Linear is an external AgentHub v2 source package. Its implementation and manifest live under `plugins/linear`; loading it does not add a Linear branch to core routing, authorization or task acceptance.

## Behavior

- A configured team UUID is an authorization scope. An issue UUID is the conversation within that team. Optional `issueIds` narrows the connection further.
- Polling reads changed issues and issue comments with server-side team/issue filters. `/agent` at the beginning addresses the Router. Other admitted messages remain context, subject to the host's existing policies.
- A new, unmodified issue can provide an initial instruction. An issue already modified before its first observation is context only: attributing its current description to the creator would be unsafe. Post a new `/agent` comment to initiate work on an existing issue.
- Edited or archived messages produce invalidation facts rather than new instructions. Exact source reads recheck the original content and actual issue/team. Moving an issue outside the configured scope prevents subsequent reads and replies.
- `message_read`, `issue_read` and paginated `thread_read` require an existing task-authorized `triggerId`. They cannot browse arbitrary issue IDs. Issue reads include the current workflow state and project reference; those values do not complete AgentHub goals or alter acceptance criteria.
- The Router's outbox writes a comment on the original issue. In package 1.1, an operator can also link an exact issue to a Roppo entry for approved status changes. Workers can inspect a linked issue and propose a change. The host submits the change after approval and reads the resulting issue state.

## Authentication and configuration

The [official API documentation](https://linear.app/developers/graphql) supports personal API keys (`Authorization: <key>`) and OAuth access tokens (`Authorization: Bearer <token>`). `authType` selects the scheme. The default connection uses read and comment creation permissions. A connection used for status changes also needs issue write access. Team restrictions on the credential provide an additional platform boundary.

Personal keys act as their owner. OAuth app actors can provide a separate application identity. The plugin reports the actual verified account type; it never labels a personal key as a bot. The host pins the workspace/account principal and rejects account changes. It also distinguishes active human members from application users.

OAuth renewal belongs to the credential provider in this version. An expired or revoked credential fails closed; there is no built-in OAuth installation or refresh-token service. Public distribution should use an appropriately managed [OAuth application](https://linear.app/developers/oauth-2-0-authentication).

```sh
node --import tsx src/cli.ts plugins pack plugins/linear/index.ts plugins/linear/manifest.json /absolute/new/linear-package
node --import tsx src/cli.ts plugins inspect /absolute/new/linear-package
```

Use the emitted digest in your config. Replace every placeholder; team, workspace and issue values must be actual UUIDs.

```json
{
  "sourcePlugins": [{"directory": "/absolute/new/linear-package", "digest": "REVIEWED_DIGEST"}],
  "sources": [{
    "id": "office-linear",
    "kind": "linear",
    "cwd": "/absolute/workspace",
    "allowedActors": ["AUTHORIZED_USER_UUID"],
    "options": {
      "workspaceId": "WORKSPACE_UUID",
      "teams": ["TEAM_UUID"],
      "issueIds": ["OPTIONAL_SELECTED_ISSUE_UUID"],
      "tokenEnv": "AGENTHUB_LINEAR_TOKEN",
      "authType": "api-key",
      "command": "/agent"
    }
  }],
  "toolConnections": {
    "linear": {
      "transport": {"kind": "plugin", "sourceId": "office-linear"},
      "allowedTools": ["message_read", "issue_read", "thread_read"]
    }
  }
}
```

Omit `issueIds` to include the configured teams' issues. Bind the team and authorize actors with the existing host setup; installing the package does not itself admit users or grant Workers tools. Store only environment variable names in config. Keep token values in the host's private environment file.

## Approving an issue status change

In the host scope setup, bind the conversation entry and include this Linear source in its management scope. Use the entry's Roppo binding ID from **Router management**, the verified Linear team UUID and the specific issue UUID. Add the following option to the Linear source in the example above. The source needs both resource reads and replies enabled. The scoped issue must also satisfy any configured `issueIds`.

```json
"statusTargets": [{
  "key": "ci-issue",
  "entryId": "ROPPO_ENTRY_BINDING_ID",
  "teamId": "TEAM_UUID",
  "issueId": "ISSUE_UUID"
}]
```

The Worker lists or inspects `ci-issue` through `superagent_workflow` and can propose one transition. **Needs your attention** shows the verified account, issue and before/after state. An authorized manager can also reply with the displayed approval or decline code in the originating conversation. A signed CI event sends its request back to the conversation that granted its authority.

Approval survives a host restart. Immediately before submitting, the host rechecks the grant and the plugin rereads the issue revision. Linear's mutation and the preceding read are separate requests, so a concurrent edit in that interval can still win. A confirmed receipt includes the issue ID, observed state and Linear revision. An ambiguous write can be reconciled using **Check remote state**, which only reads. Observing the desired state confirms its presence and leaves the writer unattributed.

## Recovery and limits

Each team has one durable ISO timestamp cursor and a fixed unfinished update window. Both issue and comment streams must finish before the team cursor advances. Five pages are processed per poll, with a default page size of 50. Successful pages checkpoint their progress; network failures and process restarts resume the saved window. Changes to the configured issue allowlist restart an unfinished window safely.

The comment stream is filtered independently by comment update time, so comments added to old issues are recoverable without relying on the issue's update timestamp. Repeated delivery is deduplicated by source/team/entity observation. An edit invalidates the original event; it does not silently replace a user's goal.

GraphQL errors are failures even with HTTP 200 and partial data. HTTP/GraphQL rate limits persist a retry deadline. Responses are bounded, redirects are refused, and the API endpoint is restricted to the official Linear GraphQL endpoint (loopback HTTP is available for local tests).

Outgoing comments have a deterministic UUID derived from the host delivery ID, and an own-message fence is committed before the API mutation. A response lost after the write is **uncertain**, not success. The host must reconcile it; the plugin does not automatically retry mutations. A stable UUID helps find the write and is not an exactly-once guarantee.

Polling sees only data still exposed by Linear. It cannot prove recovery of permanently deleted comments, every transient edit, or every membership event. Reads and replies recheck accessible resources. No webhook receiver, native Linear Agent Session protocol, automatic status transition, public marketplace or OAuth renewal service is included here.

Package upgrade and rollback use the existing drain/activation rules in [PLUGINS.md](PLUGINS.md#upgrade-and-rollback). They keep the current task database and effect receipts. An unfinished task/goal blocks code replacement; ordinary restart with the same digest can resume it.

## Validation

```sh
npm run typecheck
npx vitest run tests/linear-plugin.spec.ts tests/personal-workflows.spec.ts
```

`examples/plugin-live-linear.ts` runs against one selected test issue. Supply `AGENTHUB_LIVE_SEND=1`, `AGENTHUB_LINEAR_TOKEN`, optional `AGENTHUB_LINEAR_AUTH_TYPE`, and the three explicit UUIDs `AGENTHUB_TEST_LINEAR_WORKSPACE`, `AGENTHUB_TEST_LINEAR_TEAM`, `AGENTHUB_TEST_LINEAR_ISSUE`.

1. Run `node --import tsx examples/plugin-live-linear.ts listen /absolute/fresh/evidence`. Post `ready.json`'s `liveMarker` as a new comment using another authorized connection.
2. Wait for the process to exit and `restart-ready.json` to appear. Post its `offlineMarker` on the same issue while the process is stopped.
3. Run `node --import tsx examples/plugin-live-linear.ts resume /absolute/fresh/evidence` with the same private environment. Only `evidence.json` with `ok: true` counts as real platform acceptance.

The harness verifies identity, source/issue reads, comment delivery, independent GraphQL readback, full process restart, durable cursor/receipt recovery, offline comments and deduplication. A partial or uncertain run needs reconciliation and a fresh listen directory; do not reset its state to force a pass. This is transport acceptance, distinct from a production deployment or a model-driven task.
