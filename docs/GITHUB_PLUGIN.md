# GitHub repository source package

`plugins/github` is the GitHub reference implementation for source protocol v2. The existing built-in adapter imports the same implementation for compatibility. Existing deployments keep their configuration and transport until an operator explicitly stages the package. Core publication, review and merge logic uses `RepositorySource` capabilities rather than testing a GitHub class or kind. A package with a different kind can implement the same contract without adding a core branch.

## Install and scope

```sh
node --import tsx src/cli.ts plugins pack plugins/github/package.ts plugins/github/manifest.json /absolute/new/github-package
node --import tsx src/cli.ts plugins inspect /absolute/new/github-package
```

Pin the emitted digest and configure one repository per connection:

```json
{
  "sourcePlugins": [{
    "directory": "/absolute/new/github-package",
    "digest": "REVIEWED_DIGEST",
    "replaceBuiltin": true
  }],
  "sources": [{
    "id": "project-github",
    "kind": "github",
    "repository": "owner/project",
    "cwd": "/absolute/project-clone",
    "sandbox": "workspace-write",
    "allowedActors": ["authorized-person"],
    "allowedBots": ["github-ci"],
    "observed": true,
    "github": {
      "transport": "http",
      "tokenEnv": "AGENTHUB_GITHUB_TOKEN",
      "command": "/agent",
      "receiveAll": false
    },
    "options": {"repositories": ["owner/project"]}
  }],
  "delivery": {"workerPublish": true, "autoMerge": false}
}
```

These are example identities, not automatic grants. Supply secret values only through private host environment configuration. The package receives only the credential variables declared by its manifest. Use the least GitHub permissions needed for the chosen operations: repository reads, Issue/PR comments, and code writes only if publishing drafts. `probe` confirms the account and repository readback; it does not replace scope/entry binding or actor admission. A repository entry uses the exact `owner/project` native ID.

`observed`, `allowedBots`, automatic admission and explicit rules are separate controls. Setting `observed: true` permits assessment; it does not authorize every event to execute. Enable `acceptMode: auto` and a rule limited to failed CI on existing owned PRs if automatic repair is intended. Keep the original task authorization valid. Success statuses should be ignored. Never infer permission to start unrelated work from a CI event.

`toolConnections` may expose `message_read`, `thread_read`, `issue_read`, `pull_read`, `checks_read` and `files_read`. All require a reached trigger; edited message anchors fail. File listing is bounded and explicitly reports truncation. Only grant the needed tools to each Worker.

## Continuation and events

When Router delegates an admitted Issue request, the host subscribes the task to the original native Issue for context. The internal delegation conversation remains its Worker reply channel. This subscription does not make task completion depend on closing the Issue. Startup reconstructs missing subscriptions for existing authorized host tasks; revoked tasks cannot acquire them.

An allowed CI event on an owned PR can attach to the existing task across discussions. Admission cannot create duplicate work for that owned PR. A bot follow-up adds evidence under the original mandate and does not replace the original human requester, task routing, goal or acceptance criteria. Current scope, entry, actor and original authorization checks still apply. A bot cannot reopen completed work.

The package polls both [Check Runs](https://docs.github.com/en/rest/checks/runs) and [Commit Statuses](https://docs.github.com/en/rest/commits/statuses). Statuses use the latest value per context, with distinct stable identities from Check Runs; pending statuses suppress older terminal values. Host ingress deduplicates repeated polling. Per-thread read failures retain that thread's cursor. Successful polls retain a two-minute overlap to recover short list-visibility delays; delays beyond that window still need explicit replay. Events and per-thread progress are acknowledged before the global cursor moves. Internal delegation IDs never become GitHub Issue numbers.

Polling is bounded to 20 pages of 100 items per endpoint, retaining the cursor on overflow. Fresh connections start at the last ten seconds; no historical full-repository import is implied. The general Issue list retains GitHub's default open-state query; subscribed threads are queried directly, including closed ones. Active subscriptions remain polled; finished subscriptions age out after two weeks without activity. This is polling, not complete webhook history: deleted/unretained messages, permission loss, rate limits and huge backlogs can require reconciliation.

## Repository capability contract

The optional manifest `repository` declares a repository-ID pointer, reviewed remote URL templates, a credential-variable pointer and push username. `threadSeparator` supports native Issue syntax such as `#`; `observedPath` maps an existing source observation flag. New fields are optional and do not rewrite old package digests. The host validates configured repository scope, uses only declared remotes, and keeps publication credentials out of command arguments and source files.

Export `create(config, context)` and declare each supported method:

| Method | Required behavior |
|---|---|
| `repositoryPull(number)` | Read normalized `{number, state, head: SHA, base: branch, ...}` for the requested PR. |
| `mergeSnapshot(number)` | Return `{actor, pull, reviews, checks, graph}`. `pull` includes open/draft/merged/mergeable flags, additions/deletions, exact head SHA/ref/repository and base ref/repository. `reviews` include identity/type, state, commit and ordering fields. `checks` carries the head and complete Check Run/latest Status results. `graph` carries external auto-merge state and complete unresolved-thread state. Missing required evidence fails closed. |
| `reviewGraph(number)` | Return paginated-to-completion review thread IDs, resolution/outdated flags and first-comment native IDs. Fail if pagination cannot be completed. |
| `draft(branch,title,body)` | Find the already-open task branch PR before creating one draft. Return a confirmed PR number and URL. Call `context.beforeRepositoryWrite()` immediately before the external create. |
| `resolveReview(number,threadId)` | Verify membership in that PR, return if already resolved, otherwise call `beforeRepositoryWrite()` before resolving. |
| `mergeIdentity()` | Read a separately configured merge principal. It must differ from the publication account. |
| `merge(number,head,method)` | Call `beforeRepositoryWrite()` then atomically compare the expected head during merge. Return confirmed `{merged,sha}`. Never queue a merge lacking an expected-head condition. |

The current normalized snapshot contract follows the existing host review model; arbitrary provider payloads are not interchangeable. `src/repository-source.ts`, `src/merge.ts` and the GitHub package define the exact fields. The repository methods are host-internal capabilities, not public tools that a model can invoke freely. Installed code is still trusted to implement its declared platform semantics; the process sandbox is not a proof against a malicious publisher.

`context.repositoryUpdate(...)` reports a validated platform observation. The host may bind an already-owned branch using its deterministic task branch ID or observe a native close. Plugins do not receive a ticket database or direct `bind/closed` authority. Native closure never substitutes for goal acceptance.

## Effects, restart and versions

Publication retains durable `pushing`, `creating`, `uncertain` and confirmed draft receipts. An ambiguous PR creation is held for reconciliation instead of blindly repeating POST. Comment delivery reconciles its stable hidden marker. Merge attempts retain unknown outcomes and require exact-head readback; they are not automatically repeated. An operator must reconcile a held publication record with the remote branch/PR before resuming it. There is no general automatic recovery from every provider-side unknown outcome.

Independent acceptance snapshots include the task's host-owned publication receipt: repository, PR number/URL, head SHA, observed draft flag and confirmation time. This proves the provider result at that time, not a continuously fresh remote state. Opaque completed tool calls or Worker reports alone do not prove publication. Foreign task receipts and undeclared record fields are excluded. Pending/uncertain repository effects block verification, automatic repair and release until reconciled. Publication and queued merge requests recheck current assignment authority immediately before writing.

Restart an active task using the same immutable package and database. Upgrade or rollback requires a drained host and compatible `stateVersion`; unfinished goals, tasks, jobs and unresolved external effects block activation. Rollback changes code only, retaining the latest task database, cursors, goals, authorization and evidence. Keep both reviewed package objects. See [the shared lifecycle procedure](PLUGINS.md#upgrade-and-rollback).

For opt-in real acceptance, `examples/plugin-live-github.ts` uses an explicitly named private `agenthub-github-validation*` repository, a pre-existing clone at `<evidence-root>/repository`, host `gh` authentication, `AGENTHUB_GITHUB_TOKEN`, and a local authenticated Codex CLI. It creates an Issue, a draft PR, real commit statuses and comments, runs actual model work, stops/restarts the host and exercises code upgrade/rollback. It deliberately injects one faulty implementation and one false ready report to test repair and acceptance. The default execution path uses the external Codex CLI plugin; `AGENTHUB_GITHUB_NATIVE=1` selects the existing native Codex backend to isolate source-plugin acceptance. GitHub itself still runs in the sandboxed v2 source package. Actual frozen tests run locally before the controller posts their status to GitHub; this does not claim a hosted GitHub Actions run. Never point it at an ordinary project repository. A passing evidence artifact, not merely a started process, establishes completion.
