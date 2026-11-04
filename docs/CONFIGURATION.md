# Configuration console / 双语配置台

Open `/configure` on the running AgentHub host. English is the default interface language; select 简体中文 to switch. The existing operations console stays available at `/`.

The page reads and saves the host's real configuration. Connect with the access token in `<stateDir>/access-token`. The page keeps that token in memory for the current page session, never in the URL or browser storage. Language preference is stored locally. Keep this local operator token private.

## Isolated preview

```sh
node --import tsx examples/configuration-preview.ts
```

The script prints the preview URL (`http://127.0.0.1:4335/configure`) and token file path. Paste that file's token into the connection form. Preview settings are persisted under `.local/configuration-preview/state`, separate from other hosts. Re-running the script keeps its saved revisions.

The preview uses the real settings, revision, validation and database interfaces. It does not authenticate real model services or office bots. Its connectors do not contact platforms, operational requests are rejected, and tasks cannot be submitted. It is a configuration playground, not a running office assistant.

## Save and recovery semantics

- A successful save creates a new immutable revision. Reloading or restarting the host retains it.
- A stale revision returns HTTP 409 with `code=settings_conflict`; the newer server version is not overwritten. Compare the latest version before applying the intended edits again.
- Invalid values return `code=validation_error` and field paths. Failed saves do not create partial revisions.
- Model backend definitions and source connection/deployment settings require an edited startup configuration and controlled restart. They cannot be hot-saved through this page. `code=restart_required` protects source deployment fields.
- Selecting an execution backend changes future sessions. Existing sessions remain bound to their original backend.
- Restoring history is a new settings revision. It does not undo files, messages, publication or merges.

Credentials remain in the host environment or private environment file. Configuration contains environment variable names, not secret values. Changing those names does not create credentials or authenticate a provider.

## 中文说明

在现有宿主地址后添加 `/configure`，输入该实例状态目录中的访问令牌。默认英文，可切换简体中文。这个页面直接使用真实设置接口；保存成功后产生版本，刷新及重启后仍保留。

隔离预览使用单独端口和状态库，可以实际修改配置、验证持久化和版本冲突；不连接办公平台，也不执行任务。真实实例仍应使用自己的配置和访问令牌。

后端定义、来源的连接参数、路径等部署设置需要修改启动 JSON 并受控重启。人员允许列表、规则、模型角色选择、后台作业和提示词等可热更新字段按宿主能力保存。配置成功、服务在线、平台认证成功分别显示，不能相互替代。

接入飞书或企业微信前仍需完成平台权限及凭据准备，见 [办公接入](OFFICE.md)。升级前保留原配置和状态备份，见 [备份与升级](../README.md#检查升级和回退)。
