# Plugin marketplace

Roppo's **Tools and apps → Marketplace** manages GitHub-distributed workspace views and application connectors. It shares the conversation application's navigation, account, language and white/dark themes. Existing tool configuration remains under **Tool connections**; `/configure#integrations` still opens that surface.

## Install and update

1. Open the marketplace and refresh the catalog, or choose **Add from GitHub**.
2. Enter a repository, catalog file or plugin-directory URL, such as `https://github.com/owner/repo/tree/main/plugins`. A plugin directory may reference a catalog in its immediate parent. For a branch whose name contains `/`, use its full commit SHA in the URL.
3. Open a plugin, review its version and permissions, then confirm installation.
4. A workspace view appears immediately in navigation. A connector is first downloaded; enable its version to load it, then choose **Add connection**. Sender IDs, resource scopes and credentials are configured separately.

Sources are checked when the marketplace opens if the last attempt is older than 30 minutes. Updates are never installed automatically. A failed refresh retains the previous catalog and installed plugins. **Updates** selects the latest compatible stable release, not the repository's global “latest” release. Prereleases require explicit selection in version details.

For a private repository, configure a read-only GitHub token in the host environment and enter that **environment variable name** under the source's private-repository options. Tokens stay on the host and are not sent to redirected asset hosts. This is separate from application credentials collected by a connector's connection form.

Installing a connector does not authorize every group or grant every Worker its tools. The existing source, actor, scope and tool-grant checks still apply. The initial generic connection editor supports options-based source manifests, credential pointers under `/options`, common fields and advanced JSON. Manifests requiring other deployment fields need the existing advanced configuration path.

## Lifecycle guarantees

- Plans pin repository identity, catalog commit, version, archive checksum, package digest, permission set, installation revision and settings revision. The downloaded manifest must match them.
- USTAR/gzip archives contain only `manifest.json`, one self-contained executable (`view.js` or `plugin.mjs`) and optionally `LICENSE`. Links, traversal, duplicate entries, extra executable inputs and oversized archives are rejected. Installation never runs build scripts.
- A downloaded source update does not replace its active version. Activation requires a globally idle host, including open tasks/goals, queued jobs, uncertain tool receipts and unresolved deliveries. The page shows blockers. It never clears them or stops work automatically.
- Read-only workspace views can change without restarting model calls or connectors. The host validates the bundle checksum and JavaScript syntax; this is not a guarantee that an arbitrary third-party view is free of runtime UI bugs. The iframe remains sandboxed, and a retained version can be restored.
- Source activation uses a controlled host restart. The installation ledger, settings reference and activation journal live in the existing SQLite database. Interrupted activation restores the previous references on boot. This intentionally replaces the design proposal's separate overlay file with one transactional authority.
- Rollback restores compatible code references only. It never rewinds task state, source cursors, completed tool receipts or external messages. State-protocol changes require an explicit migration.
- Connectors with configured connections cannot be disabled or uninstalled from the market. Credentials and history are not erased. Unreferenced immutable objects are retained; automatic garbage collection is not implemented.
- Backups include selected, active and retained previous marketplace packages. Verification checks their manifests and executable checksums; restoring to a new state directory rebases managed package references. A pending activation must recover before backup.

## Publish a plugin

The default source is `pythc/agent-hub/plugins/catalog.json`. It indexes published Agent board, Slack and Linear packages. Agent board retains versions 0.1.0 and 0.1.1 for compatible updates and rollback; Slack and Linear start at 1.0.0. See [GitHub releases](https://github.com/pythc/agent-hub/releases). Bundled descriptions are discovery hints, **not proof of availability**: a fresh host resolves the remote catalog before offering installation. Source-only directories have no install action.

The schema is in `src/plugin-market-contract.ts`. Each published version includes:

- Plugin/API version, supported platforms and minimum/maximum host version.
- Source commit, GitHub release asset ID, archive size/SHA-256 and normalized manifest digest.
- Release notes and the exact declared permissions. A catalog entry also includes the maintainer, license, source directory and optional PNG/JPEG/WebP previews at the pinned catalog commit.

Local package preparation (does not publish):

```sh
npx tsx examples/release-plugin.ts prepare agent-board .local/agent-board-release
```

After the code is pushed, use the **Publish a plugin** workflow. It validates the code, builds the package, creates a draft release, uploads the asset, publishes it, verifies GitHub's asset digest and opens a PR updating the catalog. The PR must be merged before the default market discovers that release. The repository must permit Actions to open pull requests. Enable GitHub immutable releases for asset/tag immutability; local checksum checks still apply either way. A failed release is not silently overwritten; inspect the draft/release before retrying.

The initial packages were built from committed source, published through `gh`, and indexed only after GitHub returned matching archive size and SHA-256. The manually triggered publishing workflow has not yet been exercised end to end. Package preparation alone does not upload a release or change a running host.

## Development and verification

```sh
npm run typecheck
npm run build:chat
npx vitest run tests/plugin-market.spec.ts tests/plugin-packages.spec.ts tests/workspace-view.spec.ts tests/backup.spec.ts --maxWorkers=2
npx tsx examples/plugin-market-acceptance.ts .local/market-acceptance
# In a Python environment containing Playwright and Chromium:
python tests/browser/plugin-market.py .local/market-acceptance
```

The browser fixture uses the real host, sessions, database, package installer, sandboxed view and controlled connector restart. Only GitHub transport and the sample connector are synthetic; it does not call a model or send messages to a real application. The Agent board preview is captured from this isolated environment.

## 中文使用说明

在“工具与应用”进入市场，可以添加 GitHub 仓库或插件目录。查看版本与权限后安装：看板安装后即可打开；连接器先下载，再启用并配置账号、群聊范围和允许的发送者。高级选项支持 JSON。

更新检查是自动的，安装更新需手动确认。有未完成任务或未确认的外部操作时，连接器更新会等待宿主空闲；不会替你停止任务。回退只切换插件代码，不回滚消息、任务或投递记录。

首批已发布 Agent 看板 0.1.0 / 0.1.1、Slack 1.0.0 和 Linear 1.0.0。刷新默认来源后即可查看与安装。未发布的插件仍显示“尚未发布安装包”。安装连接器不会自动授权账号或群聊，需单独完成配置。
