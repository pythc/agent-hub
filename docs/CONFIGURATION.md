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

**Deploy or manage an assistant.** Open the management link. Tasks shows decisions waiting for a person, running work and recent results. Software connections, Model services, Execution and Prompts are separate configuration pages. Add one entry at a time; several entries can share the same AI service. A role selector does not grant authority: management APIs require an operator session/token, and guide invitations cannot call them.

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

Open **Model services → New service**. Give the connection a name, choose the existing Codex login or an API provider, and check/save it. OpenAI exposes both Responses and Chat Completions; custom endpoints also support Anthropic Messages. Multiple services coexist. Adding one does not change Router or Worker assignments, existing software entries or existing conversations.

An API check makes a small real request without work tools or workspace files. A native Codex check tests the installed CLI and sign-in; the in-entry task still verifies actual execution. Managed API keys are saved privately only after application. Provider errors do not echo the key.

## Router and Workers

**Execution** shows connected software → Router → queue → Workers. Choose the Router service/model independently. Set the Worker count from **1 to 10**, then choose each Worker's service/model. A blank model uses that service's default. Save applies to new conversations. Follow-ups stay with the original conversation's backend and model; configuration changes do not migrate history.

Workers reserve slots while managed background jobs are active. Excess new tasks queue. The prototype's additional lane remains available for one human follow-up to an existing conversation; it is not an eleventh configurable Worker. Reducing the pool lets active work finish and limits subsequent dispatch. New assignments use a rotating selection rather than model-based specialization.

Existing deployments without an explicit pool derive Workers from their previous concurrency and Worker role/model settings. The advanced JSON shape is documented in [backends](BACKENDS.md).

## Software connections and prompts

**Software connections → New connection** adds a named office/repository instance even if that platform is already connected. Feishu can reuse the host bot or connect another bot. Existing instances keep their scopes and allowed senders; each office instance has its own verification observation. A personal MCP client entry is the actual installed bridge profile, not an extra artificial software instance.

**Prompts** separates shared requirements, Router instructions, Worker instructions and reply format. The editor contains operator additions, not the full system template. Leave it empty for built-ins; **Preview actual instructions** shows the composed text. Required runtime instructions remain in force. Advanced prompt parts retain system-template and team-skill editing.

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

The private connection-file picker and manual token entry establish the same browser session, so page reload does not require reimporting the file. Permanent tokens and provider keys are not placed in URLs or browser storage. A shared usage guide may retain its sanitized instructions in the tab's session storage; it has no management capability.

Advanced settings retain execution, sources, policy, background work, delivery, prompts, revisions and JSON. Settings saves check revisions. Entry/model deployment pauses at an idle boundary, persists private managed files with a reversible journal, and keeps the HTTP address. Busy work or stale drafts prevent application. A failed rebuild restores the previous deployment; interrupted changes recover against their database commit marker.

Backups include SQLite, effective configuration and managed API/bot credentials. Keep backups private. Work files, cached attachments, external credentials, native client profiles and already sent messages are outside database rollback. Client installs return private backups; restoration refuses to overwrite later user edits. Schema stays at 5. A previous build cannot parse explicit Worker-pool settings; rolling back requires the verified pre-change backup and matching source. See [configuration acceptance and rollback](CONTROL_CENTER_2026-11-05.md) and [earlier entry acceptance](ACCEPTANCE_0.10.md).

## 中文上手

部署者安装依赖后运行 `./start.sh setup`，打开终端给出的管理链接。在**软件接入**新建并命名入口；在**模型服务**新建连接，再到**执行**分别选择 Router 与各 Worker 的服务和模型（1–10 个 Worker）。飞书选群名，客户端点安装，企微按管理员创建条件填写 Bot ID/Secret。配置保存后，到对应软件发送测试，并核对收到、准入、执行和原入口回复四步。

日常使用者只需要管理员发来的使用说明：在原来的群聊、私聊或客户端交代任务，在原处补充和接收成果。不要给普通使用者分发管理令牌。网页聊天是可选诊断，管理页优先展示需要人处理的事和入口状态。

平台审批、首次信任和成员授权无法靠界面省略；页面会指出具体缺项。真实企微目前因企业创建权限限制未完成，不能把隔离测试当作真实开通。

## Execution and recorded calls

Execution opens on **Calls**: select a Router/Worker tab to put it at the center of the call map. Click a tool or count for recorded status, duration and actual model. **Preview animation** shows a labeled visual overlay without executing work; outside preview, flow follows recorded running operations. Switch to **Configuration** for independent Router/Worker settings, 1–10 Workers, new connections/services and instructions. See [the execution UI and acceptance record](EXECUTION_UI_2026-11-05.md) for prompt scope, retained drafts and validation boundaries.
