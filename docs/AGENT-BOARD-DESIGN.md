# Agent board: design and plugin contract

Status: implemented and locally verified, 2026-11-09. Target: the existing Roppo operator workspace. Installation and the generic plugin contract are documented in [Workspace views](WORKSPACE_VIEWS.md).

## Product direction

A person opens the board to see which agents are working, what needs a human, and why Roppo intervened. The board aggregates the operator's workspace. Conversation Team activity remains conversation-scoped. Users communicate through Router; no Worker chat composer.

Reuse the existing shell, collapsible navigation, account, theme and language controls. The board is a removable workspace-view plugin, not another administration application. Source plugins are already packaged and digest pinned; they are not UI plugins. Add a generic workspace-view extension category and use it for this board. Do not pretend a source adapter's polling API provides a view extension.

## Visual system

- Palette: white canvas #ffffff, soft #fafafa, ink #171717, muted #666666, border #e5e5e5, selection #f0f0f0. Dark equivalents follow existing theme.css: #111111 / #191919 / #f5f5f5 / #ababab / #333333 / #292929.
- Typography: existing local Avenir Next, PingFang SC, system-ui. Page title 26px/650; sections 16px/650; body 14px/1.5; labels 13px. No external fonts.
- Spacing: 8/12/16/24/32; differentiated 6px controls, 12px agent nodes, 16px panel. Use rules and whitespace instead of identical KPI cards.
- Left aligned workspace. Main focus is an actual Router-to-Worker relationship diagram; side queue handles human attention. Task rows and source labels remain compact.

```text
Agent board                              Source selector   Refresh
Overview     Tasks     Listening & usage
-----------------------------------------------------------------
Team activity                          Needs your attention
                 Router                Questions / approvals
              /    |    \              Browser handoff / failures
           Workers + actual tasks
-----------------------------------------------------------------
Recent tasks                           Recent interventions
```

Review of the plan: generic KPI cards would consume space without showing what the agents do. Replaced them with a compact status strip and a meaningful team diagram. Avoid a second workspace selector. Detailed model parameters and event evidence belong in a drawer. No ornamental hero, invented productivity metrics or unnecessary small copy.

## Interactions and semantics

Three page tabs: Overview, Tasks, Listening & usage. Tasks can be filtered by actual state and source. Click task/worker for bounded details and an explicit link to existing authorized task/configuration/conversation workflows. A selected task is not a command to mutate task state. Keyboard focus visible, tabs operable, drawer Esc/Tab/focus return correct. Narrow view stacks; no horizontal page overflow.

Only real running relations animate. Stop animation when stale/disconnected; respect reduced motion. Loading, empty, error and disconnected states must be useful. Keep last good data only with a clearly stale label. Poll only while mounted and visible, serialize requests, abort on teardown, avoid stale out-of-order updates.

Task execution, result readiness, delivery, and human acceptance are distinct. Completed tool call is not completed goal. Auxiliary decision labels are suggestions; Router remains final authority. Separate shadow/advisory and probe/routing. Do not claim IGNORE saved a Router call. Tokens are observed partial usage, not total cost. Missing model usage, prices and subscription quota stay unknown. No fake completion percentages, savings or accuracy.

## Plugin contract

Implement an independently built browser package in `plugins/agent-board/`. Generic manifest declares category workspace-view, API version, id, version, en/zh label, entry, SHA256, and explicit read capability. Build/package/inspect/stage via existing `plugins` CLI workflow (dispatch by category without breaking source-plugin commands). Immutable installation under stateDir with reviewed digest; config references pinned digest. Disabled plugin disappears and its entry/data fails closed. No automatic changes to running production config.

Use a sandboxed iframe without same-origin, forms/popups/download/top-navigation. Browser bundle loaded only after host verifies digest, framed via srcdoc plus restrictive CSP. No direct network, config, credentials, raw database, tools or filesystem from the plugin. Generic authenticated host API supplies a typed, bounded operator projection; parent bridge validates frame source and instance token/MessageChannel, and allowlists navigation to existing safe host destinations. Theme/language flow from host; no duplicate app chrome. Polling cleanup, permission checks, tampering, plugin disable, stale frames and malformed bridge requests require tests.

Avoid backend plugin WIP in other checkout. Source runtime adapter behavior must remain intact. View plugins need no server-side executable code. Do not add arbitrary dynamic import to host process or hardcode agent-board content into host build. A generic route `/configure#plugin/<id>` and manifest-derived navigation contribution are appropriate.

First build representative team region, then expand to all three views after review. Prefer a compact real projection from existing operatorWorkspace, execution activity, router ingress/batches, decision records, and browser sessions. Keep payloads bounded; metadata only by default. Source/agent filters are UI scope filters, not new organization access control.

## Verification

- Package digest and manifest validation, install/stage/disable/rollback preserving latest host settings.
- Authenticated API only; sanitized projection excludes credentials, raw prompts, native history, sensitive paths; explicit time window/retention labels.
- Real Runtime fixture exercises calls/tasks/attention/admissions/decisions. Synthetic test events are not production model acceptance.
- Typecheck, plugin build, relevant regressions, dark/light desktop, 390px narrow, keyboard, reduced motion, empty/error/stale, real package loaded inside existing shell.
- Self-review implementation and integration. No production restart/push unless requested.

## Data and state contract

| Region | Real source | Important limits |
| --- | --- | --- |
| Team | worker profiles, execution-call, current runs | Configured profile is distinct from actual running model; explicitly pick display fields, never spread profile options |
| Tasks | operatorWorkspace task projection | Preserve ready/replied/closed/attention semantics; paginated list and total, not a fake percent |
| Attention | pending approvals, task questions, delivery uncertainty, browser control | Existing host destinations own approval/reply/stop/handoff actions |
| Listening | router-admission, candidate batch, follow-up ownership | Messages and batches use different units; auxiliary output never counts as Router final decision |
| Usage | routing decision records with usage | Probe excluded; last 100 decision records and last 200 ended execution calls are retained windows, not full-day/month accounting |
| Browser | active sessions and control state | Expose session id, owner and state only; URLs/titles can carry sensitive information and are unnecessary in the board summary |

Snapshot returns explicit coverage metadata, has a bounded payload, and is created only for an authenticated operator and an enabled package holding the declared capability. A plugin must not manufacture a running state on connection failure. A retired Worker may still have historical tasks: preserve those tasks with an unavailable profile label rather than dropping them.

State review examples:

- A tool fails, retry succeeds: the latest task can recover while the failed call stays in recent activity.
- A Worker returns ready: show result ready until the Router/host delivery state confirms a reply; no human acceptance inference.
- A person stops a task: show existing authoritative stopping/stopped state; a click does not immediately mark it stopped.
- A source has no messages: distinguish healthy/idle from disconnected/unknown. No looping signal animation for idle sources.
- A scoped context is revoked while auxiliary judgment runs: the advisory cannot revive the context or authorize a task.
- Plugin is disabled or package changes while mounted: stop delivering data and show unavailable; obsolete frame requests cannot navigate the host.
