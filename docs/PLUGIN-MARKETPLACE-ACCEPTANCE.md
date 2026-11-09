# Plugin marketplace acceptance — 2026-11-09

Implementation checkout: `work/roppo-agent-board-20261108`, branch `codex/agent-board-plugin-20261108`. Existing Agent board changes are retained. This record covers the marketplace addition, not a production deployment or user visual approval.

This is the initial, pre-publication acceptance record. For subsequent public packages, see the [marketplace guide](PLUGIN-MARKETPLACE.md) and [GitHub releases](https://github.com/pythc/agent-hub/releases); the evidence boundaries below describe that initial test run.

## Implemented

- Shared-shell marketplace, installed list, updates, source management and retained legacy tool settings.
- Public/private GitHub catalog reading, repository identity checks, pinned commits, ETags, rate-limit backoff, offline cached metadata and separately configured read-token environment names.
- Release asset download, archive limits and checksums, manifest/permission identity checks, syntax validation for workspace views, immutable package storage, explicit compatibility and stable-version selection.
- Persisted installation/operation records and revision-bound plans. Repeated request IDs replay outcomes. Concurrent mutations and stale reviews are rejected.
- Hot view-reference activation; separately staged source packages with idle-host checks, controlled restart, interrupted-activation recovery, disable/uninstall dependency checks and compatible retained-version rollback.
- Generic connector setup using schema-checked options, advanced JSON, separate secrets, explicit actors/scopes and the existing managed connection transaction.
- Verified backups include active, selected and retained marketplace package bytes; restored object paths use the destination state directory.
- Publishing script and a manually triggered GitHub workflow. The workflow publishes verified assets and proposes a catalog PR; it does not advertise an unpublished version.

The design's proposed separate managed overlay file was replaced with records and an activation journal in the existing SQLite transaction. This avoids dual persistence and lets installation state participate in the existing database backup. There is no new database schema version.

## Automated checks

- TypeScript host, chat and workspace-view type checks: passed after final changes.
- Vite production build: passed. Marketplace assets load separately from the conversation entry bundle.
- Full suite: **72 files, 1073 tests passed** (`npx vitest run --maxWorkers=2`).
- Subsequent focused regression after preview/cleanup additions: **7 files, 80 tests passed** (marketplace, backup, package lifecycle, workspace views, onboarding, Slack and Linear).
- Final reviewer-fix regression: **2 files, 23 tests passed** (marketplace and workspace views); type checks and production build passed again.
- `git diff --check`: passed.
- Package preparation: real Agent board, Slack and Linear bundles produced locally with SHA-256 metadata; no GitHub upload performed.

The 14 new marketplace tests cover install/update/rollback and reboot; task-state retention; request replay; stale settings; offline metadata; same-version replacement rejection; archive and permission tampering; source activation blockers; restart failure/interruption; archive traversal/link/checksum rejection; version/platform selection; token stripping on redirects; authenticated/same-origin HTTP; backup/restore into a new directory; two-source cursor/receipt preservation; publisher collisions/manual configuration conflicts; concurrent network/settings changes; read-only inventory; ETag and rate limits.

## Browser checks

Final isolated evidence: `.local/plugin-market-acceptance-08/`.

`tests/browser/plugin-market.py` passed six behavior groups with `pageErrors: []`:

1. Shared navigation, white/dark themes, search/empty results and category filters.
2. Permission review, actual package extraction/install, immediate navigation entry, opening the sandboxed Agent board and repository-scoped installed details.
3. Compatible update, retained version rollback, disable/enable, Escape and focus restoration after an update row is removed/recreated.
4. Source download versus activation, live blocker updates and recheck action, controlled host rebuild, actor/scope connection creation and uninstall dependency blocking.
5. Existing tool settings, GitHub source management and a failed-source path.
6. Chinese layout at 390 × 844, both themes, no horizontal overflow and reduced-motion drawers. Desktop viewport: 1440 × 1000.

Dark primary-button hover was explicitly checked for the off-white action background, after correcting the generic hover rule that had overridden it. Screenshots show the final behavior. The plugin preview was captured from the isolated Agent board host.

`activation-blocked-dark.png` and `activation-ready-dark.png` capture the same review transitioning from a task blocker to an available confirmation. This UI transition overlays changing blocker snapshots on real inventory responses; backend tests separately verify rejection using real unfinished database records.

The mechanical design detector reported nine advisory token differences and no non-advisory findings. Existing shell tokens and composition were retained; this is not a design-system rewrite.

## Independent review

The finish review identified two material behavior issues: details could inherit the installed state of the same plugin ID from another repository, and an activation review could keep its original blockers after work finished. Both were corrected and rechecked with code, rendered evidence and browser assertions. The final verdict was **ship**, with both findings **resolved**; see `.local/plugin-market-acceptance-08/finish-verdict.md`. This verdict applies to the local implementation and supplied test evidence, not public release availability.

The independent documentation review found the marketplace compatible with the existing shared-shell design; no design-system change was needed. It recorded pre-existing token/document differences and the absent `.impeccable/design.json` without rewriting the design authority. Its report is `.local/plugin-market-acceptance-07/documentation-review.md`. Final acceptance-08 only improved screenshot framing, with no further UI changes. Isolated fixture hosts were stopped after verification.

## Evidence boundaries

- Browser acceptance uses real HTTP handlers, authentication, SQLite, package validation, installation, iframe loading and controlled restarts. GitHub responses and the small test connector are fixtures; no paid model call or real application message is involved.
- A real request through `PluginGitHub` to `pythc/agent-hub/main/plugins/catalog.json` did not find a published catalog. Consequently the public download/install loop is **not yet live-accepted**. Bundled descriptions carry empty release lists and cannot be installed until publication.
- Private-repository credential use is covered by request/redirect tests, not by a real private GitHub account session.
- Activation failure/recovery and startup recovery are tested; abrupt machine power loss is not tested. View bundle checks do not prove arbitrary third-party UI runtime behavior.
- The GitHub Actions publishing workflow is authored but has not executed remotely. GitHub immutable releases must be enabled by the repository maintainer; the application does not assume they are enabled.
- Existing production configuration and running Roppo host were not replaced or restarted. No source changes or release artifacts have been pushed in this task.

See [usage and release instructions](PLUGIN-MARKETPLACE.md).
