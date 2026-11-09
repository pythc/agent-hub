# Agent board

A removable Roppo workspace view. See active Router/Worker execution, tasks that need a person, recent tool calls, message admission and auxiliary decision usage without leaving the existing workspace.

The board reads the running host. It does not execute models, issue Worker commands, approve work or create its own task database. Light/dark themes and English/Chinese follow the host.

## Build and install

From the repository root, with dependencies already installed:

Use a host build containing the workspace-view API v1 implementation in this branch. Older source-only plugin hosts cannot load this category; update the host code before activating a staged view configuration.

```sh
npm run typecheck:views
npm run pack:agent-board -- .local/agent-board-0.1.0
node --import tsx src/cli.ts plugins inspect .local/agent-board-0.1.0
node --import tsx src/cli.ts plugins stage /absolute/current-config.json .local/agent-board-0.1.0 REVIEWED_DIGEST /absolute/new-config.json
```

Use a new output directory for every build. Review the emitted digest and the new configuration before starting the host with it. Staging installs immutable bytes under `stateDir/plugins/objects/<digest>`; it does **not** restart or change a running host. Keep the current `stateDir` to preserve accounts, tasks, settings and browser state. The navigation entry appears automatically after activation.

The staged reference is:

```json
{
  "viewPlugins": [{
    "id": "agent-board",
    "directory": "/absolute/state/plugins/objects/REVIEWED_DIGEST",
    "digest": "REVIEWED_DIGEST",
    "enabled": true
  }]
}
```

To disable, set `enabled: false` in the next deployment configuration and apply it through the host's normal controlled restart. Disabled or missing packages do not prevent startup. Disabled views disappear; open frames are removed when the host next validates their read (normally within five seconds). For rollback, stage the previous package digest **against the latest configuration**, preserving its `stateDir`. Never restore an old state database as a code rollback. Saved editable settings remain authoritative on restart; deployment package references come from the selected configuration.

## What the numbers mean

- Tasks retain Roppo's existing queued/running/attention/ready/replied/closed semantics. A completed tool call does not prove that its task succeeded. A reply receipt does not imply human acceptance.
- Source filters apply to tasks, active work, retained calls and admission records. Auxiliary usage and browser controls are explicitly workspace-wide.
- Admissions show at most 100 recent records; candidate batches at most 50. They are different retained windows, not a conversion funnel. Admission permits work; it is not evidence of a completed intervention.
- Auxiliary usage comes from routing calls within the latest 100 decision records. Probes are excluded. Input/output coverage is separate; missing values are unknown. No savings, accuracy, full-team tokens or currency cost are inferred.
- Activity returns at most 100 retained calls. Current work can use a different model than the configured profile; the agent drawer labels the configuration and shows actual call models separately.
- Flow animation represents currently running assignments. It stops on stale data, a paused host, a hidden page or reduced motion. Unknown/disconnected source health is not presented as healthy listening.

## Isolation and extension contract

See [Workspace views](../../docs/WORKSPACE_VIEWS.md). This package declares only `workspace.runtime.read`. The host verifies its digest, loads its self-contained browser bundle into an opaque sandboxed iframe and supplies a bounded metadata projection. There are no ambient host credentials, arbitrary network access, raw prompts, model parameters, page URLs, saved passwords or tool payloads in that projection.

## Local acceptance

```sh
npm run build:chat
node --import tsx examples/agent-board-acceptance.ts .local/board-preview-NEW
python tests/browser/agent-board.py .local/board-preview-NEW
```

Requires Python Playwright with Chromium. `PLAYWRIGHT_CHROMIUM_EXECUTABLE` can point to an installed test browser. The acceptance host uses a separate state directory and synthetic Runtime records, with no external model or application calls. It is not a production deployment. Stop the fixture process after inspection.
