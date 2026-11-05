# Connect AgentHub to your work software / 接入工作软件

AgentHub runs in the background. Give it work in Feishu, WeCom, a connected AI client or GitHub, and receive results there. The website is for deployment, access and attention items. English is the initial UI language; 简体中文 is available throughout.

## First deployment

Install Node 22.19+ and the source dependencies, then run:

```sh
npm ci
./start.sh setup
```

Open the temporary management link printed by the terminal. No JSON, source IDs or copied access token are required. Setup creates `~/.agent-hub/config.json`, a private state directory and a dedicated read-only work folder. The OS chooses a free port on first launch; setup remembers it. Run the same command again to obtain a fresh link for the existing host. An optional directory argument creates a separate deployment.

An existing deployment still starts with `./start.sh serve CONFIG.json`. Keep using its original configuration and state directory. Do not start a second writer on the same state.

## Two different audiences

**Use an existing assistant.** Read the instructions the deployment owner shares in the team conversation. Find the named bot or connected client and give it work there. Office users do not install Node, configure a model, receive the host's operator token or open the management website. The optional shared guide has read-only access to the selected entry instructions.

**Deploy or manage an assistant.** Open the management link. The daily overview prioritizes work needing a person, then configured software. Add one entry at a time; several entries can share the same AI service. A role selector does not grant authority: management APIs require an operator session/token, and guide invitations cannot call them.

MCP connections are currently personal operator connections. They are not scoped employee accounts on a shared multi-tenant host. Office requests instead use the platform sender identity and the configured admission policy.

## Choose the actual entry

| Entry | Smallest supported setup path | Where to verify |
| --- | --- | --- |
| Feishu | Check the existing bot sign-in; select bot-visible chats; review and save. Without CLI sign-in, enter the app owner's App ID/Secret and check them. | Send the generated test in the selected chat and inspect the original topic reply. |
| WeCom | Have an administrator create an API-mode smart bot using a long connection. Enter its Bot ID and Secret locally. | Send a bot DM, or mention it in a configured group; inspect the same conversation. |
| Codex | Add the connection from the page. AgentHub uses the official `codex mcp add` command and keeps a private backup. | Use the named MCP server from an actual Codex chat and retrieve its completed reply. |
| Cursor / VS Code / WorkBuddy | Install the named client entry from the page; retain other settings. Complete the client's restart, trust and tool confirmation steps. | Send and retrieve a task in that client's actual chat. |
| GitHub | Reuse the host's GitHub login; enter the repository and save. Explicitly choose who may issue requests. | Use the configured command in an Issue or PR discussion and inspect its reply there. |
| Other MCP clients | Pick a documented profile or generic MCP, inspect the generated config and follow the linked client guide. | Use the actual client. Config generation and an SDK handshake alone are not product acceptance. |

Feishu app-credential mode polls the selected chats every five seconds; CLI mode supports the existing bot long connection. They have different event prerequisites. Both require appropriate platform message permissions. Neither a successful credential check nor listing a chat proves that incoming messages and replies work. See [office setup](OFFICE.md).

Platform app creation, permission review and client first-use trust remain real prerequisites. AgentHub does not bypass them. This enterprise currently denies creating the WeCom smart bot, so real WeCom acceptance remains pending; its adapter, official SDK and isolated tests are separate evidence.

## Reuse or add an AI connection

The selected entry reuses the host's current service. If it is missing, the entry page exposes Codex sign-in, an existing configured connection or an API service form. OpenAI and Anthropic presets cover common endpoints; a custom service retains OpenAI Responses, Chat Completions and Anthropic Messages.

Check the service, then explicitly save. The check never uses work tools. An API check makes a small real request to the chosen endpoint. A native Codex check tests the installed CLI and sign-in; the in-entry task still verifies actual execution. A provider error does not echo the API key.

Saving the service updates defaults for future router/worker/subagent work and clears their model overrides. Existing persistent conversations stay bound to their original backend. The flow reuses the operator workspace, preserves deployed office entries and returns to entry setup; it does not make web chat the destination.

## Verify and grant access

Saving shows **configured, awaiting verification**. Start verification, copy the whole test phrase into the selected software, then inspect four separate observations:

1. Request received from that entry.
2. Sender authorized and work accepted.
3. Model work actually completed.
4. Reply sent to the original platform, or actually retrieved by the originating MCP bridge.

For MCP clients, copy the whole phrase: it asks the client AI to forward the inner message with `agent_request`, retrieve completion with `agent_status`, and show the actual reply. The inner no-tools restriction applies to the background assistant, not to the client forwarding the request.

A new office source starts without allowed senders. Send a message to identify the person, then let the operator approve that exact observed identity. Approval applies to that source's configured scope. Previously ignored messages are not automatically replayed; send the test again after access is granted. Existing allowed lists are retained on existing sources.

The host also recognizes an exact, registered short test code as a connectivity check. The code is a correlation marker, not a task ID. The request still passes normal source authorization and actual model execution. Ordinary business messages that merely mention the marker are not rewritten or redirected.

`agent_request` accepts ordinary text and creates the internal identifiers. It returns `discussion`, `requestId` and the recommended `agent_status` arguments so the client AI can track the right task. Reuse them on follow-up/transport retries. MCP status is concise; full results, history, files and jobs remain available with `agent_read` and the resource catalog. The regular operator HTTP status API remains complete.

## Share instructions, not management access

“Share with users” produces copyable English/Chinese usage text containing the selected software and available location. Paste that into your existing team conversation. Employees need no operator credentials.

The optional localhost guide link only works on the host computer or through a corresponding secure tunnel. It is not a public team portal. Client installation changes the computer running AgentHub, not an arbitrary computer viewing the page. For a remote host, use an SSH local forward with the **same port** and the printed loopback address. The bridge, token-file path and command must exist on the client computer; host paths cannot be copied across machines. Do not expose the single-user host publicly to work around setup.

## Sessions, advanced controls and recovery

Management links expire after ten minutes and are consumed once. The page removes their fragment immediately and exchanges it for a same-origin HttpOnly session, lasting up to twelve hours while that host process remains running. Reloading the page keeps the session. A process restart requires a new link. Separate host ports use separate cookie names. Do not share management links or private connection files.

Generate another link for an existing deployment:

```sh
./start.sh open HOST_URL TOKEN_FILE
```

The private connection-file picker and manual token entry remain fallbacks. Permanent tokens and provider keys are not placed in URLs or browser storage. A shared usage guide may retain its sanitized instructions in the tab's session storage; it has no management capability.

Advanced settings retain execution, sources, policy, background work, delivery, prompts, revisions and JSON. Settings saves check revisions. Entry/model deployment pauses at an idle boundary, persists private managed files with a reversible journal, and keeps the HTTP address. Busy work or stale drafts prevent application. A failed rebuild restores the previous deployment; interrupted changes recover against their database commit marker.

Backups include SQLite, effective configuration and managed API/bot credentials. Keep backups private. Work files, cached attachments, external credentials, native client profiles and already sent messages are outside database rollback. Client installs return private backups; restoration refuses to overwrite later user edits. Schema stays at 5 in version 0.10.0. See [acceptance and limitations](ACCEPTANCE_0.10.md).

## 中文上手

部署者安装依赖后运行 `./start.sh setup`，打开终端给出的管理链接。先选**在哪里使用**，复用已有机器人、客户端配置和 AI 服务；缺少模型时就在入口页补齐。飞书选群名，客户端点安装，企微按管理员创建条件填写 Bot ID/Secret。配置保存后，到对应软件发送测试，并核对收到、准入、执行和原入口回复四步。

日常使用者只需要管理员发来的使用说明：在原来的群聊、私聊或客户端交代任务，在原处补充和接收成果。不要给普通使用者分发管理令牌。网页聊天是可选诊断，管理页优先展示需要人处理的事和入口状态。

平台审批、首次信任和成员授权无法靠界面省略；页面会指出具体缺项。真实企微目前因企业创建权限限制未完成，不能把隔离测试当作真实开通。
