# Agent board acceptance — 2026-11-09

Implementation: `codex/agent-board-plugin-20261108`. Existing running Roppo instances, configuration, state and other worktrees were not updated.

## Delivered

- Independent `plugins/agent-board` browser package, using a generic workspace-view host extension rather than a second application shell.
- Overview with Router/Worker relationships, real execution state, task attention and recent calls; task search/source/state filtering and pagination; retained admission/batch observations and auxiliary decision usage.
- Shared navigation, English/Chinese and black/white themes; responsive layout, keyboard tabs/dialogs, focus retention, reduced motion and stale/recovery states.
- Authenticated metadata projection with an explicit read capability. No model invocation, raw configuration, prompt, credential, URL or tool-argument access from the view. Browser summaries are user-scoped and do not open the vault.
- Digest-pinned immutable installation, stage/inspect workflow, disabled/tampered-package rejection and rollback against the latest configuration without restoring task state.

## Verification

| Check | Result |
| --- | --- |
| Full Vitest regression | 71 files, 1,059 tests passed, `--maxWorkers=2` |
| Final relevant backend/plugin regressions | 52 tests passed across workspace views, browser manager, operator projection and source package compatibility |
| Host and plugin TypeScript | `npm run typecheck` passed |
| Host production frontend | `npm run build:chat` passed |
| Independent plugin CLI pack/inspect | Passed; verified manifest and bundle checksums |
| Browser acceptance | Chromium, actual authenticated server and installed package, real Runtime with synthetic test records |
| Viewports | 1440 × 1000 light/dark; 390 × 844 with no horizontal overflow |
| Isolation | Parent DOM and direct network requests blocked; arbitrary window navigation messages ignored |
| Lifecycle | Delayed old filter responses fenced; previous-source rows withheld while changing filter; search and polling retain focus; mounted frame removed after revoked read |
| Interaction | Keyboard tabs, drawer Escape/focus return, search/empty state, pagination, source filters, host navigation and remount |
| Accessibility/motion | Reduced motion disables animation; stale and paused states stop flow; live theme/language propagation |

The final frontend filter/title refinements were checked with TypeScript, the host build and the browser suite after the full regression run. They do not alter backend execution.

Browser artifacts are under `.local/agent-board-acceptance-05/`, including `browser-results.json` and light/dark, mobile, task, listening, stale and Chinese screenshots. No uncaught page errors occurred. The existing configuration page intentionally probes `/workspaces` and `/connection-capabilities`; this host returns 404 and its existing compatibility fallback is used. Those expected probes, and the deliberately injected 503/404 failure cases, are recorded separately.

## Review findings addressed

- Replaced per-render component definitions with stable rendered nodes so periodic snapshots do not discard keyboard focus.
- Separated refresh throttling from host navigation; a recent refresh cannot swallow “Configure”.
- Kept source options and search controls mounted while withholding old-source content during a pending or failed filter.
- Prevented old iframe/query results from updating the current route; revalidated the enabled pinned package before host navigation.
- Preserved failed calls after successful retry, distinguished configured and actual call models, and excluded probe tokens without turning missing usage into zero.
- Preserved deployment refs across saved settings and rollback; published staged config atomically without replacing a concurrently created file.
- Avoided constructing the full host status merely to read pause/activity counters during workspace polling.

## Package

Agent board `0.1.0`:

- Manifest digest: `0548fa82dbf2e6b61978f79dd4f77479e6513df4ca3d220fd2d2c9647a41d6e3`.
- Bundle SHA-256: `cc74f72ae49ea66c342b519c2f94b105a510dd71c073fcdf1d20ece714170bda`.
- Browser bundle: 270,997 bytes; local archive with Apache-2.0 license: `.local/agent-board-0.1.0.tgz`.
- [Installation and rollback](../plugins/agent-board/README.md), [host contract](WORKSPACE_VIEWS.md).

This is local implementation and automated acceptance, not a production rollout, real paid-model/platform acceptance, organization permission isolation, or user visual sign-off. Admission and auxiliary-usage windows are bounded observations; the board does not claim full-team accounting, savings or completed interventions from an auxiliary classification.
